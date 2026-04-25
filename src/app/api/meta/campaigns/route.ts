import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import {
  createCampaign, updateCampaign, getCampaigns, deleteCampaign, duplicateCampaign,
  type CampaignParams
} from '@/lib/meta-campaign-api'

/** Resolve account_id from query - accepts account_id, account (name/slug lookup), or account_name */
async function resolveAccount(params: { account_id?: string | null; account?: string | null; account_name?: string | null }, userId: number): Promise<string | null> {
  // Direct account_id takes priority
  if (params.account_id) return params.account_id
  // Lookup by name/slug
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
  if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

  try {
    const status = req.nextUrl.searchParams.get('status') || undefined
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
    const data = await getCampaigns(accountId, { status, limit })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { account_id?: string; account?: string; account_name?: string; action?: string } & CampaignParams & { campaign_id?: string }
  const accountId = await resolveAccount(body, user.id)
  if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

  try {
    if (body.action === 'duplicate' && body.campaign_id) {
      const data = await duplicateCampaign(body.campaign_id, { name: body.name, status: body.status })
      return NextResponse.json(data)
    }

    if (!body.name || !body.objective) {
      return NextResponse.json({ error: 'name and objective required' }, { status: 400 })
    }
    const data = await createCampaign(accountId, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as { campaign_id: string } & Partial<CampaignParams>
  if (!body.campaign_id) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  try {
    const data = await updateCampaign(body.campaign_id, body)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const campaignId = req.nextUrl.searchParams.get('campaign_id')
  if (!campaignId) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  try {
    const data = await deleteCampaign(campaignId)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
