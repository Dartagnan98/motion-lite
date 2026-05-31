// POST /api/platform/accounts
//
// Tenant-scoped. Phase C: creates/promotes a client_profiles row into the
// platform (tenant_id + platform_public_id + agency_id + platform_status set)
// and optionally a platform_domains row when domainUrl is provided.
//
// Two paths:
//   1. body.clientProfileId set → promote that existing client_profiles row
//      (the new /clients/new flow uses this — Phase B path).
//   2. clientProfileId omitted → create a new client_profiles row from scratch
//      (legacy /platform/clients/new path; redirects forward but still gets hit
//      by direct callers).
//
// Body: { name: string, domainUrl?: string, clientProfileId?: number }
// Response: { id: number, name: string }    // id is client_profiles.id

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  ensureTenantForWorkspace,
  buildActiveAccountCookie,
} from '@/lib/platform/tenant'
import { getDb, generatePublicId } from '@/lib/db'

export async function POST(req: NextRequest) {
  let body: { name?: unknown; domainUrl?: unknown; clientProfileId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.length > 100) {
    return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 })
  }

  const domainUrl =
    typeof body.domainUrl === 'string' && body.domainUrl.trim()
      ? body.domainUrl.trim().replace(/\/+$/, '')
      : null

  const clientProfileId =
    typeof body.clientProfileId === 'number' && body.clientProfileId > 0
      ? body.clientProfileId
      : null

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)
    const db = getDb()

    // Resolve agency for this tenant (required FK on client_profiles.agency_id
    // for platform-enrolled clients).
    const agencyRow = db
      .prepare(`SELECT id FROM platform_agencies WHERE tenant_id = ? AND status = 'active' ORDER BY id LIMIT 1`)
      .get(tenant.id) as { id: number } | undefined

    if (!agencyRow) {
      return NextResponse.json(
        { error: 'No agency found for this tenant. Run scripts/seed-glenvalley.mjs first.' },
        { status: 400 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    let accountId: number

    if (clientProfileId) {
      // Phase B path: promote an existing client_profiles row into the platform.
      // Verify the row exists; otherwise reject (we don't blindly trust the body).
      const existing = db.prepare(
        `SELECT id, tenant_id, name FROM client_profiles WHERE id = ?`
      ).get(clientProfileId) as { id: number; tenant_id: number | null; name: string } | undefined

      if (!existing) {
        return NextResponse.json({ error: 'clientProfileId not found' }, { status: 400 })
      }
      if (existing.tenant_id && existing.tenant_id !== tenant.id) {
        return NextResponse.json({ error: 'clientProfileId belongs to a different tenant' }, { status: 403 })
      }

      db.prepare(
        `UPDATE client_profiles
            SET tenant_id          = ?,
                platform_public_id = COALESCE(platform_public_id, ?),
                agency_id          = COALESCE(agency_id, ?),
                platform_status    = COALESCE(platform_status, 'active'),
                -- Persist the domain on the client record itself so it's part
                -- of the client's known info + reusable when connecting future
                -- tools (don't clobber an existing website).
                website            = COALESCE(NULLIF(website, ''), ?),
                updated_at         = ?
          WHERE id = ?`
      ).run(tenant.id, generatePublicId(), agencyRow.id, domainUrl || null, now, existing.id)

      accountId = existing.id
    } else {
      // Legacy path: insert a new client_profiles row from scratch.
      // Build a URL-safe slug; the column is UNIQUE, so retry on collision with a suffix.
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client'
      let slug = baseSlug
      let attempt = 0
      while (db.prepare(`SELECT id FROM client_profiles WHERE slug = ?`).get(slug)) {
        attempt++
        slug = `${baseSlug}-${attempt}`
        if (attempt > 50) {
          return NextResponse.json({ error: 'Could not generate a unique slug for this client name' }, { status: 500 })
        }
      }

      const result = db
        .prepare(
          `INSERT INTO client_profiles
             (name, slug, tenant_id, platform_public_id, agency_id, platform_status, website, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
        )
        .run(name, slug, tenant.id, generatePublicId(), agencyRow.id, domainUrl || null, now, now)

      accountId = Number(result.lastInsertRowid)
    }

    // Optionally insert domain row.
    if (domainUrl) {
      const domainName = (() => {
        try {
          return new URL(domainUrl.startsWith('http') ? domainUrl : `https://${domainUrl}`).hostname
        } catch {
          return domainUrl
        }
      })()
      db.prepare(
        `INSERT INTO platform_domains
           (tenant_id, public_id, account_id, name, url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(tenant.id, generatePublicId(), accountId, domainName, domainUrl, now, now)
    }

    // Set the new account as active by writing the signed cookie in the response.
    const cookieValue = buildActiveAccountCookie(tenant.id, accountId)
    const response = NextResponse.json({ id: accountId, name })
    response.cookies.set('hiilite_active_account_id', cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[api/platform/accounts]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
