import { createHmac, timingSafeEqual } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmPayment,
  findCrmPaymentByProviderTxn,
  getCrmInvoiceByPublicId,
  getCrmPaymentProvider,
  queueCrmWorkflowRunsForTrigger,
  writeAuditLog,
} from '@/lib/db'
import { decryptSecret } from '@/lib/crm-crypto'
import { getSetting } from '@/lib/settings'

type SquareEvent = {
  type?: string
  event_id?: string
  data?: { id?: string; object?: Record<string, unknown> }
}

// Square signs webhooks as:
//   base64( HMAC-SHA256( signatureKey, notificationUrl + rawBody ) )
// delivered on `x-square-hmacsha256-signature`. We resolve the notification
// URL from APP_URL env / app_base_url setting so the verifier matches what
// Square actually signed.
function verifySquareSignature(rawBody: string, signatureHeader: string, notificationUrl: string, signatureKey: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', signatureKey).update(notificationUrl + rawBody, 'utf8').digest('base64')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function resolveSquareWebhookUrl(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting<string>('app_base_url') || '').toString().replace(/\/+$/, '')
  const base = configured || `${request.nextUrl.protocol}//${request.nextUrl.host}`
  return `${base}/api/webhooks/square`
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  let event: SquareEvent
  try {
    event = JSON.parse(raw) as SquareEvent
  } catch {
    return NextResponse.json({ received: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!event.type) return NextResponse.json({ received: false, error: 'Missing event type' }, { status: 400 })
  const payment = (event.data?.object?.payment ?? {}) as Record<string, unknown>
  const referenceId = (payment.reference_id as string | undefined) ?? null
  const invoice = referenceId ? getCrmInvoiceByPublicId(referenceId) : null
  if (!invoice) return NextResponse.json({ received: true, matched: false })

  // Workspace-scoped signature verification — matches Stripe webhook pattern.
  // Skip when signatureKey isn't configured so local/dev pipelines work.
  const provider = getCrmPaymentProvider(invoice.workspace_id, 'square')
  const signatureKey = provider ? decryptSecret(provider.webhook_secret_enc) : null
  if (signatureKey) {
    const header = request.headers.get('x-square-hmacsha256-signature') || ''
    const url = resolveSquareWebhookUrl(request)
    if (!verifySquareSignature(raw, header, url, signatureKey)) {
      return NextResponse.json({ received: false, error: 'Invalid signature' }, { status: 400 })
    }
  }
  const txnId = (payment.id as string | undefined) ?? event.event_id ?? null

  if (event.type === 'payment.updated' && payment.status === 'COMPLETED') {
    if (txnId) {
      const dup = findCrmPaymentByProviderTxn('square', txnId)
      if (dup) return NextResponse.json({ received: true, duplicate: true })
    }
    const amountMoney = (payment.amount_money as Record<string, unknown> | undefined) ?? {}
    const amountCents = Number(amountMoney.amount ?? invoice.amount_due_cents)
    const stored = createCrmPayment(invoice.workspace_id, {
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      amount_cents: amountCents,
      currency: (amountMoney.currency as string | undefined) ?? invoice.currency,
      method: 'card',
      status: 'succeeded',
      provider: 'square',
      provider_txn_id: txnId,
      memo: 'Square payment completed',
    })
    writeAuditLog({
      workspaceId: invoice.workspace_id,
      entity: 'crm_payment',
      entityId: stored.id,
      action: 'webhook.square',
      summary: `Square payment for invoice ${invoice.number}`,
    })
    if (invoice.contact_id) {
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'payment_received', triggerValue: null }) } catch { /* noop */ }
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'invoice_paid', triggerValue: null }) } catch { /* noop */ }
    }
  } else if (event.type === 'payment.updated' && payment.status === 'FAILED') {
    createCrmPayment(invoice.workspace_id, {
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      amount_cents: Number((payment.amount_money as Record<string, unknown> | undefined)?.amount ?? invoice.amount_due_cents),
      currency: invoice.currency,
      method: 'card',
      status: 'failed',
      provider: 'square',
      provider_txn_id: txnId,
    })
    if (invoice.contact_id) {
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'payment_failed', triggerValue: null }) } catch { /* noop */ }
    }
  }
  return NextResponse.json({ received: true })
}
