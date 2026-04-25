import { getSetting } from './settings'

export type WebhookEvent =
  | 'task.created'
  | 'task.completed'
  | 'task.updated'
  | 'task.deleted'
  | 'schedule.rearranged'

export async function fireWebhook(
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const url = getSetting<string>('webhookUrl')
    if (!url) return

    const body = JSON.stringify({
      event,
      payload,
      timestamp: new Date().toISOString(),
    })

    const opts: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }

    const attempt = async () => {
      const res = await fetch(url, opts)
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`)
    }

    try {
      await attempt()
    } catch {
      // Retry once after 5 seconds
      setTimeout(async () => {
        try {
          await attempt()
        } catch (e) {
          console.error(`[webhook] retry failed for ${event}:`, e)
        }
      }, 5000)
    }
  } catch (e) {
    console.error(`[webhook] error firing ${event}:`, e)
  }
}
