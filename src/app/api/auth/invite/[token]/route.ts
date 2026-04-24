import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getUserByEmail, signupWithPassword, createSession } from '@/lib/auth'
import {
  getInvitationByToken,
  acceptInvitation,
  getDb,
} from '@/lib/db'

// GET: Validate token and return invitation details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const inv = getInvitationByToken(token)
  if (!inv || inv.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or already used invitation' }, { status: 404 })
  }

  const now = Math.floor(Date.now() / 1000)
  if (inv.expires_at < now) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  // Get workspace name
  const workspace = getDb().prepare('SELECT name FROM workspaces WHERE id = ?').get(inv.workspace_id) as { name: string } | undefined
  const workspaceName = workspace?.name || 'Unknown workspace'

  return NextResponse.json({
    email: inv.email,
    name: inv.name,
    workspaceName,
    role: inv.role,
  })
}

// POST: Accept invite (create account or link existing + join workspace)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const body = await request.json()
  const { name, password } = body

  // Validate invitation
  const inv = getInvitationByToken(token)
  if (!inv || inv.status !== 'pending') {
    return NextResponse.json({ error: 'Invalid or already used invitation' }, { status: 404 })
  }

  const now = Math.floor(Date.now() / 1000)
  if (inv.expires_at < now) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }

  let userId: number

  // Check if user already exists
  const existingUser = await getUserByEmail(inv.email)

  if (existingUser) {
    // User exists -- just accept the invitation and create session
    userId = existingUser.id
  } else {
    // New user -- create account
    if (!name || !password) {
      return NextResponse.json({ error: 'Name and password required for new account' }, { status: 400 })
    }
    try {
      const newUser = await signupWithPassword(inv.email, name, password)
      userId = newUser.id
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  // Accept invitation (marks it accepted + adds user to workspace)
  const result = acceptInvitation(token, userId)
  if (!result) {
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 })
  }

  // Create session
  const sessionToken = await createSession(userId)

  // Set session cookie
  const cookieStore = await cookies()
  cookieStore.set('session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  })

  return NextResponse.json({ success: true, redirectTo: '/' })
}
