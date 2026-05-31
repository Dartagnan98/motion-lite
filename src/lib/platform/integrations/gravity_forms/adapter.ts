// Gravity Forms adapter — implements AdapterContract<GravityFormsRawSnapshot, GravityFormsNormalized>.
//
// Auth model: basic_auth. Same as WordPress REST adapter — Application Password basic auth.
// The Gravity Forms REST namespace is /wp-json/gf/v2/ (not the WP core /wp/v2/ namespace).
//
// This adapter reuses callWordPress() from the WordPress adapter for the HTTP layer.
// The credentials model is identical: { siteUrl, username, appPassword }.
//
// connect() is a multi-step flow:
//   Step 1: Validate credentials via GET /gf/v2/forms. Build form picker.
//   Step 2: PM selects which forms count toward the report (multi-select).
//   Step 3: Finalize — write integration row with selected formIds.
//
// config_json shape: { siteUrl, username, appPassword, formIds?, formNames? }
//
// Flow:
//   1. connect()       → validate credentials + form selection → integration row → integrationId
//   2. fetchSnapshot() → GET /gf/v2/entries per form + daily aggregation → raw snapshot
//   3. normalize()     → pure GravityFormsRawSnapshot → GravityFormsNormalized
//   4. health()        → read integration row; no live ping
//   5. refresh()       → no-op (no OAuth)
//
// Rate limiting: GF REST inherits WP's no-hard-limit policy.
// We apply 1 req/sec courtesy throttle. fetchSnapshot makes 1 total-count call per
// selected form + 1 entries-per-day paginated call. For typical 1-5 form setups
// this is ~10-15 API calls total.

import { getDb, generatePublicId } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import type {
  AdapterContract,
  ConnectContext,
  ConnectResult,
  FetchSnapshotArgs,
  HealthStatus,
} from '../../adapter-contract'
import { callWordPress } from '../wordpress/adapter'
import type {
  GfDetailedEntry,
  GfFieldMap,
  GfFormField,
} from './types'
import { normalize } from './normalize'
import type {
  GravityFormsRawSnapshot,
  GfForm,
  GfEntry,
  GfEntriesResponse,
  GfFormBreakdown,
  GfDailyCount,
} from './types'
import type { GravityFormsNormalized } from './normalize'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface GravityFormsConfig {
  siteUrl: string
  username: string
  appPassword: string
  /** Selected form IDs. Empty array = all visible forms. */
  formIds: string[]
  /** Display names parallel to formIds. Stored for dashboard tile labels. */
  formNames: string[]
}

function readConfig(integrationId: number): GravityFormsConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`gravity_forms.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`gravity_forms.adapter: integration ${integrationId} has no config_json`)
  }
  let parsed: Partial<GravityFormsConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`gravity_forms.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.siteUrl || typeof parsed.siteUrl !== 'string') {
    throw new Error(`gravity_forms.adapter: integration ${integrationId} config_json missing siteUrl`)
  }
  if (!parsed.username || typeof parsed.username !== 'string') {
    throw new Error(`gravity_forms.adapter: integration ${integrationId} config_json missing username`)
  }
  if (!parsed.appPassword || typeof parsed.appPassword !== 'string') {
    throw new Error(`gravity_forms.adapter: integration ${integrationId} config_json missing appPassword`)
  }
  return {
    siteUrl: parsed.siteUrl,
    username: parsed.username,
    appPassword: parsed.appPassword,
    formIds: Array.isArray(parsed.formIds) ? parsed.formIds : [],
    formNames: Array.isArray(parsed.formNames) ? parsed.formNames : [],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 1-second courtesy delay between API calls. */
function sleep1s(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1000))
}

/** Unwrap a GF entries response — handles both wrapped and raw array shapes. */
function unwrapGfEntries(raw: unknown): GfEntriesResponse {
  if (raw && typeof raw === 'object' && 'total_count' in raw) {
    return raw as GfEntriesResponse
  }
  // Some versions return the entries array directly with total_count in headers.
  // Fall back: treat as empty with 0 total.
  return { total_count: 0, entries: [] }
}

