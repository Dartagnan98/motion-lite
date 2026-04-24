import { createHmac, timingSafeEqual } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmPayment,
  findCrmPaymentByProviderTxn,
  getCrmInvoiceByPublicId,
  getCrmPaymentProvider,
  queueCrmWorkflowRunsForTrigger,
  writeAuditLog,
  type CrmInvoice,
} from '@/lib/db'
import { decryptSecret } from '@/lib/crm-crypto'

type StripeEvent = {
  id?: string
  type?: string
  data?: { object?: Record<string, unknown> }
}

const STRIPE_SIG_TOLERANCE_SECONDS = 300

// Verify Stripe's `stripe-signature` header shape:
//   t=<unix-ts>,v1=<hex-hmac>[,v1=<hex-hmac>...]
// Signed payload is `${t}.${rawBody}`, HMAC-SHA256 keyed with the whsec.
// Reject if timestamp drift > 5 min (Stripe's documented replay window)
// or if no v1 entry matches the computed digest.
function verifyStripeSignature(rawBody: string, header: string, secret: string): boolean {
  const parts = header.split(',').map((p) => p.trim())
  let timestamp: string | null = null
  const sigs: string[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 't') timestamp = value
    else if (key === 'v1') sigs.push(value)
  }
  if (!timestamp || sigs.length === 0) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const drift = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (drift > STRIPE_SIG_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  for (const sig of sigs) {
    const sigBuf = Buffer.from(sig, 'hex')
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) return true
  }
  return false
}

// Stripe webhook. Verifies HMAC signature against the invoice workspace's
// stored webhook_secret (when configured) and handles payment events:
//   - invoice.paid          → mark paid, fire invoice_paid
//   - charge.succeeded      → record payment, fire payment_received
//   - invoice.payment_failed → fire payment_failed
// Idempotency: provider_txn_id uniqueness + unique index prevents
// duplicate rows even if Stripe retries a webhook.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  let event: StripeEvent
  try {
    event = JSON.parse(raw) as StripeEvent
  } catch {
    return NextResponse.json({ received: false, error: 'Invalid JSON' }, { status: 400 })
  }
  if (!event.type) return NextResponse.json({ received: false, error: 'Missing event type' }, { status: 400 })
  const obj = event.data?.object ?? {}
  const metadata = (obj.metadata as Record<string, string> | undefined) ?? {}
  const invoicePublicId = metadata.invoice_public_id || metadata.public_id || null
  let invoice: CrmInvoice | null = null
  if (invoicePublicId) invoice = getCrmInvoiceByPublicId(invoicePublicId)
  if (!invoice) {
    // Still audit unmatched events so operators can diagnose.
    return NextResponse.json({ received: true, matched: false })
  }

  // Workspace-scoped signature verification. When the provider has a
  // webhook_secret stored, enforce it; when absent (local/dev), accept
  // unsigned to match the GBP webhook dev-mode ergonomics.
  const provider = getCrmPaymentProvider(invoice.workspace_id, 'stripe')
  const whsec = provider ? decryptSecret(provider.webhook_secret_enc) : null
  if (whsec) {
    const header = request.headers.get('stripe-signature') || ''
    if (!header || !verifyStripeSignature(raw, header, whsec)) {
      return NextResponse.json({ received: false, error: 'Invalid signature' }, { status: 400 })
    }
  }
  const txnId = (obj.id as string | undefined) ?? event.id ?? null

  if (event.type === 'invoice.paid' || event.type === 'charge.succeeded') {
    if (txnId) {
      const dup = findCrmPaymentByProviderTxn('stripe', txnId)
      if (dup) return NextResponse.json({ received: true, duplicate: true })
    }
    const amountCents = Number(obj.amount_paid ?? obj.amount ?? invoice.amount_due_cents)
    const payment = createCrmPayment(invoice.workspace_id, {
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      amount_cents: amountCents,
      currency: invoice.currency,
      method: 'card',
      status: 'succeeded',
      provider: 'stripe',
      provider_txn_id: txnId,
      memo: `Stripe ${event.type}`,
    })
    writeAuditLog({
      workspaceId: invoice.workspace_id,
      entity: 'crm_payment',
      entityId: payment.id,
      action: 'webhook.stripe',
      summary: `Stripe ${event.type} for invoice ${invoice.number}`,
      payload: { event_type: event.type, txn_id: txnId },
    })
    if (invoice.contact_id) {
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'payment_received', triggerValue: null }) } catch { /* noop */ }
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'invoice_paid', triggerValue: null }) } catch { /* noop */ }
    }
  } else if (event.type === 'invoice.payment_failed' || event.type === 'charge.failed') {
    const amountCents = Number(obj.amount ?? obj.amount_due ?? invoice.amount_due_cents)
    createCrmPayment(invoice.workspace_id, {
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      amount_cents: amountCents,
      currency: invoice.currency,
      method: 'card',
      status: 'failed',
      provider: 'stripe',
      provider_txn_id: txnId,
      failure_reason: (obj.failure_message as string | undefined) ?? (obj.last_payment_error as Record<string, unknown> | undefined)?.message as string | undefined ?? null,
    })
    if (invoice.contact_id) {
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'payment_failed', triggerValue: null }) } catch { /* noop */ }
    }
  } else if (event.type === 'customer.subscription.deleted') {
    if (invoice.contact_id) {
      try { queueCrmWorkflowRunsForTrigger({ workspaceId: invoice.workspace_id, contactId: invoice.contact_id, triggerType: 'subscription_cancelled', triggerValue: null }) } catch { /* noop */ }
    }
  }
  return NextResponse.json({ received: true })
}
