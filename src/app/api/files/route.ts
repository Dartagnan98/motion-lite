import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { requireAuth } from '@/lib/auth'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
}

// Persistent storage outside deploy path so uploads survive redeploys
const PERSISTENT_UPLOADS = '/opt/store/uploads'

function resolveFilePath(relativePath: string): string | null {
  const { resolve } = require('path')
  // Try persistent storage first (production)
  const persistent = resolve(PERSISTENT_UPLOADS, relativePath.replace(/^uploads\//, ''))
  if (persistent.startsWith(PERSISTENT_UPLOADS) && existsSync(persistent)) return persistent
  // Fall back to public/ dir (dev)
  const publicBase = join(process.cwd(), 'public')
  const publicPath = resolve(publicBase, relativePath)
  if (publicPath.startsWith(publicBase) && existsSync(publicPath)) return publicPath
  return null
}

// Max chunk size for range requests (2MB) - prevents huge memory spikes
const MAX_RANGE_CHUNK = 2 * 1024 * 1024

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const path = request.nextUrl.searchParams.get('path')
  if (!path || path.includes('..') || path.includes('\0')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const filePath = resolveFilePath(path)
  if (!filePath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ext = path.split('.').pop()?.toLowerCase() || ''
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  const stat = statSync(filePath)
  const fileSize = stat.size

  // Support range requests for video/audio seeking
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = parseInt(match[1], 10)
      // If no end specified, serve a chunk (not the whole rest of the file)
      const requestedEnd = match[2] ? parseInt(match[2], 10) : Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1)
      const end = Math.min(requestedEnd, fileSize - 1)
      const chunkSize = end - start + 1

      // Read the exact byte range into a buffer
      const fd = require('fs').openSync(filePath, 'r')
      const buffer = Buffer.alloc(chunkSize)
      require('fs').readSync(fd, buffer, 0, chunkSize, start)
      require('fs').closeSync(fd)

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': String(chunkSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        },
      })
    }
  }

  // Full file: read into buffer (reliable for all sizes we handle)
  const buffer = readFileSync(filePath)
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  })
}
