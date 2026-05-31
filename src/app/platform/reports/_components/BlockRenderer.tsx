'use client'

// BlockRenderer — dispatches a block row to the correct block component.
//
// Sprint 2: kpi, line_chart, table are live. bar_chart, text, ai_summary,
// image are stubbed.
//
// The chart components (BlockLineChart) are client components (they use
// Recharts which needs the DOM). We mark this file 'use client' so Next
// doesn't try to SSR the Recharts tree.

import type { ReportBlockType } from '@/lib/platform/types'
import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChart } from './BlockLineChart'
import { BlockTable } from './BlockTable'
import { BlockStub } from './BlockStub'

interface BlockRendererProps {
  blockType: ReportBlockType
  title: string | null
  metricSlug: string | null
  envelope: MetricEnvelope | null
}

function pickMetric(
  envelope: MetricEnvelope | null,
  slug: string | null
): MetricValue | MetricSeries | null {
  if (!envelope || !slug) return null
  return (envelope.metrics[slug] as MetricValue | MetricSeries) ?? null
}

function isMetricValue(m: MetricValue | MetricSeries | null): m is MetricValue {
  return !!m && 'value' in m
}

function isMetricSeries(m: MetricValue | MetricSeries | null): m is MetricSeries {
  return !!m && 'columns' in m
}

export function BlockRenderer({ blockType, title, metricSlug, envelope }: BlockRendererProps) {
  const metric = pickMetric(envelope, metricSlug)

  switch (blockType) {
    case 'kpi': {
      return (
        <BlockKpi
          title={title ?? ''}
          metric={isMetricValue(metric) ? metric : null}
        />
      )
    }
    case 'line_chart': {
      return (
        <BlockLineChart
          title={title ?? ''}
          series={isMetricSeries(metric) ? metric : null}
        />
      )
    }
    case 'table': {
      return (
        <BlockTable
          title={title ?? ''}
          series={isMetricSeries(metric) ? metric : null}
        />
      )
    }
    case 'bar_chart':
    case 'text':
    case 'ai_summary':
    case 'image':
    default:
      return <BlockStub blockType={blockType} title={title} />
  }
}
