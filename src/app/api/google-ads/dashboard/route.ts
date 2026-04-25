import { NextRequest } from 'next/server'
import { scheduleGoogleAdsAutoSync } from '@/lib/google-ads-sync'
import { getAllEnabledGoogleAdsAccounts } from '@/lib/db'
import { requireOwner } from '@/lib/auth'
import {
  dashboardHead,
  renderKpiStrip,
  renderSparkline,
  renderEmpty,
  sparklineScript,
  escapeHtml,
  fmtMoney,
  fmtNum,
  fmtPct,
} from '@/lib/dashboard-shell'

scheduleGoogleAdsAutoSync()

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  const connected = getAllEnabledGoogleAdsAccounts()
  if (connected.length > 0) {
    return connected.map(a => ({ id: a.customer_id, name: a.account_name, slug: a.client_slug || '' }))
  }
  return []
}

interface CampaignPerformance {
  date: string
  customer_id: string
  account_name: string
  client_slug: string
  campaign_id: string
  campaign_name: string
  campaign_type: string | null
  campaign_status: string | null
  ad_group_id: string | null
  ad_group_name: string | null
  cost: number
  impressions: number
  clicks: number
  ctr: number
  avg_cpc: number
  conversions: number
  conversion_value: number
  cost_per_conversion: number
  conversion_rate: number
  roas: number
  search_impression_share: number | null
  search_lost_is_budget: number | null
  search_lost_is_rank: number | null
  all_conversions: number
  view_through_conversions: number
  video_views: number
  video_view_rate: number
}

interface AggregatedCampaign {
  campaign_id: string
  campaign_name: string
  campaign_type: string
  campaign_status: string
  account_name: string
  customer_id: string
  cost: number
  impressions: number
  clicks: number
  ctr: number
  avg_cpc: number
  conversions: number
  conversion_value: number
  cost_per_conversion: number
  conversion_rate: number
  roas: number
  search_impression_share: number | null
  search_lost_is_budget: number | null
  search_lost_is_rank: number | null
  all_conversions: number
  view_through_conversions: number
  video_views: number
}

async function fetchPerformanceData(
  accountId: string | null,
  dateStart: string,
  dateEnd: string,
): Promise<CampaignPerformance[]> {
  let url = `${SUPABASE_URL}/rest/v1/google_ads_daily?select=*&date=gte.${dateStart}&date=lte.${dateEnd}`
  if (accountId) {
    url += `&customer_id=eq.${accountId}`
  } else {
    const ids = getAccounts().map(a => a.id)
    if (ids.length === 0) return []
    url += `&customer_id=in.(${ids.join(',')})`
  }
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  const data = await res.json() as unknown
  if (!Array.isArray(data)) {
    console.error('[google-ads/dashboard] Supabase returned non-array:', data)
    return []
  }
  return data as CampaignPerformance[]
}

function aggregateByCampaign(data: CampaignPerformance[]): AggregatedCampaign[] {
  const map = new Map<string, AggregatedCampaign>()
  for (const row of data) {
    const existing = map.get(row.campaign_id)
    if (existing) {
      existing.cost += row.cost || 0
      existing.impressions += row.impressions || 0
      existing.clicks += row.clicks || 0
      existing.conversions += row.conversions || 0
      existing.conversion_value += row.conversion_value || 0
      existing.all_conversions += row.all_conversions || 0
      existing.view_through_conversions += row.view_through_conversions || 0
      if (row.search_impression_share != null) existing.search_impression_share = row.search_impression_share
      if (row.search_lost_is_budget != null) existing.search_lost_is_budget = row.search_lost_is_budget
      if (row.search_lost_is_rank != null) existing.search_lost_is_rank = row.search_lost_is_rank
    } else {
      map.set(row.campaign_id, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name || 'Unknown',
        campaign_type: row.campaign_type || 'UNKNOWN',
        campaign_status: row.campaign_status || 'UNKNOWN',
        account_name: row.account_name || '',
        customer_id: row.customer_id || '',
        cost: row.cost || 0,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        ctr: 0,
        avg_cpc: 0,
        conversions: row.conversions || 0,
        conversion_value: row.conversion_value || 0,
        cost_per_conversion: 0,
        conversion_rate: 0,
        roas: 0,
        search_impression_share: row.search_impression_share,
        search_lost_is_budget: row.search_lost_is_budget,
        search_lost_is_rank: row.search_lost_is_rank,
        all_conversions: row.all_conversions || 0,
        view_through_conversions: row.view_through_conversions || 0,
        video_views: 0,
      })
    }
  }
  for (const [, c] of map) {
    if (c.impressions > 0) c.ctr = (c.clicks / c.impressions) * 100
    if (c.clicks > 0) {
      c.avg_cpc = c.cost / c.clicks
      c.conversion_rate = (c.conversions / c.clicks) * 100
    }
    if (c.conversions > 0) c.cost_per_conversion = c.cost / c.conversions
    if (c.cost > 0) c.roas = c.conversion_value / c.cost
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost)
}