// ─── Public picker helper (multi-step connect UI) ────────────────────────────

export interface GfFormPickerItem {
  formId: string
  title: string
  isActive: boolean
  totalEntries?: number
}

/** List all Gravity Forms accessible with the given credentials.
 *
 *  GET /gf/v2/forms. GF returns all forms in one response (no pagination documented).
 *  We apply the dedupe + early-break loop defensively in case pagination is added.
 *
 *  Exposed for the picker route: POST /api/platform/gravity-forms/list-forms
 */
export async function listForms(args: {
  siteUrl: string
  username: string
  appPassword: string
}): Promise<GfFormPickerItem[]> {
  const byId = new Map<string, GfFormPickerItem>()
  const limit = 250
  const siteUrl = args.siteUrl.replace(/\/$/, '')

  for (let page = 1; page < 20; page++) {
    const { data: raw } = await callWordPress<unknown>({
      ...args,
      siteUrl,
      path: '/wp-json/gf/v2/forms',
      params: {
        paging: JSON.stringify({ page_size: limit, current_page: page }),
      },
    })

    // GF returns forms as an object keyed by form ID, or as an array.
    let items: GfForm[]
    if (Array.isArray(raw)) {
      items = raw as GfForm[]
    } else if (raw && typeof raw === 'object') {
      // Object shape: { "1": { id: "1", title: "..." }, "2": { ... } }
      items = Object.values(raw as Record<string, GfForm>)
    } else {
      items = []
    }

    if (items.length === 0) break

    let newCount = 0
    for (const item of items) {
      if (!item.id || !item.title) continue
      const id = String(item.id)
      if (!byId.has(id)) {
        byId.set(id, {
          formId: id,
          title: item.title,
          // GF versions differ: is_active may be boolean true, string "1", or number 1.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isActive: item.is_active === true || item.is_active === '1' || (item.is_active as any) === 1,
          totalEntries: item.total_count,
        })
        newCount++
      }
    }

    if (newCount === 0) break
    if (items.length < limit) break
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  )
}

// ─── Internal fetch helpers ───────────────────────────────────────────────────

/** Fetch total entry count for a form within a period.
 *
 *  GET /gf/v2/entries?form_ids=<id>&search={"start_date":"...","end_date":"..."}&paging[page_size]=1
 *
 *  We use page_size=1 and read total_count from the response body.
 *  GF's search object supports start_date and end_date in Y-m-d format.
 */
async function fetchFormEntryCount(args: {
  siteUrl: string
  username: string
  appPassword: string
  formId: string
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
}): Promise<number> {
  const { data: raw } = await callWordPress<unknown>({
    siteUrl: args.siteUrl,
    username: args.username,
    appPassword: args.appPassword,
    path: '/wp-json/gf/v2/entries',
    params: {
      form_ids: args.formId,
      search: JSON.stringify({ start_date: args.startDate, end_date: args.endDate }),
      'paging[page_size]': '1',
      'paging[current_page]': '1',
    },
  })

  const parsed = unwrapGfEntries(raw)
  return parsed.total_count
}

/** Fetch all entry dates for a form within a period to build the daily series.
 *
 *  Uses pagination with the dedupe + early-break pattern. Page size 250 to
 *  minimize calls. We only need date_created, so request only that field.
 *
 *  GF does not have a server-side daily aggregation endpoint — we must fetch
 *  all entries and group client-side. For typical Phase 2 clients (~100 entries/month)
 *  this is 1-2 pages. For high-volume forms (>2500/month), consider capping at
 *  20 pages (5000 entries) and noting the truncation in warnings.
 */
/** Fetch a form's field schema to discover which field IDs are the
 *  standardized name/phone/email/message fields. Heuristic: type-based first,
 *  then label-based fallback. */
