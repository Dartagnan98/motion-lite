// GET /r/[token]/pdf
//
// Token-scoped public PDF export. NO auth required — the share token is the
// proof of access, gated by the same platform_reports WHERE share_token = ?
// lookup used by the public HTML renderer at /r/[token].
//
// This route unblocks the "Download PDF" button on the public report page that
// was removed at Phase 2 Sprint 3 close because the auth-gated route 401'd for
// clients. Phase 3 Sprint 1 adds this token-scoped route instead.
//
// Implementation mirrors /api/platform/reports/[reportId]/pdf but uses the
// public URL /r/[token] as the Puppeteer render target.

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { initPlatformSchema } from '@/lib/platform/schema'
import { PDF_PRINT_CSS } from '@/lib/platform/pdf-print-css'

interface Params {
  params: Promise<{ token: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params

  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  // Validate token exists in DB.
  initPlatformSchema(getDb())
  const reportRow = getDb()
    .prepare(
      `SELECT r.id, r.name, r.period_end
         FROM platform_reports r
        WHERE r.share_token = ?`
    )
    .get(token) as
    | { id: number; name: string; period_end: string }
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

      // Render the public report page — no auth required, token in URL.
      // ?standalone triggers AppShell's standalone mode so the PDF doesn't
      // capture the app sidebar / tab bar / activity panel.
      const origin = req.nextUrl.origin
      const reportUrl = `${origin}/r/${token}?standalone`

      await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 30_000 })

      await page.addStyleTag({ content: PDF_PRINT_CSS })

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '16mm', bottom: '20mm', left: '16mm' },
      })

      const filename = `${reportRow.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${reportRow.period_end}.pdf`
      const pdfArrayBuffer = Buffer.from(pdfBuffer)

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(pdfArrayBuffer.byteLength),
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      await browser.close()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF generation failed'
    console.error('[r/token/pdf]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
