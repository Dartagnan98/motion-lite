import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import { getInsights, getAdAccountInfo } from '@/lib/meta-campaign-api'

/** Resolve account_id from query - accepts account_id, account (name/slug lookup), or account_name */
async function resolveAccount(params: { account_id?: string | null; account?: string | null; account_name?: string | null }, userId: number): Promise<string | null> {
  if (params.account_id) return params.account_id
  const query = params.account || params.account_name
  if (!query) return null
  const resolved = resolveAdAccountId(userId, query)
  return resolved?.account_id || null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const objectId = req.nextUrl.searchParams.get('object_id') // campaign, adset, ad, or account ID
  const action = req.nextUrl.searchParams.get('action')

  try {
    // Account info action
    if (action === 'account_info') {
      const accountId = await resolveAccount({
        account_id: req.nextUrl.searchParams.get('account_id'),
        account: req.nextUrl.searchParams.get('account'),
        account_name: req.nextUrl.searchParams.get('account_name'),
      }, user.id)
      if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })
      const data = await getAdAccountInfo(accountId)
      return NextResponse.json(data)
    }

    if (!objectId) return NextResponse.json({ error: 'object_id required' }, { status: 400 })
    if (!/^[\w.]+$/.test(objectId)) return NextResponse.json({ error: 'Invalid object_id format' }, { status: 400 })

    const datePreset = req.nextUrl.searchParams.get('date_preset') || undefined
    const since = req.nextUrl.searchParams.get('since')
    const until = req.nextUrl.searchParams.get('until')
    const level = req.nextUrl.searchParams.get('level') || undefined
    const breakdowns = req.nextUrl.searchParams.get('breakdowns') || undefined
    const fields = req.nextUrl.searchParams.get('fields') || undefined
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100')

    const timeRange = since && until ? { since, until } : undefined

    const data = await getInsights(objectId, {
      date_preset: datePreset,
      time_range: timeRange,
      level,
      breakdowns,
      fields,
      limit,
    })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