async function fetchFormSchema(args: {
  siteUrl: string
  username: string
  appPassword: string
  formId: string
}): Promise<GfFieldMap> {
  const siteUrl = args.siteUrl.replace(/\/$/, '')
  let fields: GfFormField[] = []
  try {
    const { data: raw } = await callWordPress<unknown>({
      siteUrl,
      username: args.username,
      appPassword: args.appPassword,
      path: `/wp-json/gf/v2/forms/${args.formId}`,
    })
    const form = raw as { fields?: unknown }
    if (Array.isArray(form?.fields)) {
      fields = form.fields as GfFormField[]
    }
  } catch {
    // Form schema unavailable; return empty field map so detail rows just have nulls.
    return { nameFieldId: null, phoneFieldId: null, emailFieldId: null, messageFieldId: null }
  }

  const map: GfFieldMap = {
    nameFieldId: null,
    phoneFieldId: null,
    emailFieldId: null,
    messageFieldId: null,
  }

  // Pass 1: detect by GF field type.
  for (const f of fields) {
    const id = String(f.id)
    if (f.type === 'name' && !map.nameFieldId) map.nameFieldId = id
    if (f.type === 'phone' && !map.phoneFieldId) map.phoneFieldId = id
    if (f.type === 'email' && !map.emailFieldId) map.emailFieldId = id
    if (f.type === 'textarea' && !map.messageFieldId) map.messageFieldId = id
  }

  // Pass 2: label-based fallback for fields not yet matched.
  for (const f of fields) {
    const id = String(f.id)
    const label = (f.label ?? '').toLowerCase()
    if (!map.nameFieldId && /^(first |full |your )?name$/.test(label.trim())) map.nameFieldId = id
    if (!map.phoneFieldId && /phone|mobile|tel/.test(label)) map.phoneFieldId = id
    if (!map.emailFieldId && /e-?mail/.test(label)) map.emailFieldId = id
    if (!map.messageFieldId && /(message|comments?|inquiry|description|details?)/.test(label)) {
      map.messageFieldId = id
    }
  }

  return map
}

/** Resolve a name field value from an entry. GF's `name` field has subinputs:
 *  the entry typically stores parts under "<id>.3" (first) and "<id>.6" (last)
 *  and sometimes also under "<id>" directly. Tries the bare key first, then
 *  joins subkeys. */
function resolveNameValue(entry: Record<string, unknown>, fieldId: string | null): string | null {
  if (!fieldId) return null
  const bare = entry[fieldId]
  if (typeof bare === 'string' && bare.trim()) return bare.trim()
  const first = entry[`${fieldId}.3`]
  const last = entry[`${fieldId}.6`]
  const parts = [first, last].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return parts.length > 0 ? parts.join(' ') : null
}

/** Plain string lookup with whitespace + truncation for the message column. */
function resolveTextValue(entry: Record<string, unknown>, fieldId: string | null, maxLen = 240): string | null {
  if (!fieldId) return null
  const v = entry[fieldId]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed
}

/** Fetch the top N most recent entries for the given forms, with all field
 *  values included. Used by fetchSnapshot to populate the `recentEntries`
 *  table in the report. */
