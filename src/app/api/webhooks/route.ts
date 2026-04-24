import { NextRequest, NextResponse } from 'next/server'
import { fireWebhook } from '@/lib/webhook'
import {
  getWebhooks, createWebhook, updateWebhook, deleteWebhook,
  getExternalTokens, createExternalToken, deleteExternalToken,
} from '@/lib/db'
import { requireOwner } from '@/lib/auth'

// GET /api/webhooks - List webhooks and tokens
export async function GET(req: NextRequest) {
  try { await requireOwner() } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const type = req.nextUrl.searchParams.get('type')

  if (type === 'tokens') {
    const tokens = getExternalTokens()
    // Mask token values (show first 10 chars only)
    const masked = tokens.map(t => ({
      ...t,
      token: t.token.slice(0, 10) + '...',
      scopes: JSON.parse(t.scopes || '[]'),
    }))
    return NextResponse.json({ tokens: masked })
  }

  const webhooks = getWebhooks().map(w => ({
    ...w,
    events: JSON.parse(w.events || '[]'),
  }))

  const availableEvents = [
    'task.created', 'task.updated', 'task.completed', 'task.deleted',
    'doc.created', 'doc.updated',
    'project.created',
    'meeting.imported',
    'schedule.rearranged',
    '*',
  ]

  const availableScopes = [
    'tasks:read', 'tasks:write',
    'docs:read', 'docs:write',
    'projects:read',
    'meetings:read', 'meetings:write',
    '*',
  ]

  return NextResponse.json({ webhooks, availableEvents, availableScopes })
}

// POST /api/webhooks - Create webhook or token
export async function POST(req: NextRequest) {
  try { await requireOwner() } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()

    // Create external API token
    if (body.type === 'token') {
      if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      const scopes = body.scopes || ['*']
      const token = createExternalToken({ name: body.name, scopes })
      // Return full token only on creation (never shown again)
      return NextResponse.json({
        ...token,
        scopes: JSON.parse(token.scopes || '[]'),
      }, { status: 201 })
    }

    // Create webhook
    if (!body.name || !body.url) {
      return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
    }
    const webhook = createWebhook({
      name: body.name,
      url: body.url,
      events: body.events || ['*'],
      secret: body.secret,
    })
    return NextResponse.json({
      ...webhook,
      events: JSON.parse(webhook.events || '[]'),
    }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
  }
}

// PATCH /api/webhooks - Update webhook
export async function PATCH(req: NextRequest) {
  try { await requireOwner() } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { id, ...data } = body
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    if (data.events && Array.isArray(data.events)) {
      data.events = JSON.stringify(data.events)
    }
    updateWebhook(id, data)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
  }
}

// DELETE /api/webhooks?id=123&type=webhook|token
export async function DELETE(req: NextRequest) {
  try { await requireOwner() } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = Number(req.nextUrl.searchParams.get('id'))
  const type = req.nextUrl.searchParams.get('type') || 'webhook'
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (type === 'token') {
    deleteExternalToken(id)
  } else {
    deleteWebhook(id)
  }

  return NextResponse.json({ ok: true })
}
