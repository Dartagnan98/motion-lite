import Imap from 'imap'
import { simpleParser } from 'mailparser'
import type { EventEmitter } from 'events'
import {
  createEmailInboxEntry,
  getActiveEmailAccounts,
  getCrmContactByEmail,
  markEmailSendReplied,
  resolveEmailSendFromReplyIdentifiers,
  getWorkspaces,
} from '@/lib/db'
import { decryptSmtpPassword } from '@/lib/crm-email'

const TEN_MINUTES_MS = 10 * 60 * 1000

declare global {
  // eslint-disable-next-line no-var
  var __crmImapPollerStarted: boolean | undefined
  // eslint-disable-next-line no-var
  var __crmImapPollerRunning: boolean | undefined
}

function fetchUnseenForAccount(accountId: number, workspaceId: number) {
  const account = getActiveEmailAccounts(workspaceId, { includeSecrets: true }).find((item) => item.id === accountId)
  if (!account || !account.imap_host || !account.imap_port || !account.smtp_user || !account.smtp_pass_encrypted) return Promise.resolve()
  const decryptedPassword = decryptSmtpPassword(account.smtp_pass_encrypted)
  return new Promise<void>((resolve) => {
    const imap = new Imap({
      user: account.smtp_user,
      password: decryptedPassword,
      host: account.imap_host,
      port: account.imap_port,
      tls: account.imap_port === 993,
    })
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (openError: Error | null) => {
        if (openError) {
          imap.end()
          resolve()
          return
        }
        imap.search(['UNSEEN'], (searchError: Error | null, results: number[]) => {
          if (searchError || results.length === 0) {
            imap.end()
            resolve()
            return
          }
          const fetcher = imap.fetch(results, { bodies: '', markSeen: false })
          fetcher.on('message', (message: EventEmitter) => {
            let buffer = ''
            message.on('body', (stream: NodeJS.ReadableStream) => {
              stream.on('data', (chunk: Buffer | string) => {
                buffer += chunk.toString('utf8')
              })
            })
            message.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer)
                const from = parsed.from?.value[0]?.address?.toLowerCase() || ''
                const contact = from ? getCrmContactByEmail(workspaceId, from) : null
                const identifiers = [
                  parsed.inReplyTo || '',
                  ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
                  parsed.messageId || '',
                ].map((value) => value.trim()).filter(Boolean)
                const send = identifiers.length > 0 ? resolveEmailSendFromReplyIdentifiers(identifiers) : null
                if (send) {
                  markEmailSendReplied(send.id, Math.floor(Date.now() / 1000))
                }
                createEmailInboxEntry({
                  account_id: account.id,
                  contact_id: contact?.id || null,
                  direction: 'inbound',
                  subject: parsed.subject || null,
                  body_html: parsed.html ? String(parsed.html) : parsed.textAsHtml || parsed.text || '',
                  from_email: from || null,
                  to_email: parsed.to?.value[0]?.address?.toLowerCase() || account.email,
                  received_at: parsed.date ? Math.floor(parsed.date.getTime() / 1000) : Math.floor(Date.now() / 1000),
                  is_read: 0,
                  thread_id: send?.thread_id || send?.message_id || parsed.inReplyTo || parsed.messageId || null,
                })
              } catch {
                /* ignore malformed mail */
              }
            })
          })
          fetcher.once('error', () => {
            imap.end()
            resolve()
          })
          fetcher.once('end', () => {
            imap.end()
            resolve()
          })
        })
      })
    })
    imap.once('error', () => resolve())
    imap.connect()
  })
}

async function pollImap() {
  if (globalThis.__crmImapPollerRunning) return
  globalThis.__crmImapPollerRunning = true
  try {
    const workspaces = getWorkspaces()
    for (const workspace of workspaces) {
      const accounts = getActiveEmailAccounts(workspace.id, { includeSecrets: true }).filter((account) => account.imap_host)
      for (const account of accounts) {
        await fetchUnseenForAccount(account.id, workspace.id)
      }
    }
  } finally {
    globalThis.__crmImapPollerRunning = false
  }
}

export function startImapPoller() {
  if (globalThis.__crmImapPollerStarted) return
  globalThis.__crmImapPollerStarted = true
  pollImap().catch(() => {})
  setInterval(() => {
    pollImap().catch(() => {})
  }, TEN_MINUTES_MS).unref?.()
}
