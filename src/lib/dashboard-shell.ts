// Shared shell for the server-rendered ads dashboards (/api/ads/dashboard,
// /api/google-ads/dashboard). Pulls the app's token set + Geist + JetBrains
// Mono so the iframes stop looking like a separate product.
//
// Usage inside a route:
//   const html = `<!DOCTYPE html>
//   <html><head>${dashboardHead({ title: 'Google Ads | CTRL' })}</head>
//   <body class="d-body">...</body></html>`

interface HeadOpts {
  title: string
  extraHead?: string
}

export function dashboardHead({ title, extraHead = '' }: HeadOpts): string {
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${dashboardCss()}</style>
  ${extraHead}
  `.trim()
}

export function dashboardCss(): string {
  return `
:root {
  /* Warm-tinted dark surface stack */
  --bg:             #1c1d1a;
  --bg-chrome:      #131412;
  --bg-panel:       #212320;
  --bg-surface:     #2a2c28;
  --bg-elevated:    #343632;
  --bg-field:       #161714;
  --bg-hover:       rgba(255, 245, 225, 0.045);
  --bg-active:      rgba(255, 245, 225, 0.09);
  --bg-row-selected: #D97757;

  /* Borders */
  --border:         rgba(255, 245, 225, 0.09);
  --border-strong:  rgba(255, 245, 225, 0.14);
  --border-dim:     rgba(255, 245, 225, 0.06);

  /* Accent — Claude terracotta orange, rare by design */
  --accent:         #D97757;
  --accent-hover:   #C4633F;
  --accent-fg:      #ffffff;
  --accent-glow:    rgba(217, 119, 87, 0.22);

  /* Status — only three */
  --status-completed: #8e9666;
  --status-active:    #d9a040;
  --status-overdue:   #d66055;

  /* Text */
  --text:             #f4f1e8;
  --text-secondary:   #c8c1b0;
  --text-dim:         #a39d8f;
  --text-muted:       #8a8479;

  /* Fonts */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

  /* Row */
  --row-height: 36px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

.d-body {
  padding: 20px 28px 48px;
  min-height: 100vh;
}

/* ─── Structural mono label (the 'FAVORITES' pattern) ─── */
.d-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
}

/* ─── Page header ─── */
.d-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.d-title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
.d-title-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.d-meta {
  display: flex;
  gap: 16px;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
}

/* ─── Filter bar (flat 28px chips) ─── */
.d-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 0 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.d-filter-group {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.d-chip {
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.d-chip:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.d-chip.active {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.d-filter-group .d-chip {
  border: none;
  background: transparent;
  border-radius: 2px;
}
.d-filter-group .d-chip.active {
  background: var(--accent);
  color: var(--accent-fg);
}
.d-filter-group .d-chip:hover:not(.active) {
  background: var(--bg-hover);
  color: var(--text);
}

/* ─── Select (campaign/account dropdown) ─── */
.d-select {
  position: relative;
  display: inline-block;
  min-width: 180px;
}
.d-select-trigger {
  width: 100%;
  height: 28px;
  padding: 0 24px 0 10px;
  background: var(--bg-field);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  position: relative;
}
.d-select-trigger::after {
  content: '';
  position: absolute;
  right: 10px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-right: 1px solid var(--text-dim);
  border-bottom: 1px solid var(--text-dim);
  transform: translateY(-70%) rotate(45deg);
}
.d-select-trigger:hover {
  border-color: var(--text-muted);
}
.d-select-menu {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-width: 360px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  box-shadow: 0 12px 36px rgba(10, 8, 4, 0.6), inset 0 1px 0 rgba(255,245,225,0.05);
  z-index: 999;
  padding: 4px 0;
}
.d-select-menu.open { display: block; }
.d-select-opt {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  text-align: left;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.d-select-opt:hover { background: var(--bg-hover); color: var(--text); }
.d-select-opt.active { background: var(--accent); color: var(--accent-fg); }

/* ─── KPI strip — Bloomberg status bar, not tiles ─── */
.d-kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 24px;
  overflow: hidden;
}
.d-kpi {
  padding: 14px 18px;
  position: relative;
}
.d-kpi + .d-kpi::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--border);
}
.d-kpi-label {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.d-kpi-value {
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
  line-height: 1;
  font-feature-settings: 'tnum' 1;
}
.d-kpi-delta {
  margin-top: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-dim);
  font-feature-settings: 'tnum' 1;
}
.d-kpi-delta.up { color: var(--status-completed); }
.d-kpi-delta.down { color: var(--status-overdue); }

/* ─── Section ─── */
.d-section {
  margin-bottom: 28px;
}
.d-section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.d-section-title {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.d-section-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

/* ─── Panel (surface container) ─── */
.d-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px;
  box-shadow: inset 0 1px 0 rgba(255,245,225,0.03);
}

/* ─── Data table ─── */
.d-table-wrap {
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-panel);
  box-shadow: inset 0 1px 0 rgba(255,245,225,0.03);
}
.d-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: 12px;
}
.d-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-chrome);
  border-bottom: 1px solid var(--border-strong);
  padding: 10px 12px;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.d-table thead th:hover { color: var(--text-secondary); }
