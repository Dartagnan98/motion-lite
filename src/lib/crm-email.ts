import crypto from 'crypto'
import type { CrmContactRecord, EmailSend } from '@/lib/db'

/** Canonical placeholder both HTML and plain-text senders can swap. */
export const UNSUBSCRIBE_TOKEN = '{unsubscribe_url}'

function getInternalSecret(): string {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('INTERNAL_API_SECRET must be set to at least 32 characters for CRM email encryption')
  }
  return secret
}

function getAesKey(): Buffer {
  return crypto.createHash('sha256').update(getInternalSecret()).digest()
}

export function encryptSmtpPassword(password: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', getAesKey(), iv)
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSmtpPassword(payload: string): string {
  const [ivHex, cipherHex] = payload.split(':')
  if (!ivHex || !cipherHex) throw new Error('Invalid encrypted SMTP password payload')
  const decipher = crypto.createDecipheriv('aes-256-cbc', getAesKey(), Buffer.from(ivHex, 'hex'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()])
  return decrypted.toString('utf8')
}

export function renderMergeTags(template: string, contact: Pick<CrmContactRecord, 'name' | 'email' | 'company'>): string {
  const firstName = contact.name.trim().split(/\s+/)[0] || contact.name
  return template
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{company}}', contact.company || '')
    .replaceAll('{{email}}', contact.email || '')
}

export function appendOpenTrackingPixel(bodyHtml: string, send: Pick<EmailSend, 'tracking_token'>, origin: string): string {
  const pixelUrl = `${origin}/api/crm/track/open/${encodeURIComponent(send.tracking_token)}`
  const pixel = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;opacity:0" />`
  if (bodyHtml.includes('</body>')) {
    return bodyHtml.replace('</body>', `${pixel}</body>`)
  }
  return `${bodyHtml}${pixel}`
}

export function rewriteLinksForTracking(bodyHtml: string, send: Pick<EmailSend, 'tracking_token'>, origin: string): string {
  return bodyHtml.replace(/<a\b([^>]*?)href=(['"])(.*?)\2([^>]*)>/gi, (_match, before, quote, href, after) => {
    const tracked = `${origin}/api/crm/track/click/${encodeURIComponent(send.tracking_token)}?url=${encodeURIComponent(href)}`
    return `<a${before}href=${quote}${tracked}${quote}${after}>`
  })
}

export function buildUnsubscribeUrl(publicId: string, origin: string): string {
  return `${origin}/u/${encodeURIComponent(publicId)}`
}

/**
 * Apply unsubscribe link rules to the rendered HTML:
 *   1. If `{unsubscribe_url}` is present anywhere, replace every occurrence
 *      with the per-contact unsubscribe URL.
 *   2. Otherwise, if the workspace has `auto_unsubscribe_footer` enabled,
 *      append a compliant inline-styled footer so email clients render it.
 *
 * Inline styles are load-bearing for real mail clients — do not move to CSS.
 */
export function applyUnsubscribeFooterHtml(
  bodyHtml: string,
  opts: { unsubscribeUrl: string; workspaceName: string; autoFooter: boolean },
): string {
  if (bodyHtml.includes(UNSUBSCRIBE_TOKEN)) {
    return bodyHtml.replaceAll(UNSUBSCRIBE_TOKEN, opts.unsubscribeUrl)
  }
  if (!opts.autoFooter) return bodyHtml
  const workspace = escapeHtml(opts.workspaceName)
  const href = escapeHtml(opts.unsubscribeUrl)
  const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #2a2c2a;font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#8a8a8a">You're receiving this because you're a contact of ${workspace}. <a href="${href}" style="color:#D97757;text-decoration:underline">Unsubscribe</a></div>`
  if (bodyHtml.includes('</body>')) {
    return bodyHtml.replace('</body>', `${footer}</body>`)
  }
  return `${bodyHtml}${footer}`
}

export function applyUnsubscribeFooterText(
  bodyText: string,
  opts: { unsubscribeUrl: string; autoFooter: boolean },
): string {
  if (bodyText.includes(UNSUBSCRIBE_TOKEN)) {
    return bodyText.replaceAll(UNSUBSCRIBE_TOKEN, opts.unsubscribeUrl)
  }
  if (!opts.autoFooter) return bodyText
  return `${bodyText}\n\n---\nUnsubscribe: ${opts.unsubscribeUrl}\n`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildTrackedEmailHtml(
  bodyHtml: string,
  send: Pick<EmailSend, 'tracking_token'>,
  contact: Pick<CrmContactRecord, 'name' | 'email' | 'company'>,
  origin: string,
  opts?: { unsubscribeUrl?: string; workspaceName?: string; autoFooter?: boolean },
): string {
  const merged = renderMergeTags(bodyHtml, contact)
  const withLinks = rewriteLinksForTracking(merged, send, origin)
  const withPixel = appendOpenTrackingPixel(withLinks, send, origin)
  if (opts?.unsubscribeUrl) {
    return applyUnsubscribeFooterHtml(withPixel, {
      unsubscribeUrl: opts.unsubscribeUrl,
      workspaceName: opts.workspaceName || 'this sender',
      autoFooter: opts.autoFooter !== false,
    })
  }
  return withPixel
}
