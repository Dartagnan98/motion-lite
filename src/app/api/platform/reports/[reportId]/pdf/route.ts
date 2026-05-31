// GET /api/platform/reports/[reportId]/pdf
//
// Renders the report HTML page via Puppeteer and returns a PDF stream.
//
// Puppeteer is used (not pdf-lib) because:
//   - We get pixel-faithful rendering of the full Recharts SVG output.
//   - Consistent with the "PDF output must be pixel-stable" hard rule.
//   - No separate PDF schema or layout code.
//
// Implementation notes:
//   - Uses an explicit viewport (1200×900) per the hard rule.
//   - waitForNetworkIdle: 'networkidle0' so Recharts finishes painting.
//   - The report URL is the same /platform/reports/[reportId] page — we
//     hit our own localhost so auth is bypassed via BYPASS_AUTH=true
//     (acceptable for local dev; Phase 4 adds a signed PDF-render token
//     when Vercel serves this from a cloud function).
//   - White-label (logo, colors, custom domain): Phase 4.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentWorkspaceId } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'
import { PDF_PRINT_CSS } from '@/lib/platform/pdf-print-css'

interface PageParams {
  params: Promise<{ reportId: string }>
}

export async function GET(req: NextRequest, { params }: PageParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Verify tenant owns this report before rendering. Join client_profiles so
  // the downloaded PDF can be named after the client, not the internal report
  // name (e.g. "Glenvalley Dental-Hiilite Success Metrics Report-2026-05-27.pdf").
  const reportRow = getDb().prepare(
    `SELECT r.id, r.name, r.period_start, r.period_end, c.name AS account_name
       FROM platform_reports r
       LEFT JOIN client_profiles c ON c.id = r.account_id
      WHERE r.id = ? AND r.tenant_id = ?`
  ).get(reportId, tenant.id) as
    | { id: number; name: string; period_start: string; period_end: string; account_name: string | null }
    | undefined

  if (!reportRow) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  try {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
      const page = await browser.newPage()

      // Explicit viewport so charts render at a consistent width.
      await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })

      // Render the report page on localhost. BYPASS_AUTH=true must be set in .env.
      // ?standalone triggers AppShell's standalone mode (src/components/AppShell.tsx)
      // which strips the sidebar, tab bar, and right activity panel — without it
      // the PDF captures the entire app chrome with the report squeezed into a
      // narrow center column.
      const origin = req.nextUrl.origin
      const reportUrl = `${origin}/platform/reports/${reportId}?standalone`

      // `domcontentloaded` (not `networkidle0`) — the report page now has
      // sections that fetch trend history client-side (PageSpeed chart, etc.);
      // `networkidle` could time out waiting for those to settle. The page
      // skips AutoFetchOnLoad in `?standalone` mode, so the in-flight network
      // is finite, but we don't need to gate on it. A short post-load wait
      // lets the deferred client fetches paint.
      await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      // Give client-side data fetches (Recharts series, etc.) a moment to land.
      await new Promise((r) => setTimeout(r, 1500))

      await page.addStyleTag({ content: PDF_PRINT_CSS })

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '16mm', bottom: '20mm', left: '16mm' },
      })

      // Format: "<Client> — Hiilite Success Metrics Report — <YYYY-MM-DD>.pdf"
      // Preserve case + spaces; only strip filesystem-/HTTP-unsafe characters
      // (slashes, control chars, double-quotes that would break Content-Disposition).
      const clientName = (reportRow.account_name || reportRow.name).trim()
      const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, '').replace(/\s+/g, ' ').trim()
      const filename = `${sanitize(clientName)}-Hiilite Success Metrics Report-${reportRow.period_end}.pdf`

      const pdfArrayBuffer = Buffer.from(pdfBuffer)

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(pdfArrayBuffer.byteLength),
          // Prevent caching — report content changes on every snapshot.
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      await browser.close()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF generation failed'
    console.error('[platform/reports/pdf]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
