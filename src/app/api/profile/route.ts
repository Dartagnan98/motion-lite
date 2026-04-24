import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try {
    const authUser = await requireAuth()
    const user = getDb().prepare(
      'SELECT id, name, email, avatar_url, banner_url, bio, pronouns, display_role FROM users WHERE id = ?'
    ).get(authUser.id) as Record<string, unknown> | undefined

    if (!user) {
      return NextResponse.json({ name: authUser.name, email: authUser.email, avatar_url: null, banner_url: null, bio: null, pronouns: null, display_role: null })
    }
    return NextResponse.json(user)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await requireAuth()
    const body = await request.json()
    const { name, bio, pronouns, display_role } = body

    getDb().prepare(
      'UPDATE users SET name = ?, bio = ?, pronouns = ?, display_role = ? WHERE id = ?'
    ).run(name || 'User', bio || null, pronouns || null, display_role || null, authUser.id)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }
}
