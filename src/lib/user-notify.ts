/**
 * Unified per-user notification dispatcher.
 *
 * Every hook point calls `notifyUser` after its own business logic. This
 * checks the user's per-kind preference (`in_app` / `email`) and writes the
 * row + queues an email only when allowed. Push is tracked as a pref column
 * for forward-compat but is not actually delivered yet.
 *
 * Hook points fan out via the helpers at the bottom of this file
 * (`notifyContactOwner`, `extractMentionedUserIds`) so callers don't have to
 * repeat the same owner-lookup + href-building boilerplate.
 */

import nodemailer from 'nodemailer'
import {
  createUserNotification,
  getUserNotificationPrefs,
  getCrmContactById,
  getActiveEmailAccounts,
  getDb,
  type CrmContactRecord,
  type UserNotification,
  type UserNotificationKind,
} from './db'
import { decryptSmtpPassword } from './crm-email'

export interface NotifyUserInput {
  user_id: number
  workspace_id: number
  kind: UserNotificationKind
  title: string
  body?: string | null
  href?: string | null
  entity?: string | null
  entity_id?: number | null
}

function getAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:4000'
}

function getUserEmailById(userId: number): { email: string; name: string } | null {
  const row = getDb()
    .prepare('SELECT email, name FROM users WHERE id = ?')
    .get(userId) as { email: string; name: string } | undefined
  return row ?? null
}

/**
 * Write an in-app notification row + optionally fire an email, subject to
 * the user's per-kind preferences. Never throws — hooks must stay resilient.
 */
export function notifyUser(input: NotifyUserInput): UserNotification | null {
  try {
    if (!input.user_id || !input.workspace_id) return null
    const prefs = getUserNotificationPrefs(input.user_id)[input.kind]
    if (!prefs || !prefs.in_app) {
      // In-app off for this kind — skip row. Still try email if that's on.
      if (prefs?.email) sendCrmEmail(input).catch(() => {})
      return null
    }
    const row = createUserNotification(input)
    if (prefs.email) sendCrmEmail(input).catch(() => {})
    return row
  } catch {
    return null
  }
}

/**
 * Plain-text email with the notification title + a link back into the CRM.
 * Uses the workspace's first active SMTP-ish email account. Silently no-ops
 * when no account is configured or the user has no email on file.
 */
export async function sendCrmEmail(input: NotifyUserInput): Promise<void> {
  const user = getUserEmailById(input.user_id)
  if (!user?.email) return
  const accounts = getActiveEmailAccounts(input.workspace_id, { includeSecrets: true })
  const account = accounts.find((a) =>
    a.smtp_host && a.smtp_port && a.smtp_user && a.smtp_pass_encrypted,
  )
  if (!account || !account.smtp_host || !account.smtp_port
      || !account.smtp_user || !account.smtp_pass_encrypted) {
    return
  }
  const origin = getAppOrigin()
  const link = input.href ? `${origin}${input.href}` : origin
  const htmlEscape = (s: string) => s
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const parts = [
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.45">${htmlEscape(input.title)}</p>`,
    input.body ? `<p style="margin:0 0 16px 0;color:#6b6b6b;font-size:13px;line-height:1.55">${htmlEscape(input.body)}</p>` : '',
    `<p style="margin:0;font-size:13px"><a href="${link}" style="color:#D97757">Open in Motion Lite →</a></p>`,
  ].filter(Boolean).join('')
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: {
        user: account.smtp_user,
        pass: decryptSmtpPassword(account.smtp_pass_encrypted),
      },
    })
    await transporter.sendMail({
      from: `${account.label} <${account.email}>`,
      to: user.email,
      subject: `[Motion Lite] ${input.title}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif">${parts}</div>`,
    })
  } catch {
    /* Email delivery failures never break the hook point. */
  }
}

// ─── Helpers: resolve owner + notify in one call ────────────────────────

/**
 * Notify the contact's owner_id (if set) about an event tied to the contact.
 * No-op when the contact has no owner or doesn't belong to the workspace.
 */
export function notifyContactOwner(
  workspaceId: number,
  contactId: number,
  kind: UserNotificationKind,
  build: (contact: CrmContactRecord) => Omit<NotifyUserInput, 'user_id' | 'workspace_id' | 'kind'>,
): void {
  try {
    const contact = getCrmContactById(contactId, workspaceId)
    if (!contact || !contact.owner_id) return
    const payload = build(contact)
    notifyUser({
      user_id: contact.owner_id,
      workspace_id: workspaceId,
      kind,
      ...payload,
    })
  } catch {
    /* resilient */
  }
}

/**
 * Parse @username tokens out of a note body. Returns a list of user ids
 * matched by exact email-prefix (e.g. `@jane` → `jane@...`), case-insensitive
 * name (spaces stripped), or full-email lookup. De-duplicates.
 */
export function extractMentionedUserIds(
  body: string,
  candidateUsers: Array<{ id: number; email: string; name: string }>,
): number[] {
  if (!body) return []
  const mentions = Array.from(body.matchAll(/@([a-zA-Z0-9._+-]+)/g)).map((m) => m[1].toLowerCase())
  if (mentions.length === 0) return []
  const matched = new Set<number>()
  for (const tok of mentions) {
    for (const user of candidateUsers) {
      const emailPrefix = (user.email.split('@')[0] || '').toLowerCase()
      const nameSlug = user.name.replace(/\s+/g, '').toLowerCase()
      if (tok === emailPrefix || tok === nameSlug || tok === user.email.toLowerCase()) {
        matched.add(user.id)
      }
    }
  }
  return Array.from(matched)
}
