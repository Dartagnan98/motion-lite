// Financial Summary section — renders the QBO normalized envelope (finance.*).
// Internal only: excluded from the public /r/[token] renderer + the PDF can show
// it (it's a PM tool), but the client share never includes it.
//
// Consumed slugs:
//   finance.invoiced_total / paid_total / outstanding / dso_days → MetricValue
//   finance.invoiced_daily  → MetricSeries (date, amount)
//   finance.ar_aging        → MetricSeries (bucket, invoice_count, amount)
//   finance.recent_invoices → MetricSeries (date, number, amount, status)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChartDual } from './BlockLineChartDual'
import { BlockTable } from './BlockTable'
import { DeltaIndicator } from './DeltaIndicator'
import { computeDelta } from './delta-utils'

interface Props {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  previousEnvelope?: MetricEnvelope | null
  periodStart: string
  periodEnd: string
}

const isValue = (m: MetricValue | MetricSeries | undefined): m is MetricValue => !!m && 'value' in m
const isSeries = (m: MetricValue | MetricSeries | undefined): m is MetricSeries => !!m && 'columns' in m

function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export function FinancialSummarySection({ title, descriptionHtml, envelope, previousEnvelope, periodStart, periodEnd }: Props) {
  const m = envelope?.metrics ?? {}
  const prev = previousEnvelope?.metrics ?? {}
  const hasPrev = !!previousEnvelope

  const val = (slug: string) => (isValue(m[slug]) ? (m[slug] as MetricValue) : null)
  const pval = (slug: string) => (isValue(prev[slug]) ? (prev[slug] as MetricValue).value : null)

  // delta element; lowerIsBetter for Outstanding + DSO.
  function deltaEl(slug: string, lowerIsBetter = false) {
    const cur = val(slug)?.value
    const d = computeDelta(typeof cur === 'number' ? cur : null, typeof pval(slug) === 'number' ? (pval(slug) as number) : null)
    if (d) return <DeltaIndicator pct={d.pct} lowerIsBetter={lowerIsBetter} />
    return hasPrev ? <DeltaIndicator pct={null} /> : undefined
  }

  const daily = isSeries(m['finance.invoiced_daily']) ? (m['finance.invoiced_daily'] as MetricSeries) : null
  const aging = isSeries(m['finance.ar_aging']) ? (m['finance.ar_aging'] as MetricSeries) : null
  const recent = isSeries(m['finance.recent_invoices']) ? (m['finance.recent_invoices'] as MetricSeries) : null

  return (
    <section className="mb-10">
      <div className="flex items-start justify-between mb-2 gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">QuickBooks Online · internal — not shown on the client share</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap flex-shrink-0 mt-0.5">
          {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
        </span>
      </div>

      {descriptionHtml && (
        <div className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
      )}

      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No financial data synced yet. Map this client to a QBO customer, then refresh the report.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <BlockKpi title="Invoiced" metric={val('finance.invoiced_total')} delta={deltaEl('finance.invoiced_total')} />
        <BlockKpi title="Paid" metric={val('finance.paid_total')} delta={deltaEl('finance.paid_total')} />
        <BlockKpi title="Outstanding" metric={val('finance.outstanding')} delta={deltaEl('finance.outstanding', true)} />
        <BlockKpi title="DSO (days)" metric={val('finance.dso_days')} delta={deltaEl('finance.dso_days', true)} />
      </div>

      <div className="mb-5">
        <BlockLineChartDual title="Daily Invoiced" series={daily} lineA={{ dataKey: 'amount', label: 'Invoiced', color: '#0891b2' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BlockTable title="AR Aging" series={aging} limit={10} />
        <BlockTable title="Recent Invoices" series={recent} limit={10} />
      </div>
    </section>
  )
}
