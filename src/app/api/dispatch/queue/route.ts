import { NextRequest, NextResponse } from 'next/server'
import { getDb, getDispatchDependencies } from '@/lib/db'
import type { DispatchItem } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { getSetting, setSetting } from '@/lib/settings'

/**
 * If this dispatch is part of a pipeline, its prompt gets a block of prior
 * steps' result_summaries prepended so the claimed agent reads upstream
 * output as context. Deps not in a terminal "have something to pass along"
 * state (done, needs_review, approved) are skipped with a placeholder.
 */
function buildPipelineContext(dispatchId: number, originalInput: string | null): string | null {
  const deps = getDispatchDependencies(dispatchId)
  if (deps.length === 0) return originalInput
  const blocks: string[] = []
  for (const d of deps) {
    const agentLabel = d.agent_id ? d.agent_id.charAt(0).toUpperCase() + d.agent_id.slice(1) : 'Previous step'
    const titleSuffix = d.task_title ? ` — ${d.task_title}` : ''
    const body = (d.result_summary || '').trim()
    if (body) {
      blocks.push(`--- ${agentLabel}${titleSuffix} (status: ${d.status}) ---\n${body}`)
    } else {
      blocks.push(`--- ${agentLabel}${titleSuffix} (status: ${d.status}) ---\n[no summary captured]`)
    }
  }
  const prefix = [
    'Context from prior pipeline steps:',
    '',
    blocks.join('\n\n'),
    '',
    '---',
    '',
    'Your task:',
    '',
  ].join('\n')
  return prefix + (originalInput || '')
}

function authenticateBridge(request: NextRequest): boolean {
  const secret = request.headers.get('x-bridge-secret')
  return !!secret && secret === process.env.BRIDGE_SECRET
}

const STALE_WORKING_SECONDS = Math.max(60, Number(process.env.DISPATCH_STALE_WORKING_SECONDS || 240))

