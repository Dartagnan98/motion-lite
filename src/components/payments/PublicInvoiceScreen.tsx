'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type PublicInvoice = {
  public_id: string
  public_token: string
  number: string
  status: string
  currency: string
  subtotal_cents: number
  tax_cents: number
  discount_cents: number
  total_cents: number
  amount_paid_cents: number
  amount_due_cents: number
  issued_at: number | null
  due_date: number | null
  viewed_at: number | null
  notes: string | null
  terms: string | null
  contact_name: string | null
  line_items: Array<{
    description: string
    quantity: number
    unit_amount_cents: number
    tax_rate_bps: number
    line_total_cents: number
  }>
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function formatDate(unix: number | null) {
  return unix ? new Date(unix * 1000).toISOString().slice(0, 10) : 'Not set'
}

function statusTone(status: string) {
  switch (status) {
    case 'paid':
      return 'var(--status-completed)'
    case 'overdue':
    case 'void':
      return 'var(--status-overdue)'
    case 'sent':
    case 'viewed':
    case 'partial':
      return 'var(--status-active)'
    default:
      return 'var(--text-dim)'
  }
}

export function PublicInvoiceScreen({ publicToken }: { publicToken: string }) {
  const searchParams = useSearchParams()
  const checkoutState = searchParams.get('checkout')
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const checkoutHandled = useRef(false)

  async function loadInvoice() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/public/invoices/${publicToken}`)
      const body = await response.json().catch(() => ({ data: null, error: 'Unable to load invoice' }))
      if (!response.ok || body.error) throw new Error(body.error || 'Unable to load invoice')
      setInvoice(body.data)
      if (!body.data?.viewed_at) {
        try {
          await fetch(`/api/public/invoices/${publicToken}/view`, { method: 'POST' })
        } catch {
          // Best-effort beacon only.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invoice')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInvoice().catch(() => {})
  }, [publicToken])

  useEffect(() => {
    if (checkoutState !== 'success' || !invoice || checkoutHandled.current) return
    if (invoice.status === 'paid' || invoice.amount_due_cents <= 0) return
    checkoutHandled.current = true
    setCompleting(true)
    setMessage('Completing payment...')
    fetch(`/api/public/invoices/${publicToken}/mark-paid`, { method: 'POST' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({ data: null, error: 'Unable to confirm payment' }))
        if (!response.ok || body.error) throw new Error(body.error || 'Unable to confirm payment')
        setMessage('Payment recorded.')
        return loadInvoice()
      })
      .catch((err: Error) => setMessage(err.message))
      .finally(() => setCompleting(false))
  }, [checkoutState, invoice, publicToken])

  async function payNow() {
    setPaying(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/public/invoices/${publicToken}/checkout`, { method: 'POST' })
      const body = await response.json().catch(() => ({ data: null, error: 'Unable to open checkout' }))
      if (!response.ok || body.error) throw new Error(body.error || 'Unable to open checkout')
      if (body.data?.checkout_url) {
        window.location.href = body.data.checkout_url
        return
      }
      setMessage(body.data?.message || 'Online payment is not available for this invoice yet.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to open checkout')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div data-theme="light" className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '40px 18px 56px' }}>
        {loading ? (
          <div style={{ padding: '120px 24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>Loading invoice...</div>
        ) : error || !invoice ? (
          <div style={{ maxWidth: 560, margin: '120px auto 0', padding: 24, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-surface)', textAlign: 'center' }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 10, ...mono }}>Payment</div>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 10 }}>Invoice unavailable</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{error || 'Invoice not found.'}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8, ...mono }}>Invoice</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: 32, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.03em', margin: 0 }}>{invoice.number}</h1>
                  <span style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid color-mix(in oklab, currentColor 24%, transparent)', color: statusTone(invoice.status), fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', ...mono }}>{invoice.status}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
                  Billed to {invoice.contact_name || 'your account'}
                </div>
              </div>
              <div style={{ minWidth: 220, padding: 18, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-elevated)', textAlign: 'right' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, ...mono }}>Amount due</div>
                <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em' }}>{formatCurrency(invoice.amount_due_cents, invoice.currency)}</div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>Due {formatDate(invoice.due_date)}</div>
              </div>
            </div>

            {message && (
              <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 13, color: 'var(--text-secondary)' }}>
                {message}
              </div>
            )}

            <div style={{ border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 0.8fr 0.8fr', gap: 12, padding: '12px 24px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', ...mono }}>
                <span>Description</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>Unit</span>
                <span style={{ textAlign: 'right' }}>Line</span>
              </div>
              {invoice.line_items.map((line, index) => (
                <div key={`${line.description}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 0.8fr 0.8fr', gap: 12, padding: '16px 24px', borderBottom: index === invoice.line_items.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 14, color: 'var(--text)' }}>{line.description}</div>
                    {line.tax_rate_bps > 0 && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>Tax {(line.tax_rate_bps / 100).toFixed(2)}%</div>}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)', ...mono }}>{line.quantity}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)', ...mono }}>{formatCurrency(line.unit_amount_cents, invoice.currency)}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text)', ...mono }}>{formatCurrency(line.line_total_cents || line.quantity * line.unit_amount_cents, invoice.currency)}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: 18, alignItems: 'start' }}>
              <section style={{ padding: 22, borderRadius: 18, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18 }}>
                  <MetaBlock label="Issued" value={formatDate(invoice.issued_at)} />
                  <MetaBlock label="Viewed" value={formatDate(invoice.viewed_at)} />
                  <MetaBlock label="Due" value={formatDate(invoice.due_date)} />
                  <MetaBlock label="Currency" value={invoice.currency} />
                </div>
                {(invoice.notes || invoice.terms) && (
                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)', display: 'grid', gap: 16 }}>
                    {invoice.notes && (
                      <div>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, ...mono }}>Notes</div>
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
                      </div>
                    )}
                    {invoice.terms && (
                      <div>
                        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, ...mono }}>Terms</div>
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{invoice.terms}</div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <aside style={{ padding: 22, borderRadius: 18, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <TotalRow label="Subtotal" value={formatCurrency(invoice.subtotal_cents, invoice.currency)} />
                  <TotalRow label="Tax" value={formatCurrency(invoice.tax_cents, invoice.currency)} />
                  {invoice.discount_cents > 0 && <TotalRow label="Discount" value={formatCurrency(invoice.discount_cents, invoice.currency)} />}
                  <TotalRow label="Paid" value={formatCurrency(invoice.amount_paid_cents, invoice.currency)} muted />
                  <TotalRow label="Balance due" value={formatCurrency(invoice.amount_due_cents, invoice.currency)} strong />
                </div>
                {invoice.amount_due_cents > 0 && invoice.status !== 'void' ? (
                  <button onClick={payNow} disabled={paying || completing} style={{ width: '100%', marginTop: 20, padding: '13px 16px', borderRadius: 12, border: '1px solid transparent', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 600, cursor: paying || completing ? 'wait' : 'pointer', transition: 'background 120ms ease' }}>
                    {paying || completing ? 'Processing...' : 'Pay now'}
                  </button>
                ) : (
                  <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {invoice.status === 'paid' ? 'This invoice has been paid.' : 'This invoice is no longer payable online.'}
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6, ...mono }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)', ...mono }}>{value}</div>
    </div>
  )
}

function TotalRow({ label, value, muted = false, strong = false }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: strong ? 15 : 13, fontWeight: strong ? 600 : 500, color: strong ? 'var(--text)' : muted ? 'var(--text-secondary)' : 'var(--text)' }}>
      <span>{label}</span>
      <span style={mono}>{value}</span>
    </div>
  )
}
