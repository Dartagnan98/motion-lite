// QuickBooks Online — types (Phase 4 Sprint 1).
// API: https://quickbooks.api.intuit.com/v3/company/{realmId}/...

import type { MetricEnvelope } from '../../adapter-contract'

/** A QBO Invoice (subset of fields we read). */
export interface QboInvoice {
  Id: string
  DocNumber?: string
  TxnDate: string          // YYYY-MM-DD
  TotalAmt: number
  Balance: number          // open balance; 0 = paid
  CustomerRef?: { value: string; name?: string }
  DueDate?: string
}

/** A QBO Payment (subset). */
export interface QboPayment {
  Id: string
  TxnDate: string
  TotalAmt: number
  CustomerRef?: { value: string; name?: string }
}

/** Raw snapshot the adapter returns from fetchSnapshot. */
export interface QboRawSnapshot {
  realmId: string
  customerId: string | null
  periodStart: string
  periodEnd: string
  /** Invoices with TxnDate in [periodStart, periodEnd] for the customer. */
  periodInvoices: QboInvoice[]
  /** Payments received in the period for the customer. */
  periodPayments: QboPayment[]
  /** ALL currently-open invoices for the customer (any date) — drives
   *  outstanding balance + AR aging as-of-now. */
  openInvoices: QboInvoice[]
}

/** Normalized QBO envelope (finance.* slugs). */
export interface QboNormalized extends MetricEnvelope {
  provider: 'qbo'
}
