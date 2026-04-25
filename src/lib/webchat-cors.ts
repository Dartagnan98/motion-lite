import { NextResponse } from 'next/server'

/**
 * Shared CORS wrapper for public webchat endpoints. The embeddable SDK talks
 * from any origin (customer's site), so every response here needs permissive
 * CORS headers. We mirror the pattern from /api/pixel/track.
 */
export function corsJson<T>(data: T, status = 200): NextResponse {
  return withCors(NextResponse.json(data, { status }))
}

export function withCors(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  res.headers.set('Access-Control-Max-Age', '86400')
  return res
}

export function corsOptions(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }))
}
