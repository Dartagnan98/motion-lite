import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmContact,
  createCrmWorkflowRun,
  getCrmContactById,
  getCrmContactByEmail,
} from '@/lib/db'

/**
 * Public webhook ingress.
 * Any external system (Zapier, Make, a custom backend, another CRM) can POST here
 * to fire a workflow for a specific contact. Auth is via the per-workflow token.
 *
 *   POST /api/webhooks/workflows/:id?token=xxxx
 *   Body: arbitrary JSON. The trigger's `contact_id_path` filter tells us where
 *         to read the contact id. If blank, we look at `contact_id` / `email` /
 *         `phone` at the top level of the payload.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workflowId = Number(id)
  if (!Number.isFinite(workflowId) || workflowId <= 0) {
    return NextResponse.json({ error: 'Invalid workflow id' }, { status: 400 })
  }

  const url = new URL(request.url)
  const token = (url.searchParams.get('token') || request.headers.get('x-workflow-token') || '').trim()
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 401 })

  // Load workflow without a workspace check — we re-derive workspace from the row itself.
  // This avoids exposing the CRM auth cookie to third parties.
  const raw = await loadWorkflow(workflowId)
  if (!raw) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  if (raw.webhook_token !== token) return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  if (raw.trigger_type !== 'webhook_received') {
    return NextResponse.json({ error: 'This workflow is not configured for webhook ingress' }, { status: 409 })
  }
  if (!raw.is_active) return NextResponse.json({ error: 'Workflow is paused' }, { status: 409 })

  let payload: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text.trim()) payload = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }

  const contactIdPath = readJsonString(payload, 'contact_id_path') // ignored — filter comes from workflow, not body
  void contactIdPath

  const contact = resolveContact(raw.workspace_id, payload, raw.trigger_value)
  if (!contact) {
    return NextResponse.json({
      error: 'Could not resolve a contact from the payload',
      hint: 'Pass contact_id, email, or phone at the top level — or configure a JSON path in the trigger.',
    }, { status: 422 })
  }

  const now = Math.floor(Date.now() / 1000)
  const run = createCrmWorkflowRun({
    workflow_id: raw.id,
    workspace_id: raw.workspace_id,
    contact_id: contact.id,
    next_node_id: null,
    run_at: now,
    status: 'queued',
  })

  return NextResponse.json({ enrolled: true, contact_id: contact.id, run_id: run?.id ?? null })
}

async function loadWorkflow(id: number) {
  // No workspace filter — the DB helper insists on one. Use a direct read.
  const { getDb } = await import('@/lib/db')
  const row = getDb().prepare('SELECT * FROM crm_workflows WHERE id = ?').get(id) as
    | { id: number; workspace_id: number; webhook_token: string | null; trigger_type: string; trigger_value: string; is_active: number }
    | undefined
  return row || null
}

function resolveContact(workspaceId: number, payload: Record<string, unknown>, jsonPath: string | null | undefined) {
  if (jsonPath && jsonPath.trim()) {
    const fromPath = readByPath(payload, jsonPath.trim())
    const asNumber = Number(fromPath)
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return getCrmContactById(asNumber, workspaceId)
    }
  }

  const contactId = readJsonNumber(payload, 'contact_id')
  if (contactId) {
    const byId = getCrmContactById(contactId, workspaceId)
    if (byId) return byId
  }

  const email = readJsonString(payload, 'email')
  if (email) {
    const byEmail = getCrmContactByEmail(workspaceId, email)
    if (byEmail) return byEmail
  }

  const phone = readJsonString(payload, 'phone')
  // No phone lookup helper yet — fall through to upsert if we have a phone-only payload.

  // Upsert a new contact if we have at least an email or phone.
  if (email || phone) {
    const first = readJsonString(payload, 'first_name') || ''
    const last = readJsonString(payload, 'last_name') || ''
    const name = readJsonString(payload, 'name') || [first, last].filter(Boolean).join(' ').trim() || email || phone || 'Webhook contact'
    return createCrmContact({
      workspaceId,
      name,
      email: email || null,
      phone: phone || null,
      company: readJsonString(payload, 'company') || null,
    })
  }

  return null
}

function readJsonString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key]
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function readJsonNumber(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key]
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function readByPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cursor: unknown = root
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}