async function fetchRecentEntries(args: {
  siteUrl: string
  username: string
  appPassword: string
  formIds: string[]
  startDate: string  // YYYY-MM-DD
  endDate: string
  fieldMaps: Map<string, GfFieldMap>
  formTitles: Record<string, string>
  limit: number
}): Promise<GfDetailedEntry[]> {
  const siteUrl = args.siteUrl.replace(/\/$/, '')
  if (args.formIds.length === 0 || args.limit <= 0) return []

  const result: GfDetailedEntry[] = []
  // GF /entries supports form_ids (comma list), search (date range), sorting,
  // and paging. Sort desc by date_created so the most recent come first.
  const params: Record<string, string> = {
    'form_ids': args.formIds.join(','),
    'search': JSON.stringify({
      start_date: args.startDate,
      end_date: `${args.endDate} 23:59:59`,
      status: 'active',
    }),
    'sorting[key]': 'date_created',
    'sorting[direction]': 'DESC',
    'paging[page_size]': String(Math.min(args.limit, 100)),
    'paging[current_page]': '1',
  }

  try {
    const { data: raw } = await callWordPress<unknown>({
      siteUrl,
      username: args.username,
      appPassword: args.appPassword,
      path: '/wp-json/gf/v2/entries',
      params,
    })

    const body = raw as { entries?: Array<Record<string, unknown>> }
    const entries = Array.isArray(body?.entries) ? body.entries : []

    for (const e of entries) {
      const entryId = typeof e.id === 'string' || typeof e.id === 'number' ? String(e.id) : null
      const formId = typeof e.form_id === 'string' || typeof e.form_id === 'number' ? String(e.form_id) : null
      const dateCreated = typeof e.date_created === 'string' ? e.date_created : null
      if (!entryId || !formId || !dateCreated) continue

      const fieldMap = args.fieldMaps.get(formId) ?? {
        nameFieldId: null, phoneFieldId: null, emailFieldId: null, messageFieldId: null,
      }

      result.push({
        entryId,
        formId,
        formTitle: args.formTitles[formId] ?? formId,
        dateCreated,
        name: resolveNameValue(e, fieldMap.nameFieldId),
        phone: resolveTextValue(e, fieldMap.phoneFieldId, 64),
        email: resolveTextValue(e, fieldMap.emailFieldId, 128),
        message: resolveTextValue(e, fieldMap.messageFieldId, 240),
        entryUrl: `${siteUrl}/wp-admin/admin.php?page=gf_entries&view=entry&id=${formId}&lid=${entryId}`,
      })
    }
  } catch (err) {
    console.error('[gravity_forms.fetchRecentEntries]', err instanceof Error ? err.message : err)
  }

  return result
}

async function fetchEntryDates(args: {
  siteUrl: string
  username: string
  appPassword: string
  formIds: string[]
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
}): Promise<string[]> {  // returns array of date_created strings
  const seenIds = new Set<string>()
  const dates: string[] = []
  const pageSize = 250
  const maxPages = 20  // cap at 5000 entries per fetchSnapshot

  const formIdsParam = args.formIds.join(',')

  for (let page = 1; page <= maxPages; page++) {
    const { data: raw } = await callWordPress<unknown>({
      siteUrl: args.siteUrl,
      username: args.username,
      appPassword: args.appPassword,
      path: '/wp-json/gf/v2/entries',
      params: {
        form_ids: formIdsParam,
        // GF's `search.end_date` is inclusive but compared as datetime — without
        // a time component, "2026-05-20" becomes "2026-05-20 00:00:00" and
        // excludes same-day entries. Add 23:59:59 to capture the full last day.
        search: JSON.stringify({
          start_date: args.startDate,
          end_date: `${args.endDate} 23:59:59`,
          status: 'active',
        }),
        'paging[page_size]': String(pageSize),
        'paging[current_page]': String(page),
        // NOTE: do NOT send `_field_ids` here — that filter operates on FORM
        // field IDs (e.g. "1.3" for name first), not entry meta fields. With
        // it set, GF strips `status` and `date_created` from the response.
      },
    })

    const parsed = unwrapGfEntries(raw)
    const entries: GfEntry[] = parsed.entries ?? []

    if (entries.length === 0) break

    let newCount = 0
    for (const entry of entries) {
      if (!entry.id) continue
      // Skip spam/trash. Treat missing status as 'active' (search already
      // filtered server-side).
      if (entry.status === 'spam' || entry.status === 'trash') continue
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id)
        if (entry.date_created) {
          dates.push(entry.date_created)
          newCount++
        }
      }
    }

    if (newCount === 0) break  // no new entries this page — stop
    if (entries.length < pageSize) break  // last page

    await sleep1s()
  }

  return dates
}

/** Group an array of GF date_created strings into a daily count map.
 *
 *  GF date_created format: "2026-04-15 14:30:00" (local site time, no timezone).
 *  We take the first 10 chars (YYYY-MM-DD) to get the date.
 */
