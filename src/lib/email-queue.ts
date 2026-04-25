import nodemailer from 'nodemailer'
import {
  getActiveEmailAccounts,
  getReadyQueuedEmailSends,
  getCampaignReplyStatus,
  getEmailAccountById,
  getEmailCampaignById,
  getCrmEmailThemeById,
  getDailySentCountForAccount,
  getCrmContactById,
  getDefaultVerifiedCrmEmailSender,
  getLastSentEmailForContactCampaign,
  getWorkspaceById,
  updateEmailSendAfterAttempt,
} from '@/lib/db'
import { buildTrackedEmailHtml, buildUnsubscribeUrl, decryptSmtpPassword, renderMergeTags } from '@/lib/crm-email'
import { parseEmailBlocks, renderEmailBlocksToHtml } from '@/lib/email-blocks'
import { decryptSecret } from '@/lib/crm-crypto'

const FIVE_MINUTES_MS = 5 * 60 * 1000

declare global {
  // eslint-disable-next-line no-var
  var __crmEmailQueueStarted: boolean | undefined
  // eslint-disable-next-line no-var
  var __crmEmailQueueRunning: boolean | undefined
  // eslint-disable-next-line no-var
  var __crmEmailAccountCursor: number | undefined
}

function getAppOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:4000'
}

function getDayWindow(now = new Date()): { start: number; end: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
  }
}

function buildEmailVariantContext(contact: NonNullable<ReturnType<typeof getCrmContactById>>) {
  return {
    segment: contact.lifecycle_stage || null,
    region: contact.state || contact.country || null,
    tags: contact.tags_list || [],
  }
}

function pickAccountRoundRobin(accountIds: number[], workspaceId: number): number | null {
  const available = accountIds
    .map((accountId) => getEmailAccountById(accountId, workspaceId))
    .filter((account) => account && account.is_active === 1) as NonNullable<ReturnType<typeof getEmailAccountById>>[]
  if (available.length === 0) {
    return getActiveEmailAccounts(workspaceId, { includeSecrets: true })[0]?.id || null
  }
  const { start, end } = getDayWindow()
  const startIndex = globalThis.__crmEmailAccountCursor || 0
  for (let offset = 0; offset < available.length; offset += 1) {
    const index = (startIndex + offset) % available.length
    const account = available[index]
    const sentToday = getDailySentCountForAccount(account.id, start, end)
    if (sentToday < account.daily_limit) {
      globalThis.__crmEmailAccountCursor = index + 1
      return account.id
    }
  }
  return null
}

