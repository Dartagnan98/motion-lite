import { NextRequest, NextResponse } from 'next/server'
import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_PROFILE_UPLOAD = 10 * 1024 * 1024 // 10MB for profile images

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const type = formData.get('type') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (type !== 'avatar' && type !== 'banner') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }
    if (file.size > MAX_PROFILE_UPLOAD) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 })
    }

    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedImageTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 })
    }

    const PERSISTENT_UPLOADS = '/opt/store/uploads/profile'
    const uploadsDir = existsSync('/opt/store') ? PERSISTENT_UPLOADS : join(process.cwd(), 'public', 'uploads', 'profile')
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })

    const ALLOWED_EXTS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
    const ext = ALLOWED_EXTS[file.type] || 'jpg'
    const uniqueName = `${type}-${Date.now()}.${ext}`
    const filePath = join(uploadsDir, uniqueName)

    // Write file to disk
    const ws = createWriteStream(filePath)
    const reader = file.stream().getReader()
    await new Promise<void>((resolve, reject) => {
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) { ws.end(resolve); return }
            if (!ws.write(value)) {
              await new Promise<void>(r => ws.once('drain', r))
            }
          }
        } catch (err) { ws.destroy(); reject(err) }
      }
      ws.on('error', reject)
      pump()
    })

    const url = `/api/files?path=uploads/profile/${uniqueName}`
    const column = type === 'avatar' ? 'avatar_url' : 'banner_url'
    getDb().prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(url, user.id)

    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
