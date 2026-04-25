import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword, createSession } from '@/lib/auth'
import { cookies } from 'next/headers'

// Simple in-memory rate limiter: max 5 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of loginAttempts) {
    if (entry.resetAt < now) loginAttempts.delete(ip)
  }
}, 5 * 60 * 1000).unref?.()

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  // Skip rate limit in dev — locks the operator out during normal testing.
  const isDev = process.env.NODE_ENV !== 'production'

  if (!isDev && !checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many login attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const { email, password, name, signup } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  try {
    let user
    if (signup) {
      const { signupWithPassword } = await import('@/lib/auth')
      user = await signupWithPassword(email, name || email.split('@')[0], password)
    } else {
      user = await loginWithPassword(email, password)
    }

    const sessionId = await createSession(user.id)

    const cookieStore = await cookies()
    cookieStore.set('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    })

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Invalid credentials'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
