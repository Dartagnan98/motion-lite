import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getValidGoogleAdsToken, fetchUserGoogleAdsAccounts } from '@/lib/google-ads'
import { getUserGoogleAdsAccounts, saveUserGoogleAdsAccounts, toggleUserGoogleAdsAccount, updateGoogleAdsAccountSlug } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const accessToken = await getValidGoogleAdsToken(user.id)
    const available = await fetchUserGoogleAdsAccounts(accessToken)
    const selected = getUserGoogleAdsAccounts(user.id)

    // Mark which are selected
    const selectedIds = new Set(selected.filter(s => s.enabled).map(s => s.customer_id))
    const enriched = available.map(a => ({
      ...a,
      selected: selectedIds.has(a.customer_id),
      client_slug: selected.find(s => s.customer_id === a.customer_id)?.client_slug || null,
    }))

    return NextResponse.json({ available: enriched, selected })
  } catch (err) {
    console.error('Google Ads accounts error:', err)
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as {
    accounts: Array<{
      customer_id: string
      account_name: string
      client_slug?: string
      currency?: string
      manager?: boolean
    }>
  }

  try {
    saveUserGoogleAdsAccounts(user.id, body.accounts.map(a => ({
      customer_id: a.customer_id,
      account_name: a.account_name,
      client_slug: a.client_slug,
      currency: a.currency,
      manager: a.manager ? 1 : 0,
    })))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Save Google Ads accounts error:', err)
    return NextResponse.json({ error: 'Failed to save accounts' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as {
    customer_id: string
    enabled?: boolean
    client_slug?: string
  }

  try {
    if (body.enabled !== undefined) {
      toggleUserGoogleAdsAccount(user.id, body.customer_id, body.enabled)
    }
    if (body.client_slug !== undefined) {
      updateGoogleAdsAccountSlug(user.id, body.customer_id, body.client_slug)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Patch Google Ads account error:', err)
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}
