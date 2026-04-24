import { NextRequest, NextResponse } from 'next/server'
import { getAttachments, createAttachment, deleteAttachment } from '@/lib/db'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '@/lib/auth'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50MB
const BLOCKED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'sh', 'ps1', 'php', 'jsp', 'cgi', 'pl', 'py', 'rb', 'js', 'mjs', 'html', 'htm', 'svg', 'xhtml'])

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const taskId = request.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  const attachments = getAttachments(Number(taskId))
  return NextResponse.json({ attachments })
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const formData = await request.formData()
  const taskId = formData.get('taskId') as string
  const file = formData.get('file') as File | null

  if (!taskId || !file) {
    return NextResponse.json({ error: 'Missing taskId or file' }, { status: 400 })
  }

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `File type .${ext} not allowed` }, { status: 400 })
  }

  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }

  const timestamp = Date.now()
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storedName = `${timestamp}_${safeFilename}`
  const filepath = path.join(UPLOAD_DIR, storedName)

  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(filepath, buffer)

  const attachment = createAttachment(
    Number(taskId),
    file.name,
    storedName,
    file.type,
    file.size
  )

  return NextResponse.json({ attachment })
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteAttachment(id)
  return NextResponse.json({ ok: true })
}
