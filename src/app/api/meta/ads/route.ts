import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import {
  createAd, updateAd, getAds, getAd, deleteAd, duplicateAd,
  type AdParams
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
  const adId = req.nextUrl.searchParams.get('ad_id')

  try {
    if (adId) {
      const data = await getAd(adId)
      return NextResponse.json(data)
    }
    if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

    const adsetId = req.nextUrl.searchParams.get('adset_id') || undefined
    const campaignId = req.nextUrl.searchParams.get('campaign_id') || undefined
    const status = req.nextUrl.searchParams.get('status') || undefined
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
    const data = await getAds(accountId, { adset_id: adsetId, campaign_id: campaignId, status, limit })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { account_id?: string; account?: string; account_name?: string; action?: string } & AdParams & { ad_id?: string }
  const accountId = await resolveAccount({ account_id: body.account_id, account: body.account, account_name: body.account_name }, user.id)
  if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

  try {
    // Duplicate action
    if (body.action === 'duplicate' && body.ad_id) {
      const data = await duplicateAd(body.ad_id, body.adset_id, { name: body.name, status: body.status })
      return NextResponse.json(data)
    }

    if (!body.name || !body.adset_id || !body.creative) {
      return NextResponse.json({ error: 'name, adset_id, and creative required' }, { status: 400 })
    }
    const data = await createAd(accountId, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { ad_id: string } & Partial<AdParams>
  if (!body.ad_id) return NextResponse.json({ error: 'ad_id required' }, { status: 400 })

  try {
    const data = await updateAd(body.ad_id, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const adId = req.nextUrl.searchParams.get('ad_id')
  if (!adId) return NextResponse.json({ error: 'ad_id required' }, { status: 400 })

  try {
    const data = await deleteAd(adId)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