function buildDailyCounts(dates: string[], startDate: string, endDate: string): GfDailyCount[] {
  const counts = new Map<string, number>()

  // Initialize all days in range to 0 so the chart has no gaps.
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    counts.set(key, 0)
  }

  for (const dateStr of dates) {
    const key = dateStr.slice(0, 10)
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    // If outside the range (shouldn't happen with GF search filter), skip.
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const gravityFormsAdapter: AdapterContract<GravityFormsRawSnapshot, GravityFormsNormalized> = {
  provider: 'gravity_forms',
  authModel: 'basic_auth',
  displayName: 'Gravity Forms',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // basic_auth connect: validate credentials + form selection → integration row.
    //
    // ctx.callbackState carries:
    //   siteUrl:    WordPress site URL
    //   username:   WP username
    //   appPassword: WP Application Password
    //   formIds:    JSON array string of selected form IDs
    //   formNames:  JSON array string of selected form display names

    const siteUrl = ctx.callbackState?.siteUrl as string | undefined
    const username = ctx.callbackState?.username as string | undefined
    const appPassword = ctx.callbackState?.appPassword as string | undefined

    if (!siteUrl) {
      throw new Error('gravity_forms.adapter.connect: ctx.callbackState.siteUrl is required')
    }
    if (!username) {
      throw new Error('gravity_forms.adapter.connect: ctx.callbackState.username is required')
    }
    if (!appPassword) {
      throw new Error('gravity_forms.adapter.connect: ctx.callbackState.appPassword is required')
    }

    const normalizedSiteUrl = siteUrl.replace(/\/$/, '')

    // Parse form selections from callbackState.
    function parseJsonArray(raw: string | number | undefined): string[] {
      if (!raw) return []
      if (typeof raw === 'number') return []
      try {
        const parsed = JSON.parse(String(raw))
        return Array.isArray(parsed) ? (parsed as string[]) : []
      } catch {
        return (raw as string).split(',').map((s) => s.trim()).filter(Boolean)
      }
    }

    const formIds = parseJsonArray(ctx.callbackState?.formIds as string | undefined)
    const formNames = parseJsonArray(ctx.callbackState?.formNames as string | undefined)

    // Validate credentials by calling GET /gf/v2/forms. Throws on 401/403.
    await callWordPress<unknown>({
      siteUrl: normalizedSiteUrl,
      username,
      appPassword,
      path: '/wp-json/gf/v2/forms',
    })

    ensurePlatformReady()
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    const configObj: Record<string, unknown> = { siteUrl: normalizedSiteUrl, username, appPassword }
    if (formIds.length > 0) configObj.formIds = formIds
    if (formNames.length > 0) configObj.formNames = formNames

    const config = JSON.stringify(configObj)

    let displayName: string
    if (formNames.length === 1) {
      displayName = `Gravity Forms — ${formNames[0]}`
    } else if (formNames.length > 1) {
      displayName = `Gravity Forms — ${formNames.length} forms`
    } else {
      displayName = `Gravity Forms — ${normalizedSiteUrl}`
    }

    const result = db.prepare(
      `INSERT INTO platform_integrations
         (tenant_id, public_id, level, agency_id, account_id, domain_id,
          provider, auth_model, config_json, display_name,
          status, last_health_status, last_health_checked_at, last_synced_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'gravity_forms', 'basic_auth', ?, ?, 'connected', NULL, ?, NULL, ?, ?)`
    ).run(
      ctx.tenantId,
      generatePublicId(),
      ctx.level,
      ctx.agencyId,
      ctx.accountId,
      ctx.domainId,
      config,
      displayName,
      now,
      now,
      now,
    )
    const integrationId = Number(result.lastInsertRowid)

    return { integrationId }
  },

  async refresh(_integrationId: number): Promise<void> {
    // No-op. WordPress Application Passwords do not expire.
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<GravityFormsRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)
    const periodStart = args.period.start.toISOString().slice(0, 10)
    const periodEnd = args.period.end.toISOString().slice(0, 10)

    const callArgs = {
      siteUrl: config.siteUrl,
      username: config.username,
      appPassword: config.appPassword,
    }

    // Determine which forms to query.
    let targetFormIds = config.formIds
    let formTitles: Record<string, string> = {}

    if (targetFormIds.length === 0) {
      // No filter — query all forms. Fetch form list to get IDs + titles.
      const allForms = await listForms(callArgs)
      targetFormIds = allForms.map((f) => f.formId)
      for (const f of allForms) {
        formTitles[f.formId] = f.title
      }
    } else {
      // Build title map from stored names.
      for (let i = 0; i < config.formIds.length; i++) {
        formTitles[config.formIds[i]] = config.formNames[i] ?? config.formIds[i]
      }
    }

    // Fetch per-form entry counts (1 call per form + 1s delay).
    const byForm: GfFormBreakdown[] = []
    let totalEntries = 0

    for (const formId of targetFormIds) {
      const count = await fetchFormEntryCount({
        ...callArgs,
        formId,
        startDate: periodStart,
        endDate: periodEnd,
      })
      byForm.push({
        formId,
        formTitle: formTitles[formId] ?? formId,
        entryCount: count,
      })
      totalEntries += count
      await sleep1s()
    }

    // Fetch all entry dates for the daily series (all selected forms, paginated).
    const entryDates = await fetchEntryDates({
      ...callArgs,
      formIds: targetFormIds,
      startDate: periodStart,
      endDate: periodEnd,
    })

    const daily = buildDailyCounts(entryDates, periodStart, periodEnd)

    // Build per-form field maps for the recent-entries table. One /forms/{id}
    // call per selected form (cached for the duration of fetchSnapshot).
    const fieldMaps = new Map<string, GfFieldMap>()
    for (const formId of targetFormIds) {
      const fm = await fetchFormSchema({ ...callArgs, formId })
      fieldMaps.set(formId, fm)
      await sleep1s()
    }

    // Fetch top 100 most recent entries across the selected forms.
    const recentEntries = await fetchRecentEntries({
      ...callArgs,
      formIds: targetFormIds,
      startDate: periodStart,
      endDate: periodEnd,
      fieldMaps,
      formTitles,
      limit: 100,
    })

    // Stamp integration row.
    getDb().prepare(
      `UPDATE platform_integrations
          SET last_synced_at = ?, status = 'connected',
              last_health_status = 'green', last_health_message = NULL,
              last_health_checked_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
      args.integrationId,
    )

    return {
      siteUrl: config.siteUrl,
      periodStart,
      periodEnd,
      formIds: targetFormIds,
      totalEntries,
      byForm,
      daily,
      recentEntries,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: GravityFormsRawSnapshot): GravityFormsNormalized {
    return normalize(raw)
  },

  async health(integrationId: number): Promise<HealthStatus> {
    ensurePlatformReady()
    const row = getDb().prepare(
      `SELECT status, last_synced_at, last_health_status, last_health_message, config_json
         FROM platform_integrations WHERE id = ?`
    ).get(integrationId) as
      | {
          status: string
          last_synced_at: number | null
          last_health_status: string | null
          last_health_message: string | null
          config_json: string | null
        }
      | undefined

    if (!row) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: `Integration ${integrationId} not found`,
      }
    }

    if (!row.config_json) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: 'Integration has no config_json — reconnect required',
      }
    }

    try {
      const parsed = JSON.parse(row.config_json) as Partial<GravityFormsConfig>
      if (!parsed.siteUrl || !parsed.username || !parsed.appPassword) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing siteUrl, username, or appPassword — reconnect required',
        }
      }
    } catch {
      return {
        status: 'red',
        reason: 'not_configured',
        message: 'config_json invalid JSON — reconnect required',
      }
    }

    if (!row.last_synced_at) {
      return {
        status: 'yellow',
        reason: 'stale',
        message: 'No snapshot yet — call fetchSnapshot() to verify end-to-end',
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const STALE_AFTER_SECONDS = 7 * 24 * 60 * 60
    if (now - row.last_synced_at > STALE_AFTER_SECONDS) {
      return {
        status: 'yellow',
        reason: 'stale',
        lastFetchedAt: new Date(row.last_synced_at * 1000),
        message: `Last sync ${Math.floor((now - row.last_synced_at) / 86400)}d ago`,
      }
    }

    return {
      status: 'green',
      lastFetchedAt: new Date(row.last_synced_at * 1000),
    }
  },
}