.d-table thead th.num { text-align: right; }
.d-table tbody td {
  padding: 0 12px;
  height: var(--row-height);
  border-bottom: 1px solid var(--border-dim);
  color: var(--text-secondary);
  vertical-align: middle;
}
.d-table tbody tr:hover td { background: var(--bg-hover); color: var(--text); }
.d-table tbody tr.selected td {
  background: var(--bg-row-selected);
  color: var(--accent-fg);
}
.d-table td.num,
.d-table th.num {
  text-align: right;
  font-family: var(--font-mono);
  font-feature-settings: 'tnum' 1;
  font-size: 11.5px;
}
.d-table td.id {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.d-table td.name {
  color: var(--text);
  font-weight: 500;
}
.d-table td.dim {
  color: var(--text-dim);
  font-size: 11px;
}

/* ─── Status dot ─── */
.d-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-right: 6px;
  vertical-align: middle;
}
.d-dot.active { background: var(--status-active); }
.d-dot.completed { background: var(--status-completed); }
.d-dot.overdue { background: var(--status-overdue); }
.d-dot.paused { background: var(--text-muted); }

.d-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 2px;
  background: var(--bg-field);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
}

/* ─── Chart panel ─── */
.d-chart {
  padding: 16px 20px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.d-chart { position: relative; }
.d-chart-axis text {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.05em;
  fill: var(--text-muted);
  text-transform: uppercase;
}
.d-chart-grid line { stroke: var(--border); stroke-dasharray: 2 4; }
.d-chart-line { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.d-chart-fill { fill: var(--accent-glow); }
.d-chart-dot  { fill: var(--accent); opacity: 0; transition: opacity 100ms; }
.d-chart-hover-line {
  stroke: var(--accent);
  stroke-width: 1;
  stroke-dasharray: 2 3;
  opacity: 0;
  pointer-events: none;
}
.d-chart-hover-zone { cursor: crosshair; }
.d-chart-tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(10,8,4,0.6);
  z-index: 20;
  display: none;
  font-feature-settings: 'tnum' 1;
}
.d-chart-tooltip.on { display: block; }
.d-chart-tooltip .tt-label {
  color: var(--text-muted);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 3px;
}
.d-chart-tooltip .tt-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.d-chart-tooltip .tt-row .tt-val {
  color: var(--text);
  font-weight: 500;
}

/* ─── Empty state ─── */
.d-empty {
  text-align: center;
  padding: 80px 20px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.d-empty-title {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.d-empty-sub {
  font-size: 12px;
  color: var(--text-dim);
  max-width: 40ch;
  margin: 0 auto;
}

/* ─── Date picker (kept minimal) ─── */
.d-dpick {
  position: relative;
  display: inline-block;
}
.d-dpick-cal {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 10px;
  z-index: 999;
  box-shadow: 0 12px 36px rgba(10, 8, 4, 0.6);
  min-width: 260px;
  font-family: var(--font-sans);
}
.d-dpick-cal.open { display: block; }
.d-dpick-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.d-dpick-head button {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}
.d-dpick-head button:hover { background: var(--bg-hover); color: var(--text); }
.d-dpick-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  text-align: center;
}
.d-dpick-dow {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-muted);
  padding: 4px 0;
  letter-spacing: 0.08em;
}
.d-dpick-day {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 6px 0;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 2px;
}
.d-dpick-day:hover { background: var(--bg-hover); color: var(--text); }
.d-dpick-day.other { color: var(--text-muted); opacity: 0.5; }
.d-dpick-day.sel { background: var(--accent); color: var(--accent-fg); }
.d-dpick-day.today { outline: 1px solid var(--border-strong); outline-offset: -1px; }

/* ─── Utility ─── */
.mono { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
.dim { color: var(--text-dim); }
.muted { color: var(--text-muted); }
.right { text-align: right; }
.ok { color: var(--status-completed); }
.warn { color: var(--status-active); }
.bad { color: var(--status-overdue); }

/* ─── Scrollbar polish ─── */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 5px; border: 2px solid var(--bg); }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ─── Focus ─── */
*:focus-visible {
  outline: 2px solid var(--accent-glow);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`.trim()
}

// ─── Render helpers ────────────────────────────────────────────────

interface KPI {
  label: string
  value: string
  delta?: string             // e.g. "+12.4%"
  deltaDir?: 'up' | 'down'
}

export function renderKpiStrip(kpis: KPI[]): string {
  return `
  <div class="d-kpi-strip">
    ${kpis.map(k => `
      <div class="d-kpi">
        <div class="d-kpi-label">${escapeHtml(k.label)}</div>
        <div class="d-kpi-value">${k.value}</div>
        ${k.delta ? `<div class="d-kpi-delta${k.deltaDir ? ' ' + k.deltaDir : ''}">${escapeHtml(k.delta)}</div>` : ''}
      </div>
    `).join('')}
  </div>
  `.trim()
}

// Interactive SVG sparkline. Hidden dots + vertical crosshair + tooltip
// light up on hover via invisible full-height rects per datapoint.
// Pass a unique `id` so multiple charts on one page don't collide.
// Data points: [label, value, fullDateLabel?, secondaryLine?][] — secondaryLine
// is an optional string shown under the primary value in the tooltip.
export function renderSparkline(opts: {
  id: string
  data: Array<[string, number]> | Array<[string, number, string]>
  width?: number
  height?: number
  valueLabel?: string                 // e.g. 'SPEND'
  valueFmt?: (n: number) => string
  axisFmt?: (n: number) => string     // optional separate formatter for axis labels (usually tighter)
  fill?: boolean
  // Optional: per-point tooltip HTML. If provided, completely overrides the
  // default "date + primary value" tooltip content.
  tooltip?: (i: number) => string
}): string {
  const w = opts.width || 800
  const h = opts.height || 200
  const padL = 52, padR = 16, padT = 16, padB = 34
  const iw = w - padL - padR
  const ih = h - padT - padB
  const id = opts.id.replace(/[^a-z0-9_-]/gi, '_')
  if (!opts.data.length) {
    return `<div class="d-chart"><svg viewBox="0 0 ${w} ${h}" class="d-chart-axis" width="100%" height="${h}"></svg></div>`
  }
  const values = opts.data.map(d => d[1])
  const max = Math.max(...values, 1)
  const min = 0
  const n = opts.data.length
  const step = n > 1 ? iw / (n - 1) : 0
  const y = (v: number) => padT + ih - ((v - min) / (max - min || 1)) * ih

  const linePath = (opts.data as any[]).map(([, v]: any, i: number) => {
    const x = padL + step * i
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y(v).toFixed(1)}`
  }).join(' ')

  const fillPath = opts.fill
    ? `${linePath} L ${(padL + step * (n - 1)).toFixed(1)} ${padT + ih} L ${padL.toFixed(1)} ${padT + ih} Z`
    : ''

  const fmt = opts.valueFmt || ((v: number) => Math.round(v).toString())
  const axisFmt = opts.axisFmt || fmt
  const midY = (max - min) / 2
  const labelEvery = Math.max(1, Math.ceil(n / 6))
  const xLabels = (opts.data as any[]).map(([lbl]: any, i: number) => ({ lbl, i })).filter((_: any, i: number) => i % labelEvery === 0 || i === n - 1)

  // Hover zone width per point (covers half on each side)
  const hW = n > 1 ? step : iw

  // Tooltip content per point, built inline as string (escaped)
  const ttFor = (i: number) => {
    if (opts.tooltip) return opts.tooltip(i)
    const [label, v, full] = opts.data[i] as [string, number, string?]
    const labelText = full || label
    const primaryLabel = opts.valueLabel || 'VALUE'
    return `<div class="tt-label">${escapeHtml(labelText)}</div>`
         + `<div class="tt-row"><span>${escapeHtml(primaryLabel)}</span><span class="tt-val">${escapeHtml(fmt(v))}</span></div>`
  }

  const hoverZones = opts.data.map((_, i) => {
    const dotX = padL + step * i
    const hx = n > 1 ? Math.max(padL, dotX - hW / 2) : padL
    const wActual = n > 1 ? (i === 0 || i === n - 1 ? hW / 2 : hW) : iw
    const ttHtml = ttFor(i).replace(/'/g, "\\'").replace(/"/g, '&quot;')
    return `<rect class="d-chart-hover-zone" x="${hx.toFixed(1)}" y="${padT}" width="${wActual.toFixed(1)}" height="${ih}" fill="transparent"`
      + ` onmouseenter="__dChartHover('${id}',${i},${dotX.toFixed(1)})"`
      + ` onmouseleave="__dChartLeave('${id}',${i})"`
      + ` onmousemove="__dChartMove('${id}',event,'${ttHtml}')"/>`
  }).join('')

  return `
  <div class="d-chart" id="chart-${id}">
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" class="d-chart-axis" preserveAspectRatio="none">
      <g class="d-chart-grid">
        <line x1="${padL}" y1="${y(midY)}" x2="${w - padR}" y2="${y(midY)}"/>
        <line x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}" stroke-dasharray="0"/>
      </g>
      <g>
        <text x="${padL - 8}" y="${padT + 4}" text-anchor="end" dominant-baseline="hanging">${escapeHtml(axisFmt(max))}</text>
        <text x="${padL - 8}" y="${y(midY) + 3}" text-anchor="end">${escapeHtml(axisFmt(midY))}</text>
        <text x="${padL - 8}" y="${padT + ih + 3}" text-anchor="end">0</text>
      </g>
      ${opts.fill ? `<path d="${fillPath}" class="d-chart-fill"/>` : ''}
      <path d="${linePath}" class="d-chart-line"/>
      <line id="hover-line-${id}" class="d-chart-hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + ih}"/>
      ${(opts.data as any[]).map(([, v]: any, i: number) => {
        const x = padL + step * i
        return `<circle id="dot-${id}-${i}" cx="${x.toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="d-chart-dot"/>`
      }).join('')}
      <g>
        ${xLabels.map(({ lbl, i }: any) => {
          const x = padL + step * i
          return `<text x="${x.toFixed(1)}" y="${h - 10}" text-anchor="middle">${escapeHtml(lbl)}</text>`
        }).join('')}
      </g>
      ${hoverZones}
    </svg>
    <div class="d-chart-tooltip" id="tt-${id}"></div>
  </div>
  `.trim()
}

// Client-side JS the page needs to include once (charts call into these).
export function sparklineScript(): string {
  return `
    function __dChartHover(id, i, x) {
      var dot = document.getElementById('dot-' + id + '-' + i);
      var hl  = document.getElementById('hover-line-' + id);
      if (dot) dot.style.opacity = 1;
      if (hl)  { hl.style.opacity = 1; hl.setAttribute('x1', x); hl.setAttribute('x2', x); }
    }
    function __dChartLeave(id, i) {
      var dot = document.getElementById('dot-' + id + '-' + i);
      var hl  = document.getElementById('hover-line-' + id);
      var tt  = document.getElementById('tt-' + id);
      if (dot) dot.style.opacity = 0;
      if (hl)  hl.style.opacity = 0;
      if (tt)  tt.classList.remove('on');
    }
    function __dChartMove(id, evt, html) {
      var tt = document.getElementById('tt-' + id);
      var chart = document.getElementById('chart-' + id);
      if (!tt || !chart) return;
      tt.innerHTML = html;
      tt.classList.add('on');
      var rect = chart.getBoundingClientRect();
      var x = evt.clientX - rect.left + 12;
      var y = evt.clientY - rect.top - 12;
      // keep tooltip inside chart bounds
      var ttRect = tt.getBoundingClientRect();
      if (x + ttRect.width > rect.width) x = evt.clientX - rect.left - ttRect.width - 12;
      if (y < 0) y = 4;
      tt.style.left = x + 'px';
      tt.style.top  = y + 'px';
    }
  `.trim()
}

export function renderEmpty(title: string, sub: string): string {
  return `
  <div class="d-empty">
    <div class="d-empty-title">${escapeHtml(title)}</div>
    <div class="d-empty-sub">${escapeHtml(sub)}</div>
  </div>
  `.trim()
}

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function fmtNum(n: number, dec = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
export function fmtPct(n: number, dec = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%'
}
export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return Math.round(n / 1_000) + 'k'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString('en-US')
}