async function processQueuedSends() {
  if (globalThis.__crmEmailQueueRunning) return
  globalThis.__crmEmailQueueRunning = true
  try {
    const nowUnix = Math.floor(Date.now() / 1000)
    const jobs = getReadyQueuedEmailSends(nowUnix)
    for (const job of jobs) {
      if (!job.contact_email) continue
      if (getCampaignReplyStatus(job.contact_id, job.campaign_id)) {
        updateEmailSendAfterAttempt(job.id, { status: 'replied' })
        continue
      }
      const campaign = getEmailCampaignById(job.campaign_id, job.campaign_workspace_id)
      if (!campaign) continue
      const accountId = pickAccountRoundRobin(campaign.from_account_id_list, campaign.workspace_id)
      if (!accountId) continue
      const account = getEmailAccountById(accountId, campaign.workspace_id)
      const contact = getCrmContactById(job.contact_id, campaign.workspace_id)
      if (!account || !contact || !account.smtp_host || !account.smtp_port || !account.smtp_user || !account.smtp_pass_encrypted) {
        updateEmailSendAfterAttempt(job.id, { status: 'bounced', account_id: account?.id || null })
        continue
      }
      try {
        // If the workspace has a verified sender domain, prefer it for the
        // From: header and attach its DKIM private key so nodemailer signs
        // the outgoing MIME. We keep using the connected SMTP account for
        // the actual transport — authenticated senders just change the
        // From address and DKIM signature, not the SMTP relay.
        const verifiedSender = getDefaultVerifiedCrmEmailSender(campaign.workspace_id)
        let dkimConfig: { domainName: string; keySelector: string; privateKey: string } | undefined
        if (verifiedSender) {
          try {
            dkimConfig = {
              domainName: verifiedSender.domain,
              keySelector: verifiedSender.dkim_selector,
              privateKey: decryptSecret(verifiedSender.dkim_private_key_encrypted) as string,
            }
          } catch {
            // If we cannot decrypt (e.g., key rotated), skip DKIM — the
            // DNS records alone still authenticate a managed provider.
            dkimConfig = undefined
          }
        }

        const transporter = nodemailer.createTransport({
          host: account.smtp_host,
          port: account.smtp_port,
          secure: account.smtp_port === 465,
          auth: {
            user: account.smtp_user,
            pass: decryptSmtpPassword(account.smtp_pass_encrypted),
          },
          ...(dkimConfig ? { dkim: dkimConfig } : {}),
        })
        const previousSend = getLastSentEmailForContactCampaign(job.contact_id, job.campaign_id)
        const workspace = getWorkspaceById(campaign.workspace_id)
        const unsubscribeUrl = buildUnsubscribeUrl(contact.public_id, getAppOrigin())
        const autoFooter = workspace ? (workspace as { auto_unsubscribe_footer?: number }).auto_unsubscribe_footer !== 0 : true
        const theme = campaign.theme_id ? getCrmEmailThemeById(campaign.theme_id, campaign.workspace_id) : null
        // When the campaign is block-mode, render its JSON blocks into HTML
        // first; the tracked-email pipeline then applies merge tags, open
        // pixel, click rewriting, and unsubscribe footer on the result.
        const body = job.campaign_content_kind === 'blocks'
          ? renderEmailBlocksToHtml(parseEmailBlocks(job.campaign_content_blocks), {
              theme,
              accentColor: (workspace as { color?: string } | null)?.color || null,
              workspaceName: workspace?.name || null,
              variantContext: buildEmailVariantContext(contact),
            })
          : job.step_body_html
        const subjectTemplate = job.subject_variant === 'b' && job.campaign_subject_b
          ? job.campaign_subject_b
          : job.step_subject
        const html = buildTrackedEmailHtml(body, job, contact, getAppOrigin(), {
          unsubscribeUrl,
          workspaceName: workspace?.name || 'this sender',
          autoFooter,
        })
        const fromHeader = verifiedSender && verifiedSender.from_email
          ? (verifiedSender.from_name
              ? `${verifiedSender.from_name} <${verifiedSender.from_email}>`
              : verifiedSender.from_email)
          : `${account.label} <${account.email}>`
        const result = await transporter.sendMail({
          from: fromHeader,
          to: job.contact_email,
          subject: renderMergeTags(subjectTemplate, contact),
          html,
          inReplyTo: previousSend?.message_id || undefined,
          references: previousSend?.message_id ? [previousSend.message_id] : undefined,
          headers: previousSend?.thread_id ? { 'X-CTRL-Thread-ID': previousSend.thread_id } : undefined,
        })
        updateEmailSendAfterAttempt(job.id, {
          status: 'sent',
          account_id: account.id,
          sent_at: nowUnix,
          message_id: result.messageId,
          thread_id: previousSend?.thread_id || previousSend?.message_id || result.messageId,
        })
      } catch {
        updateEmailSendAfterAttempt(job.id, {
          status: 'bounced',
          account_id: account.id,
        })
      }
    }
  } finally {
    globalThis.__crmEmailQueueRunning = false
  }
}

export function startEmailQueueWorker() {
  if (globalThis.__crmEmailQueueStarted) return
  globalThis.__crmEmailQueueStarted = true
  processQueuedSends().catch(() => {})
  setInterval(() => {
    processQueuedSends().catch(() => {})
  }, FIVE_MINUTES_MS).unref?.()
}
