// POST /api/platform/reports/[reportId]/set-period
//
// Updates period_start + period_end on a report row, plus the optional
// explicit comparison window (GA-style picker).
// Tenant-scoped via assertTenantOwnsRow — no cross-tenant writes.
//
// Body:
//   {
//     periodStart: 'YYYY-MM-DD',
//     periodEnd:   'YYYY-MM-DD',
//     comparePeriodStart?: 'YYYY-MM-DD' | null,
//     comparePeriodEnd?:   'YYYY-MM-DD' | null,
//   }
//
// Compare-window semantics:
//   - Either both compare fields are set (ISO strings) or both null. Half-set
//     state is a 400 — prevents drift between "explicit compare set" and the
//     auto-computed default.
//   - When set, comparePeriodEnd MUST be strictly before periodStart so the
//     comparison sits entirely before the primary window.
//   - Both null clears the explicit window; renderer falls back to the
//     same-length auto-computed window in src/lib/platform/snapshots.ts.
//
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  let body: {
    periodStart?: unknown
    periodEnd?: unknown
    comparePeriodStart?: unknown
    comparePeriodEnd?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const periodStart = typeof body.periodStart === 'string' ? body.periodStart.trim() : null
  const periodEnd = typeof body.periodEnd === 'string' ? body.periodEnd.trim() : null

  if (!periodStart || !periodEnd || !ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd)) {
    return NextResponse.json(
      { error: 'periodStart and periodEnd are required in ISO YYYY-MM-DD format' },
      { status: 400 }
    )
  }
  if (periodStart > periodEnd) {
    return NextResponse.json({ error: 'periodStart must be before periodEnd' }, { status: 400 })
  }

  // Compare window — optional. Three valid shapes:
  //   - both keys absent             → leave compare columns untouched
  //   - both keys === null           → clear compare columns
  //   - both keys are valid ISO      → set to that window
  // Anything else (only one set, bad ISO, end >= start) is a 400.
  const hasCompareStart = Object.prototype.hasOwnProperty.call(body, 'comparePeriodStart')
  const hasCompareEnd = Object.prototype.hasOwnProperty.call(body, 'comparePeriodEnd')
  const compareKeysProvided = hasCompareStart || hasCompareEnd

  let compareUpdate: { start: string | null; end: string | null } | null = null

  if (compareKeysProvided) {
    if (!hasCompareStart || !hasCompareEnd) {
      return NextResponse.json(
        { error: 'comparePeriodStart and comparePeriodEnd must be provided together (both set or both null)' },
        { status: 400 }
      )
    }
    const rawStart = body.comparePeriodStart
    const rawEnd = body.comparePeriodEnd
    const startIsNull = rawStart === null
    const endIsNull = rawEnd === null

    if (startIsNull !== endIsNull) {
      return NextResponse.json(
        { error: 'comparePeriodStart and comparePeriodEnd must both be null or both be set' },
        { status: 400 }
      )
    }

    if (startIsNull && endIsNull) {
      // Clear the explicit compare window.
      compareUpdate = { start: null, end: null }
    } else {
      const cStart = typeof rawStart === 'string' ? rawStart.trim() : null
      const cEnd = typeof rawEnd === 'string' ? rawEnd.trim() : null
      if (!cStart || !cEnd || !ISO_DATE.test(cStart) || !ISO_DATE.test(cEnd)) {
        return NextResponse.json(
          { error: 'comparePeriodStart and comparePeriodEnd must be ISO YYYY-MM-DD' },
          { status: 400 }
        )
      }
      if (cStart > cEnd) {
        return NextResponse.json(
          { error: 'comparePeriodStart must be before comparePeriodEnd' },
          { status: 400 }
        )
      }
      // The comparison window must sit entirely before the primary window —
      // no overlap, no equal boundary. Lex compare is safe for ISO YYYY-MM-DD.
      if (cEnd >= periodStart) {
        return NextResponse.json(
          { error: 'comparePeriodEnd must be strictly before periodStart' },
          { status: 400 }
        )
      }
      compareUpdate = { start: cStart, end: cEnd }
    }
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  if (compareUpdate !== null) {
    db.prepare(
      `UPDATE platform_reports
          SET period_start = ?, period_end = ?,
              compare_period_start = ?, compare_period_end = ?,
              updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    ).run(
      periodStart, periodEnd,
      compareUpdate.start, compareUpdate.end,
      now, reportId, tenant.id,
    )
  } else {
    // Compare keys absent — preserve existing compare columns.
    db.prepare(
      `UPDATE platform_reports
          SET period_start = ?, period_end = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    ).run(periodStart, periodEnd, now, reportId, tenant.id)
  }

  return NextResponse.json({ ok: true })
}
