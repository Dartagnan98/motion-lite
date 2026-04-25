import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getValidFacebookToken, fetchUserPages } from '@/lib/facebook'
import { getUserPages, saveUserPages } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const token = await getValidFacebookToken(user.id)
    const available = await fetchUserPages(token)
    const selected = getUserPages(user.id)
    const selectedIds = new Set(selected.map(p => p.page_id))

    return NextResponse.json({
      available: available.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        picture_url: p.picture_url,
        fan_count: p.fan_count,
        instagram_account_id: p.instagram_account_id,
        selected: selectedIds.has(p.id),
      })),
      selected,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg.includes('No Facebook token') || msg.includes('expired')) {
      return NextResponse.json({ error: 'not_connected', message: msg }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { pages: Array<{ page_id: string; page_name: string; page_access_token: string; instagram_account_id?: string | null; category?: string; picture_url?: string; fan_count?: number }> }
  if (!body.pages || !Array.isArray(body.pages)) {
    return NextResponse.json({ error: 'pages array required' }, { status: 400 })
  }

  saveUserPages(user.id, body.pages)
  return NextResponse.json({ ok: true, count: body.pages.length })
}
