import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getValidGoogleAdsToken } from '@/lib/google-ads'
import { buildCampaign } from '@/lib/google-ads-build'
import type { CampaignSpec } from '@/lib/google-ads-build'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const mccId = process.env.GOOGLE_ADS_MCC_ID
  if (!devToken) return NextResponse.json({ error: 'GOOGLE_ADS_DEVELOPER_TOKEN not set' }, { status: 500 })
  if (!mccId) return NextResponse.json({ error: 'GOOGLE_ADS_MCC_ID not set' }, { status: 500 })

  const body = await req.json() as {
    spec: CampaignSpec
    validateOnly?: boolean
  }
  if (!body.spec || !body.spec.customerId) {
    return NextResponse.json({ error: 'Missing spec or customerId' }, { status: 400 })
  }

  try {
    const accessToken = await getValidGoogleAdsToken(user.id)
    const result = await buildCampaign({
      accessToken,
      devToken,
      mccId,
      customerId: body.spec.customerId.replace(/-/g, ''),
      validateOnly: body.validateOnly === true,
    }, body.spec)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Build failed'
    console.error('[google-ads/build]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
