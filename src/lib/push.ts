/**
 * Web Push notification utility for Motion Lite
 * Uses VAPID keys for web push + notification_queue for desktop polling
 */

import { getDb } from './db'

interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

interface PushSubscriptionRow {
  id: number
  endpoint: string
  keys_p256dh: string
  keys_auth: string
}

/**
 * Send a push notification to all subscribed clients.
 * Also queues for desktop app polling.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  const db = getDb()

  // Queue for desktop app polling
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS notification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`)
    db.prepare('INSERT INTO notification_queue (title, body, url) VALUES (?, ?, ?)').run(
      payload.title, payload.body, payload.url || '/'
    )
    // Clean old notifications (older than 1 hour)
    db.prepare('DELETE FROM notification_queue WHERE created_at < strftime(\'%s\',\'now\') - 3600').run()
  } catch {}

  // Web push
  try {
    const webpush = require('web-push')
    const vapidPublic = process.env.VAPID_PUBLIC_KEY
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

    if (!vapidPublic || !vapidPrivate) return

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

    const subs = db.prepare('SELECT id, endpoint, keys_p256dh, keys_auth FROM push_subscriptions').all() as PushSubscriptionRow[]
    const jsonPayload = JSON.stringify(payload)

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          jsonPayload
        )
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id)
        }
      }
    }
  } catch {
    // web-push not installed or other error
  }
}
