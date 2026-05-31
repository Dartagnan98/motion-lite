// /api/crm/contacts/[id] — read / update / delete a single contact.
// Tenant safety: the contact must belong to one of the user's workspaces.
//
// PATCH allow-list is the canonical safe edit surface for crm_contacts.
// Excluded deliberately (sensitive / derived / system): id, public_id,
// workspace_id, created_at, updated_at, last_contacted_at (runtime-set),
// inbox_archived_at (set by inbox archive), referring_affiliate_id,
// referring_affiliate_link_id, external_instagram_id.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getContact, updateContact, deleteContact, getContactTimeline, getUserWorkspaces } from '@/lib/db'

async function authOwnedContact(idOrPublicId: string) {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const contact = getContact(idOrPublicId)
  if (!contact) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const wsIds = new Set(getUserWorkspaces(user.id).map((w) => w.id))
  if (!wsIds.has(contact.workspace_id)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { contact }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOwnedContact(id)
  if (r.error) return r.error
  // getContact does SELECT * → all 35 columns flow through.
  return NextResponse.json({ contact: r.contact, timeline: getContactTimeline(r.contact.id) })
}

const ALLOWED_CONTACT_PATCH_KEYS = [
  // Identity & professional
  'name', 'email', 'phone', 'company', 'job_title', 'website',
  // Linkage
  'company_id', 'client_profile_id', 'owner_id', 'pipeline_stage_id', 'lifecycle_stage',
  // Communication
  'unsubscribed', 'dnd_sms', 'dnd_email', 'dnd_calls', 'tags', 'source',
  // Profile
  'birthday', 'timezone', 'address_line1', 'city', 'state', 'zip', 'country',
  // Notes + power feature
  'notes', 'custom_fields',
] as const

const LIFECYCLE_STAGES = ['lead', 'mql', 'sql', 'customer', 'churned', 'other'] as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BIRTHDAY_RE = /^(?:\d{4}-)?\d{2}-\d{2}$/
const URL_PREFIX_RE = /^https?:\/\//i

function coerceBool(v: unknown): 0 | 1 {
  return v ? 1 : 0
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOwnedContact(id)
  if (r.error) return r.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const data: Record<string, unknown> = {}

  for (const k of ALLOWED_CONTACT_PATCH_KEYS) {
    if (!(k in body)) continue
    const v = body[k]

    // ── Validation per spec ─────────────────────────────────────────────
    if (k === 'email') {
      if (v !== null && typeof v === 'string' && v.trim() !== '' && !EMAIL_RE.test(v.trim())) {
        return NextResponse.json({ error: 'invalid email' }, { status: 400 })
      }
      data[k] = typeof v === 'string' ? v.trim() || null : null
      continue
    }

    if (k === 'website') {
      if (v === null || (typeof v === 'string' && v.trim() === '')) {
        data[k] = null
      } else if (typeof v === 'string') {
        const trimmed = v.trim()
        data[k] = URL_PREFIX_RE.test(trimmed) ? trimmed : `https://${trimmed}`
      } else {
        return NextResponse.json({ error: 'invalid website' }, { status: 400 })
      }
      continue
    }

    if (k === 'lifecycle_stage') {
      if (v === null || v === '') { data[k] = null; continue }
      if (typeof v !== 'string' || !(LIFECYCLE_STAGES as readonly string[]).includes(v)) {
        return NextResponse.json({ error: 'invalid lifecycle_stage' }, { status: 400 })
      }
      data[k] = v
      continue
    }

    if (k === 'unsubscribed' || k === 'dnd_sms' || k === 'dnd_email' || k === 'dnd_calls') {
      data[k] = coerceBool(v)
      continue
    }

    if (k === 'birthday') {
      if (v === null || (typeof v === 'string' && v.trim() === '')) { data[k] = null; continue }
      if (typeof v !== 'string' || !BIRTHDAY_RE.test(v.trim())) {
        return NextResponse.json({ error: 'invalid birthday (use YYYY-MM-DD or MM-DD)' }, { status: 400 })
      }
      data[k] = v.trim()
      continue
    }

    if (k === 'custom_fields') {
      if (v === null) { data[k] = '{}'; continue }
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return NextResponse.json({ error: 'custom_fields must be a JSON object' }, { status: 400 })
          }
          data[k] = JSON.stringify(parsed)
        } catch {
          return NextResponse.json({ error: 'custom_fields invalid JSON' }, { status: 400 })
        }
      } else if (typeof v === 'object' && !Array.isArray(v)) {
        try { data[k] = JSON.stringify(v) }
        catch { return NextResponse.json({ error: 'custom_fields not serializable' }, { status: 400 }) }
      } else {
        return NextResponse.json({ error: 'custom_fields must be object or JSON string' }, { status: 400 })
      }
      continue
    }

    if (k === 'company_id' || k === 'client_profile_id' || k === 'owner_id' || k === 'pipeline_stage_id') {
      if (v === null) { data[k] = null; continue }
      if (!isPositiveInt(v)) {
        return NextResponse.json({ error: `${k} must be a positive integer or null` }, { status: 400 })
      }
      data[k] = v
      continue
    }

    // Free-form text (name, phone, company, job_title, source, timezone,
    // address_line1, city, state, zip, country, notes, tags).
    data[k] = v
  }

  const contact = updateContact(r.contact.id, data)
  return NextResponse.json({ contact })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOwnedContact(id)
  if (r.error) return r.error
  deleteContact(r.contact.id)
  return NextResponse.json({ ok: true })
}
