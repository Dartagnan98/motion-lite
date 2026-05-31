import { normalize } from '../src/lib/platform/integrations/gsc/normalize.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(__dirname, '../src/lib/platform/integrations/gsc/fixtures/search-analytics-sample.json')

const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
delete raw._meta
const out = normalize(raw)
const summary = {
  provider: out.provider,
  periodStart: out.periodStart,
  periodEnd: out.periodEnd,
  clicks: out.metrics['search_performance.clicks'].value,
  impressions: out.metrics['search_performance.impressions'].value,
  ctr_pct: out.metrics['search_performance.ctr'].value,
  position: out.metrics['search_performance.position'].value,
  daily_rows: out.metrics['search_performance.daily'].rows.length,
  top_queries_rows: out.metrics['search_performance.top_queries'].rows.length,
  top_pages_rows: out.metrics['search_performance.top_pages'].rows.length,
  first_query: out.metrics['search_performance.top_queries'].rows[0],
}
console.log(JSON.stringify(summary, null, 2))
