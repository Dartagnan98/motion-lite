import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getValidGoogleAdsToken } from '@/lib/google-ads'
import { pauseCampaign, enableCampaign } from '@/lib/google-ads-mutate'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const mccId = process.env.GOOGLE_ADS_MCC_ID
  if (!devToken || !mccId) return NextResponse.json({ error: 'Google Ads not configured' }, { status: 500 })

  const body = await req.json() as {
    customerId: string
    resourceName: string              // customers/X/campaigns/Y
    action: 'pause' | 'enable'
  }
  if (!body.customerId || !body.resourceName || !body.action) {
    return NextResponse.json({ error: 'Missing customerId, resourceName, or action' }, { status: 400 })
  }

  try {
    const accessToken = await getValidGoogleAdsToken(user.id)
    const ctx = {
      accessToken, devToken, mccId,
      customerId: body.customerId.replace(/-/g, ''),
    }
    if (body.action === 'pause') await pauseCampaign(ctx, body.resourceName)
    else if (body.action === 'enable') await enableCampaign(ctx, body.resourceName)
    else return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Action failed'
    console.error('[google-ads/campaign-action]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
