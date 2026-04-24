import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '@/lib/auth'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const name = request.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const safeName = path.basename(name)
  const filepath = path.join(UPLOAD_DIR, safeName)

  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = fs.readFileSync(filepath)
  const ext = path.extname(safeName).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
    '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  })
}
