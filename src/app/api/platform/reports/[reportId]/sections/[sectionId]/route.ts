// PATCH /api/platform/reports/[reportId]/sections/[sectionId]
//
// Per-section settings writes. Currently only accepts `periodOverride` — the
// per-section date window that lets a section show data from a different
// range than the report's top-level period (Slice A: per-section refresh +
// period override).
//
// Body:
//   { periodOverride: { periodStart: 'YYYY-MM-DD', periodEnd: 'YYYY-MM-DD' } }
//     → set/replace the override under `settings_json.periodOverride`
//   { periodOverride: null }
//     → clear the override (delete the key from settings_json)
//
// The endpoint MERGES into settings_json — other keys are preserved on a
// partial write. periodEnd must be >= periodStart, both ISO YYYY-MM-DD.
//
// NOTE: A periodOverride on a section backed by a POINT_IN_TIME_PROVIDERS
// integration (pagespeed, se_ranking) is accepted into settings but is a
// no-op at render time — those providers have no period semantics. The
// frontend can still show the override badge if it wants to surface the
// stored value, but resolveSectionPeriod() drops it on read.
//
// Response: { ok: true, settings: SectionSettings }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { parseSectionSettings, type SectionSettings } from '@/lib/platform/reports'
import { getDb } from '@/lib/db'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string; sectionId: string }> }
) {
  const { reportId: reportIdStr, sectionId: sectionIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  const sectionId = parseInt(sectionIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }
  if (isNaN(sectionId) || sectionId <= 0) {
    return NextResponse.json({ error: 'Invalid sectionId' }, { status: 400 })
  }

  let body: { periodOverride?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Body must contain a `periodOverride` key (either an object OR null).
  // We use `in` rather than truthiness so explicit-null clears work.
  if (!('periodOverride' in body)) {
    return NextResponse.json(
      { error: 'body must include periodOverride (object or null)' },
      { status: 400 }
    )
  }

  // Validate the periodOverride payload BEFORE auth/tenant checks so callers
  // get a clean 400 on malformed input rather than a 404.
  type NextOverride = { periodStart: string; periodEnd: string } | null | 'clear'
  let nextOverride: NextOverride
  const raw = body.periodOverride
  if (raw === null) {
    nextOverride = 'clear'
  } else if (typeof raw === 'object' && raw !== null) {
    const r = raw as { periodStart?: unknown; periodEnd?: unknown }
    if (typeof r.periodStart !== 'string' || !ISO_DATE_RE.test(r.periodStart)) {
      return NextResponse.json({ error: 'periodOverride.periodStart must be YYYY-MM-DD' }, { status: 400 })
    }
    if (typeof r.periodEnd !== 'string' || !ISO_DATE_RE.test(r.periodEnd)) {
      return NextResponse.json({ error: 'periodOverride.periodEnd must be YYYY-MM-DD' }, { status: 400 })
    }
    if (r.periodEnd < r.periodStart) {
      return NextResponse.json({ error: 'periodOverride.periodEnd must be >= periodStart' }, { status: 400 })
    }
    nextOverride = { periodStart: r.periodStart, periodEnd: r.periodEnd }
  } else {
    return NextResponse.json(
      { error: 'periodOverride must be an object {periodStart, periodEnd} or null' },
      { status: 400 }
    )
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
    assertTenantOwnsRow(tenant, 'platform_report_sections', sectionId)
  } catch {
    return NextResponse.json({ error: 'Report or section not found / access denied' }, { status: 404 })
  }

  const db = getDb()

  // Confirm the section actually belongs to this report (a section row could
  // be tenant-owned but live under a different report).
  const row = db.prepare(
    `SELECT id, report_id, settings_json
       FROM platform_report_sections
      WHERE id = ? AND tenant_id = ?`
  ).get(sectionId, tenant.id) as { id: number; report_id: number; settings_json: string | null } | undefined
  if (!row || row.report_id !== reportId) {
    return NextResponse.json({ error: 'Section not found in this report' }, { status: 404 })
  }

  // Merge: preserve any other keys the blob already carries.
  const current: SectionSettings = parseSectionSettings(row.settings_json)
  const next: SectionSettings = { ...current }
  if (nextOverride === 'clear') {
    delete next.periodOverride
  } else {
    next.periodOverride = nextOverride
  }

  // Empty object → store NULL to keep the column tidy.
  const nextJson = Object.keys(next).length === 0 ? null : JSON.stringify(next)
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `UPDATE platform_report_sections
        SET settings_json = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`
  ).run(nextJson, now, sectionId, tenant.id)

  return NextResponse.json({ ok: true, settings: next })
}
