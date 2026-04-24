import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'avatars')

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Validate
  const maxSize = 2 * 1024 * 1024 // 2MB
  if (file.size > maxSize) return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 })
  }

  // Generate filename from validated MIME type, not user-supplied name
  const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
  const ext = MIME_TO_EXT[file.type] || 'png'
  const hash = crypto.randomBytes(8).toString('hex')
  const filename = `${hash}.${ext}`

  // Ensure directory exists
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

  // Write file
  const buffer = Buffer.from(await file.arrayBuffer())
  writeFileSync(path.join(UPLOAD_DIR, filename), buffer)

  const url = `/uploads/avatars/${filename}`
  return NextResponse.json({ url })
}
