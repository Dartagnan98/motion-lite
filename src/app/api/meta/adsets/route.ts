import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import {
  createAdSet, updateAdSet, getAdSets, getAdSet, deleteAdSet, duplicateAdSet,
  getReachEstimate, type AdSetParams
} from '@/lib/meta-campaign-api'

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

  const accountId = await resolveAccount({
    account_id: req.nextUrl.searchParams.get('account_id'),
    account: req.nextUrl.searchParams.get('account'),
    account_name: req.nextUrl.searchParams.get('account_name'),
  }, user.id)
  const adSetId = req.nextUrl.searchParams.get('adset_id')

  try {
    if (adSetId) {
      const data = await getAdSet(adSetId)
      return NextResponse.json(data)
    }
    if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

    const campaignId = req.nextUrl.searchParams.get('campaign_id') || undefined
    const status = req.nextUrl.searchParams.get('status') || undefined
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
    const data = await getAdSets(accountId, { campaign_id: campaignId, status, limit })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { account_id?: string; account?: string; account_name?: string; action?: string } & AdSetParams & { adset_id?: string }
  const accountId = await resolveAccount({ account_id: body.account_id, account: body.account, account_name: body.account_name }, user.id)
  if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

  try {
    // Duplicate action
    if (body.action === 'duplicate' && body.adset_id) {
      const data = await duplicateAdSet(body.adset_id, body.campaign_id, { name: body.name, status: body.status })
      return NextResponse.json(data)
    }

    // Reach estimate action
    if (body.action === 'reach_estimate') {
      const data = await getReachEstimate(accountId, body.targeting, body.optimization_goal)
      return NextResponse.json(data)
    }

    if (!body.name || !body.campaign_id || !body.targeting) {
      return NextResponse.json({ error: 'name, campaign_id, and targeting required' }, { status: 400 })
    }
    const data = await createAdSet(accountId, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { adset_id: string } & Partial<AdSetParams>
  if (!body.adset_id) return NextResponse.json({ error: 'adset_id required' }, { status: 400 })

  try {
    const data = await updateAdSet(body.adset_id, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const adSetId = req.nextUrl.searchParams.get('adset_id')
  if (!adSetId) return NextResponse.json({ error: 'adset_id required' }, { status: 400 })

  try {
    const data = await deleteAdSet(adSetId)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