function statusDotClass(status: string): string {
  const s = (status || '').toUpperCase()
  if (s === 'ENABLED') return 'active'
  if (s === 'PAUSED') return 'paused'
  if (s === 'REMOVED') return 'overdue'
  return ''
}

export async function GET(req: NextRequest) {
  try { await requireOwner() }
  catch { return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) }

  const accountId = req.nextUrl.searchParams.get('account') || null
  const clientSlug = req.nextUrl.searchParams.get('client') || null
  const typeFilter = req.nextUrl.searchParams.get('type') || null

  const today = new Date()
  let dateEnd = today.toISOString().split('T')[0]
  let dateStart: string
  const startParam = req.nextUrl.searchParams.get('start')
  const endParam = req.nextUrl.searchParams.get('end')
  if (startParam && endParam) {
    dateStart = startParam; dateEnd = endParam
  } else {
    const days = parseInt(req.nextUrl.searchParams.get('days') || '7')
    const sd = new Date(); sd.setDate(today.getDate() - days)
    dateStart = sd.toISOString().split('T')[0]
  }

  const accounts = getAccounts()
  let rawData: CampaignPerformance[] = []
  try { rawData = await fetchPerformanceData(accountId, dateStart, dateEnd) }
  catch (err) { console.error('[google-ads/dashboard]', err) }

  if (clientSlug)  rawData = rawData.filter(r => r.client_slug === clientSlug)
  if (typeFilter && typeFilter !== 'ALL') rawData = rawData.filter(r => r.campaign_type === typeFilter)

  const campaigns = aggregateByCampaign(rawData)
  const totalCost = campaigns.reduce((s, c) => s + c.cost, 0)
  const totalImpr = campaigns.reduce((s, c) => s + c.impressions, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)
  const totalConv = campaigns.reduce((s, c) => s + c.conversions, 0)
  const totalConvVal = campaigns.reduce((s, c) => s + c.conversion_value, 0)
  const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0
  const avgCpc = totalClicks > 0 ? totalCost / totalClicks : 0
  const avgCpa = totalConv > 0 ? totalCost / totalConv : 0
  const avgRoas = totalCost > 0 ? totalConvVal / totalCost : 0

  // Campaign type rollup
  const typeMap = new Map<string, { cost: number; conversions: number; clicks: number; impressions: number }>()
  for (const c of campaigns) {
    const t = c.campaign_type || 'UNKNOWN'
    const ex = typeMap.get(t)
    if (ex) {
      ex.cost += c.cost; ex.conversions += c.conversions; ex.clicks += c.clicks; ex.impressions += c.impressions
    } else {
      typeMap.set(t, { cost: c.cost, conversions: c.conversions, clicks: c.clicks, impressions: c.impressions })
    }
  }

  // Daily aggregation
  const dailyMap = new Map<string, { cost: number; conversions: number; clicks: number; impressions: number }>()
  for (const r of rawData) {
    const d = dailyMap.get(r.date)
    if (d) {
      d.cost += r.cost || 0; d.conversions += r.conversions || 0; d.clicks += r.clicks || 0; d.impressions += r.impressions || 0
    } else {
      dailyMap.set(r.date, { cost: r.cost || 0, conversions: r.conversions || 0, clicks: r.clicks || 0, impressions: r.impressions || 0 })
    }
  }
  const dailyData = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // Search impression share (weighted)
  const searchCampaigns = campaigns.filter(c => c.campaign_type === 'SEARCH' && c.search_impression_share != null)
  const avgImprShare = searchCampaigns.length
    ? searchCampaigns.reduce((s, c) => s + (c.search_impression_share || 0), 0) / searchCampaigns.length
    : null
  const avgLostBudget = searchCampaigns.length
    ? searchCampaigns.reduce((s, c) => s + (c.search_lost_is_budget || 0), 0) / searchCampaigns.length
    : null
  const avgLostRank = searchCampaigns.length
    ? searchCampaigns.reduce((s, c) => s + (c.search_lost_is_rank || 0), 0) / searchCampaigns.length
    : null

  const html = `<!DOCTYPE html>
<html lang="en">
<head>${dashboardHead({ title: 'Google Ads | CTRL' })}</head>
<body class="d-body">

  <header class="d-header">
    <div>
      <div class="d-title-eyebrow">Google Ads</div>
      <div class="d-title">${accountId ? escapeHtml(accounts.find(a => a.id === accountId)?.name || 'All Accounts') : 'All Accounts'}</div>
    </div>
    <div class="d-meta">
      <span>${escapeHtml(dateStart)} <span class="muted">→</span> ${escapeHtml(dateEnd)}</span>
      <span class="muted">·</span>
      <span>${campaigns.length} <span class="muted">${campaigns.length === 1 ? 'campaign' : 'campaigns'}</span></span>
    </div>
  </header>

  <div class="d-filters">
    <div class="d-select" id="account-csel">
      <button class="d-select-trigger" onclick="toggleCsel('account-csel')">${accountId ? escapeHtml(accounts.find(a => a.id === accountId)?.name || 'All Accounts') : 'All Accounts'}</button>
      <div class="d-select-menu">
        <button class="d-select-opt ${!accountId ? 'active' : ''}" onclick="pickCsel('account-csel','','All Accounts')">All Accounts</button>
        ${accounts.map(a => `<button class="d-select-opt ${accountId === a.id ? 'active' : ''}" onclick="pickCsel('account-csel','${a.id}','${escapeHtml(a.name)}')">${escapeHtml(a.name)}</button>`).join('')}
      </div>
    </div>
    <input type="hidden" id="account-filter" value="${accountId || ''}" />

    <div class="d-dpick" id="dpick-start">
      <button class="d-chip" onclick="openDatePicker('dpick-start')">${escapeHtml(dateStart)}</button>
      <div class="d-dpick-cal" id="dpick-start-cal"></div>
    </div>
    <input type="hidden" id="date-start" value="${dateStart}" />

    <span class="muted mono" style="font-size:11px;padding:0 2px;">→</span>

    <div class="d-dpick" id="dpick-end">
      <button class="d-chip" onclick="openDatePicker('dpick-end')">${escapeHtml(dateEnd)}</button>
      <div class="d-dpick-cal" id="dpick-end-cal"></div>
    </div>
    <input type="hidden" id="date-end" value="${dateEnd}" />

    <div class="d-filter-group">
      ${[7,14,30,90].map(d => `<button class="d-chip" onclick="setPreset(${d})">${d}d</button>`).join('')}
    </div>

    <div class="d-filter-group">
      ${['ALL', 'SEARCH', 'DISPLAY', 'PMAX', 'VIDEO', 'SHOPPING', 'SMART', 'LOCAL'].map(t =>
        `<button class="d-chip ${(typeFilter || 'ALL') === t ? 'active' : ''}" onclick="setType('${t}')">${t}</button>`
      ).join('')}
    </div>
  </div>

  ${campaigns.length === 0 ? renderEmpty(
    'No Google Ads data in range',
    'Connect an account in Settings, trigger Sync Now, or widen the date window.'
  ) : `
    ${renderKpiStrip([
      { label: 'Spend',        value: fmtMoney(totalCost) },
      { label: 'Impressions',  value: fmtNum(totalImpr) },
      { label: 'Clicks',       value: fmtNum(totalClicks) },
      { label: 'CTR',          value: fmtPct(avgCtr) },
      { label: 'Avg CPC',      value: fmtMoney(avgCpc) },
      { label: 'Conversions',  value: fmtNum(totalConv, 1) },
      { label: 'CPA',          value: avgCpa > 0 ? fmtMoney(avgCpa) : '—' },
      { label: 'ROAS',         value: avgRoas > 0 ? avgRoas.toFixed(2) + '×' : '—' },
    ])}

    ${dailyData.length > 1 ? `
    <section class="d-section">
      <div class="d-section-header">
        <div class="d-section-title">Daily Spend</div>
        <div class="d-section-sub">${dailyData.length} days · hover for metrics</div>
      </div>
      <div class="d-panel" style="padding:0;">
        ${renderSparkline({
          id: 'gads-spend',
          data: dailyData.map(([d, v]) => [d.slice(5), v.cost, d] as [string, number, string]),
          valueLabel: 'Spend',
          valueFmt: (n) => '$' + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)),
          axisFmt: (n) => '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : Math.round(n)),
          fill: true,
          height: 220,
          tooltip: (i) => {
            const [, , full] = dailyData[i] as unknown as [string, unknown, string]
            const dayData = dailyData[i][1]
            return `<div class="tt-label">${escapeHtml(full || dailyData[i][0])}</div>`
              + `<div class="tt-row"><span>Spend</span><span class="tt-val">${escapeHtml(fmtMoney(dayData.cost))}</span></div>`
              + `<div class="tt-row"><span>Impressions</span><span class="tt-val">${escapeHtml(fmtNum(dayData.impressions))}</span></div>`
              + `<div class="tt-row"><span>Clicks</span><span class="tt-val">${escapeHtml(fmtNum(dayData.clicks))}</span></div>`
              + `<div class="tt-row"><span>CTR</span><span class="tt-val">${escapeHtml(dayData.impressions > 0 ? fmtPct((dayData.clicks / dayData.impressions) * 100) : '—')}</span></div>`
              + `<div class="tt-row"><span>Conv</span><span class="tt-val">${escapeHtml(fmtNum(dayData.conversions, 1))}</span></div>`
              + `<div class="tt-row"><span>CPA</span><span class="tt-val">${escapeHtml(dayData.conversions > 0 ? fmtMoney(dayData.cost / dayData.conversions) : '—')}</span></div>`
          },
        })}
      </div>
    </section>` : ''}

    ${typeMap.size > 1 ? `
    <section class="d-section">
      <div class="d-section-header">
        <div class="d-section-title">By Campaign Type</div>
      </div>
      <div class="d-table-wrap">
        <table class="d-table">
          <thead>
            <tr>
              <th>Type</th>
              <th class="num">Spend</th>
              <th class="num">Impressions</th>
              <th class="num">Clicks</th>
              <th class="num">Conversions</th>
              <th class="num">Share of Spend</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(typeMap.entries()).sort((a,b) => b[1].cost - a[1].cost).map(([t, d]) => `
              <tr>
                <td class="name"><span class="d-badge">${escapeHtml(t)}</span></td>
                <td class="num">${fmtMoney(d.cost)}</td>
                <td class="num">${fmtNum(d.impressions)}</td>
                <td class="num">${fmtNum(d.clicks)}</td>
                <td class="num">${fmtNum(d.conversions, 1)}</td>
                <td class="num">${totalCost > 0 ? fmtPct((d.cost / totalCost) * 100, 1) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>` : ''}

    ${avgImprShare != null ? `
    <section class="d-section">
      <div class="d-section-header">
        <div class="d-section-title">Search Impression Share</div>
        <div class="d-section-sub">Captured · Lost (budget) · Lost (rank)</div>
      </div>
      <div class="d-panel">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;">
          <div>
            <div class="d-kpi-label">Captured</div>
            <div class="d-kpi-value ok">${(avgImprShare * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div class="d-kpi-label">Lost · Budget</div>
            <div class="d-kpi-value ${(avgLostBudget || 0) > 0.15 ? 'warn' : ''}">${avgLostBudget != null ? (avgLostBudget * 100).toFixed(1) + '%' : '—'}</div>
          </div>
          <div>
            <div class="d-kpi-label">Lost · Rank</div>
            <div class="d-kpi-value ${(avgLostRank || 0) > 0.25 ? 'bad' : ''}">${avgLostRank != null ? (avgLostRank * 100).toFixed(1) + '%' : '—'}</div>
          </div>
        </div>
        <div style="height:8px;background:var(--bg-field);border-radius:2px;overflow:hidden;display:flex;margin-top:18px;">
          ${avgImprShare ? `<div style="width:${Math.min(avgImprShare * 100, 100).toFixed(1)}%;background:var(--accent);"></div>` : ''}
          ${avgLostBudget ? `<div style="width:${Math.min(avgLostBudget * 100, 100).toFixed(1)}%;background:var(--status-active);opacity:0.8;"></div>` : ''}
          ${avgLostRank ? `<div style="width:${Math.min(avgLostRank * 100, 100).toFixed(1)}%;background:var(--status-overdue);opacity:0.8;"></div>` : ''}
        </div>
      </div>
    </section>` : ''}

    <section class="d-section">
      <div class="d-section-header">
        <div class="d-section-title">Campaigns</div>
        <div class="d-section-sub">${campaigns.length} · sorted by spend</div>
      </div>
      <div class="d-table-wrap">
        <table class="d-table" id="campaigns-table">
          <thead>
            <tr>
              <th onclick="sortTable(0)">Campaign</th>
              <th onclick="sortTable(1)">Type</th>
              <th onclick="sortTable(2)">Status</th>
              <th class="num" onclick="sortTable(3)">Spend</th>
              <th class="num" onclick="sortTable(4)">Impr</th>
              <th class="num" onclick="sortTable(5)">Clicks</th>
              <th class="num" onclick="sortTable(6)">CTR</th>
              <th class="num" onclick="sortTable(7)">CPC</th>
              <th class="num" onclick="sortTable(8)">Conv</th>
              <th class="num" onclick="sortTable(9)">CPA</th>
              <th class="num" onclick="sortTable(10)">ROAS</th>
              <th class="num" onclick="sortTable(11)">IS</th>
            </tr>
          </thead>
          <tbody>
            ${campaigns.map(c => `
              <tr>
                <td class="name">
                  <div>${escapeHtml(c.campaign_name)}</div>
                  <div class="dim" style="font-size:10.5px;font-family:var(--font-mono);">${escapeHtml(c.account_name)}</div>
                </td>
                <td><span class="d-badge">${escapeHtml(c.campaign_type)}</span></td>
                <td><span class="d-dot ${statusDotClass(c.campaign_status)}"></span><span class="dim mono" style="font-size:11px;">${escapeHtml((c.campaign_status || '').toLowerCase())}</span></td>
                <td class="num">${fmtMoney(c.cost)}</td>
                <td class="num">${fmtNum(c.impressions)}</td>
                <td class="num">${fmtNum(c.clicks)}</td>
                <td class="num">${fmtPct(c.ctr)}</td>
                <td class="num">${c.avg_cpc > 0 ? fmtMoney(c.avg_cpc) : '—'}</td>
                <td class="num">${fmtNum(c.conversions, 1)}</td>
                <td class="num ${c.cost_per_conversion > avgCpa * 3 && avgCpa > 0 ? 'bad' : ''}">${c.conversions > 0 ? fmtMoney(c.cost_per_conversion) : '—'}</td>
                <td class="num ${c.roas >= 3 ? 'ok' : (c.roas > 0 && c.roas < 1 ? 'bad' : '')}">${c.roas > 0 ? c.roas.toFixed(2) + '×' : '—'}</td>
                <td class="num">${c.search_impression_share != null ? fmtPct(c.search_impression_share * 100, 1) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `}

  <script>
    ${sparklineScript()}

    function updateFilters() {
      var qs = new URLSearchParams(window.location.search);
      var a = document.getElementById('account-filter').value;
      var s = document.getElementById('date-start').value;
      var e = document.getElementById('date-end').value;
      a ? qs.set('account', a) : qs.delete('account');
      s ? qs.set('start', s) : qs.delete('start');
      e ? qs.set('end', e) : qs.delete('end');
      qs.delete('days');
      window.location.search = qs.toString();
    }

    function setPreset(days) {
      var end = new Date();
      var start = new Date();
      start.setDate(end.getDate() - days);
      document.getElementById('date-start').value = start.toISOString().slice(0, 10);
      document.getElementById('date-end').value = end.toISOString().slice(0, 10);
      updateFilters();
    }

    function setType(t) {
      var qs = new URLSearchParams(window.location.search);
      if (t === 'ALL') qs.delete('type'); else qs.set('type', t);
      window.location.search = qs.toString();
    }

    // Dropdown
    function toggleCsel(id) {
      var el = document.getElementById(id);
      var menu = el.querySelector('.d-select-menu');
      var wasOpen = menu.classList.contains('open');
      document.querySelectorAll('.d-select-menu.open').forEach(function(m) { m.classList.remove('open'); });
      if (!wasOpen) menu.classList.add('open');
    }
    function pickCsel(id, value) {
      var el = document.getElementById(id);
      var hidden = document.getElementById(id === 'account-csel' ? 'account-filter' : '');
      if (hidden) hidden.value = value;
      el.querySelector('.d-select-menu').classList.remove('open');
      updateFilters();
    }
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.d-select')) {
        document.querySelectorAll('.d-select-menu.open').forEach(function(m) { m.classList.remove('open'); });
      }
      if (!e.target.closest('.d-dpick')) {
        document.querySelectorAll('.d-dpick-cal.open').forEach(function(c) { c.classList.remove('open'); });
      }
    });

    // Date picker
    var dpickState = {};
    function openDatePicker(id) {
      document.querySelectorAll('.d-dpick-cal.open').forEach(function(c) { c.classList.remove('open'); });
      document.querySelectorAll('.d-select-menu.open').forEach(function(m) { m.classList.remove('open'); });
      var inputMap = { 'dpick-start': 'date-start', 'dpick-end': 'date-end' };
      var inputId = inputMap[id];
      var currentVal = document.getElementById(inputId).value;
      var d = currentVal ? new Date(currentVal + 'T00:00:00') : new Date();
      dpickState[id] = { month: d.getMonth(), year: d.getFullYear(), inputId: inputId };
      renderCal(id);
      document.getElementById(id + '-cal').classList.add('open');
    }
    function renderCal(id) {
      var s = dpickState[id];
      var cal = document.getElementById(id + '-cal');
      var selVal = document.getElementById(s.inputId).value;
      var today = new Date(); today.setHours(0,0,0,0);
      var first = new Date(s.year, s.month, 1);
      var startDay = first.getDay();
      var daysInMonth = new Date(s.year, s.month + 1, 0).getDate();
      var prevDays = new Date(s.year, s.month, 0).getDate();
      var mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var h = '<div class="d-dpick-head"><span>' + mNames[s.month] + ' ' + s.year + '</span>';
      h += '<div><button onclick="dpickNav(\\'' + id + '\\',-1)">\u2190</button>';
      h += '<button onclick="dpickNav(\\'' + id + '\\',1)">\u2192</button></div></div>';
      h += '<div class="d-dpick-grid">';
      ['S','M','T','W','T','F','S'].forEach(function(d) { h += '<div class="d-dpick-dow">' + d + '</div>'; });
      for (var i = startDay - 1; i >= 0; i--) {
        var pd = prevDays - i; var pval = fmtD(new Date(s.year, s.month - 1, pd));
        h += '<button class="d-dpick-day other" onclick="pickDate(\\'' + id + '\\',\\'' + pval + '\\')">' + pd + '</button>';
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var date = new Date(s.year, s.month, d); var val = fmtD(date);
        var cls = 'd-dpick-day';
        if (val === selVal) cls += ' sel';
        if (date.getTime() === today.getTime()) cls += ' today';
        h += '<button class="' + cls + '" onclick="pickDate(\\'' + id + '\\',\\'' + val + '\\')">' + d + '</button>';
      }
      h += '</div>';
      cal.innerHTML = h;
    }
    function dpickNav(id, dir) {
      var s = dpickState[id]; s.month += dir;
      if (s.month > 11) { s.month = 0; s.year++; }
      if (s.month < 0) { s.month = 11; s.year--; }
      renderCal(id);
    }
    function pickDate(id, val) {
      var s = dpickState[id];
      document.getElementById(s.inputId).value = val;
      document.querySelector('#' + id + ' .d-chip').textContent = val;
      document.getElementById(id + '-cal').classList.remove('open');
      updateFilters();
    }
    function fmtD(d) {
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + dd;
    }

    // Sorting
    var sortState = { col: -1, dir: 1 };
    function sortTable(col) {
      var tbl = document.getElementById('campaigns-table');
      if (!tbl) return;
      var tbody = tbl.querySelector('tbody');
      var rows = Array.from(tbody.querySelectorAll('tr'));
      sortState.dir = sortState.col === col ? -sortState.dir : 1;
      sortState.col = col;
      rows.sort(function(a, b) {
        var av = a.cells[col].textContent.trim();
        var bv = b.cells[col].textContent.trim();
        var an = parseFloat(av.replace(/[^-\\d.]/g, ''));
        var bn = parseFloat(bv.replace(/[^-\\d.]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortState.dir;
        return av.localeCompare(bv) * sortState.dir;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    }
  </script>
</body>
</html>`

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
