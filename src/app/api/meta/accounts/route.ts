import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getValidFacebookToken, fetchUserAdAccounts } from '@/lib/facebook'
import { getUserAdAccounts, saveUserAdAccounts, toggleUserAdAccount, updateAdAccountSlug } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const token = await getValidFacebookToken(user.id)
    const available = await fetchUserAdAccounts(token)
    const selected = getUserAdAccounts(user.id)
    const selectedIds = new Set(selected.map(a => a.account_id))

    return NextResponse.json({
      available: available.map(a => ({
        ...a,
        selected: selectedIds.has(a.id),
        client_slug: selected.find(s => s.account_id === a.id)?.client_slug || null,
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

  const body = await req.json() as { accounts: Array<{ account_id: string; account_name: string; client_slug?: string; currency?: string; business_name?: string }> }
  if (!body.accounts || !Array.isArray(body.accounts)) {
    return NextResponse.json({ error: 'accounts array required' }, { status: 400 })
  }

  saveUserAdAccounts(user.id, body.accounts)
  return NextResponse.json({ ok: true, count: body.accounts.length })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { account_id: string; enabled?: boolean; client_slug?: string }
  if (!body.account_id) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  if (body.enabled !== undefined) {
    toggleUserAdAccount(user.id, body.account_id, body.enabled)
  }
  if (body.client_slug !== undefined) {
    updateAdAccountSlug(user.id, body.account_id, body.client_slug)
  }

  return NextResponse.json({ ok: true })
}
