import { getSetting } from '@/lib/settings'

export type NotifyReason =
  | 'enqueue'
  | 'enqueue_team'
  | 'pipeline'
  | 'complete'
  | 'requeue'
  | 'redispatch'
  | 'schedule'
  | 'schedule-heartbeat'
  | 'schedule-multistep'
  | 'tool-forward'

export interface NotifyPayload {
  event: string
  reason: NotifyReason
  dispatch_id?: number
  dispatch_ids?: number[]
  task_id?: number | null
  task_title?: string | null
  agent_id?: string | null
  schedule_id?: number
  schedule_name?: string
  parent_task_id?: number | null
  tool_invocation_id?: number
  tool_name?: string
}

const PUSH_TIMEOUT_MS = 1500

/**
 * Fire-and-forget push to the Mac dispatch-bridge push listener so it wakes
 * up from its 30s poll sleep and claims work immediately. The bridge is at
 * `dispatchWebhookUrl` setting (or DISPATCH_BRIDGE_PUSH_URL env var) and
 * authenticates with `x-push-token` matching the bridge's DISPATCH_PUSH_TOKEN.
 *
 * Never throws. If the bridge is offline the 30s poll still catches up.
 */
export function notifyBridge(payload: NotifyPayload): void {
  const url = getSetting<string>('dispatchWebhookUrl') || process.env.DISPATCH_BRIDGE_PUSH_URL || ''
  if (!url) return

  const token = getSetting<string>('dispatchWebhookToken') || process.env.DISPATCH_BRIDGE_PUSH_TOKEN || ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['x-push-token'] = token

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS)

  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch(() => { /* bridge offline or slow; poll fallback handles it */ })
    .finally(() => clearTimeout(timer))
}
