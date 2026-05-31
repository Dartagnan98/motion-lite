// CSS injected (via Puppeteer page.addStyleTag) into the report page when
// rendering it to PDF. Shared by the authenticated route
// (/api/platform/reports/[reportId]/pdf) and the public token route
// (/r/[token]/pdf) so both PDFs render identically.
//
// Two jobs:
//  1. PAGINATION — the live app keeps the report inside a fixed-height scroll
//     container (AppShell standalone wrapper is `height: 100dvh`; the platform
//     layout adds `h-full overflow-y-auto`). Puppeteer's page.pdf() only emits
//     ONE page of a clipped scroll container. Releasing those height/overflow
//     constraints lets the document grow to its full content height so the PDF
//     paginates across everything.
//  2. CLEANUP — strip interactive controls + empty placeholders that are
//     meaningless in a static PDF, and force a white background.
//
// addStyleTag only applies inside the Puppeteer render, so none of this leaks
// into the live app. The hooks (data-* attributes) are added in the report
// page + its section components.

export const PDF_PRINT_CSS = `
  /* ── Pagination: let content flow to full document height ── */
  html, body { height: auto !important; overflow: visible !important; background: #ffffff !important; }
  [data-density] { height: auto !important; overflow: visible !important; }   /* AppShell standalone wrapper (height:100dvh) */
  [data-platform-scroll] { height: auto !important; overflow: visible !important; }  /* /platform/* layout scroll container */
  .sticky { position: static !important; }

  /* ── White background instead of the app's gray-50 ── */
  main { background: #ffffff !important; }
  .bg-gray-50 { background: #ffffff !important; }

  /* ── Hide interactive controls + empty placeholders ── */
  [data-report-toolbar] { display: none !important; }   /* period selector, share, download, status pill */
  [data-summary-actions] { display: none !important; }  /* Regenerate / Edit on the AI summary */
  [data-comment-composer] { display: none !important; } /* "Add a comment…" textarea + Post button */
  [data-comment-thread][data-comment-empty] { display: none !important; } /* whole comments block when empty */
  [data-section-controls] { display: none !important; }  /* inline Hide/Show affordance + hidden stub */
  [data-report-section][data-section-hidden] { display: none !important; } /* PM-hidden sections */
  /* Report-level comments block (heading + thread) when the thread is empty */
  [data-report-comments-block]:has([data-comment-empty]) { display: none !important; }

  /* ── One section per page: break before every section except the first
        (index 0 = Executive Summary, which leads page 1). ── */
  [data-report-section]:not([data-section-index="0"]) { break-before: page; }
  /* Keep a section's body from splitting needlessly where it fits. */
  [data-report-section] { break-inside: auto; }

  /* ── Charts: Recharts uses transforms that can clip ── */
  .recharts-wrapper { overflow: visible !important; }

  /* ── Keep a card whole across page breaks. Targeting the CARD (header +
        table together) — not the bare <table> — prevents the orphaned-header
        bug where a card's heading stayed on one page and its table jumped to
        the next. Cards taller than a page fall back to breaking normally. ── */
  [data-report-card], .recharts-wrapper { break-inside: avoid; }
`