export async function GET(request: NextRequest) {
  const isBridge = authenticateBridge(request)
  const d = getDb()
  const now = Math.floor(Date.now() / 1000)

  // Bridge worker mode: claim exactly one queued item atomically.
  if (isBridge) {
    setSetting('dispatchBridgeLastPoll', now)
    const workerId = request.headers.get('x-bridge-worker') || 'bridge-worker'

    const restartToken = Number(getSetting<number>('dispatchBridgeRestartToken') || 0)
    const autoApprove = (() => {
      const raw = getSetting<unknown>('dispatchAutoApprove')
      if (typeof raw === 'boolean') return raw
      return process.env.DISPATCH_AUTO_APPROVE !== 'false'
    })()

    const selectBaseSql = `
    SELECT dq.*,
      t.title as task_title,
      t.description as task_description,
      t.priority as task_priority,
      t.labels as task_labels,
      p.name as project_name
    FROM dispatch_queue dq
    LEFT JOIN tasks t ON dq.task_id = t.id
    LEFT JOIN projects p ON t.project_id = p.id
  `

    // Pipeline guard: skip any dispatch whose upstream deps aren't all done.
    // needs_review and approved also count as "has result_summary" → passable
    // downstream. failed/cancelled deps leave the dispatch stuck in queued
    // (the user sees "Waiting on <agent>" and decides to restart or cancel).
    const selectOneSql = `
      ${selectBaseSql}
      WHERE dq.status = 'queued'
        AND COALESCE(dq.run_type, 'single') != 'team_parent'
        AND (dq.next_retry_at IS NULL OR dq.next_retry_at <= ?)
        AND NOT EXISTS (
          SELECT 1 FROM dispatch_dependencies dd
          JOIN dispatch_queue dep ON dep.id = dd.depends_on_dispatch_id
          WHERE dd.dispatch_id = dq.id
            AND dep.status NOT IN ('done', 'approved', 'needs_review')
        )
      ORDER BY dq.priority ASC, dq.created_at ASC
      LIMIT 1
    `

    const selectByIdSql = `
      ${selectBaseSql}
      WHERE dq.id = ?
      LIMIT 1
    `

    const claimOne = d.transaction(() => {
      const staleCutoff = now - STALE_WORKING_SECONDS
      const reclaimed = d.prepare(`
        UPDATE dispatch_queue
        SET status = 'queued',
            started_at = NULL,
            completed_at = NULL,
            worker_id = NULL,
            heartbeat_at = NULL,
            error = CASE
              WHEN error IS NULL OR error = '' THEN 'Previous worker became stale; task reclaimed automatically'
              ELSE error
            END
        WHERE status = 'working'
          AND (
            (heartbeat_at IS NOT NULL AND heartbeat_at <= ?)
            OR (heartbeat_at IS NULL AND started_at IS NOT NULL AND started_at <= ?)
          )
      `).run(staleCutoff, staleCutoff).changes

      const candidate = d.prepare(selectOneSql).get(now) as (DispatchItem & { task_title?: string; task_description?: string; task_priority?: string; task_labels?: string; project_name?: string }) | undefined
      if (!candidate) return { dispatch: undefined, reclaimed }

      const claimed = d.prepare(`
        UPDATE dispatch_queue
        SET status = 'working',
            started_at = ?,
            completed_at = NULL,
            error = NULL,
            next_retry_at = NULL,
            worker_id = ?,
            heartbeat_at = ?,
            attempt_count = COALESCE(attempt_count, 0) + 1
        WHERE id = ? AND status = 'queued'
      `).run(now, workerId, now, candidate.id)

      if (claimed.changes === 0) return { dispatch: undefined, reclaimed }

      const dispatch = d.prepare(selectByIdSql).get(candidate.id) as (DispatchItem & { task_title?: string; task_description?: string; task_priority?: string; task_labels?: string; project_name?: string }) | undefined
      return { dispatch, reclaimed }
    })

    const { dispatch, reclaimed } = claimOne()
    if (!dispatch) {
      return NextResponse.json({
        dispatches: [],
        lastPoll: now,
        workerId,
        reclaimed,
        restartToken,
        autoApprove,
      })
    }

    // If this dispatch has upstream deps, prepend their result_summaries as
    // "Context from prior pipeline steps" so the agent sees what came before
    // without the user having to re-paste it. Non-mutating: only the payload
    // sent to the bridge is changed; stored input_context stays pristine so
    // the chat UI shows the original prompt.
    const augmentedInput = buildPipelineContext(dispatch.id, dispatch.input_context || null)
    const payload = augmentedInput !== dispatch.input_context
      ? { ...dispatch, input_context: augmentedInput }
      : dispatch

    return NextResponse.json({
      dispatches: [payload],
      lastPoll: now,
      workerId,
      reclaimed,
      restartToken,
      autoApprove,
    })
  }

  // Authenticated app mode: return bridge health + queue summary.
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lastPollRaw = getSetting<unknown>('dispatchBridgeLastPoll')
  const lastPoll = typeof lastPollRaw === 'number' ? lastPollRaw : null
  const pollAge = lastPoll ? now - lastPoll : null
  const online = pollAge !== null && pollAge < 120
  const restartToken = Number(getSetting<number>('dispatchBridgeRestartToken') || 0)
  const autoApprove = (() => {
    const raw = getSetting<unknown>('dispatchAutoApprove')
    if (typeof raw === 'boolean') return raw
    return process.env.DISPATCH_AUTO_APPROVE !== 'false'
  })()

  const counts = d.prepare(`
    SELECT status, COUNT(*) AS count
    FROM dispatch_queue
    WHERE status != 'cancelled'
      AND COALESCE(run_type, 'single') != 'team_child'
    GROUP BY status
  `).all() as { status: string; count: number }[]

  const queueCounts = counts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count
    return acc
  }, {})

  return NextResponse.json({
    online,
    lastPoll,
    pollAgeSeconds: pollAge,
    restartToken,
    autoApprove,
    queueCounts,
  })
}
