import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { getActiveToken } from '@/lib/meta-api'
import { verifyPortalToken, getPortalAdAccountIds } from '@/lib/db'

async function verifyAdBelongsToAccounts(adId: string, allowedAccountIds: string[], token: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${adId}?fields=account_id&access_token=${token}`)
    const data = await resp.json() as { account_id?: string }
    if (!data.account_id) return false
    return allowedAccountIds.some(id => id === data.account_id || id === `act_${data.account_id}` || `act_${id}` === data.account_id)
  } catch { return false }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ adId: string }> }
) {
  const portalSlug = _req.nextUrl.searchParams.get('portal_slug')
  let portalAccountIds: string[] | null = null
  if (portalSlug) {
    const portalToken = _req.nextUrl.searchParams.get('portal_token')
    if (!verifyPortalToken(portalSlug, portalToken)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    portalAccountIds = getPortalAdAccountIds(portalSlug)
  } else {
    try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { adId } = await params
  const token = getActiveToken()
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 500 })

  // Verify ad belongs to portal's allowed accounts
  if (portalAccountIds && !(await verifyAdBelongsToAccounts(adId, portalAccountIds, token))) {
    return NextResponse.json({ error: 'Ad not authorized for this portal' }, { status: 403 })
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/v21.0/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${token}`)
    const data = await resp.json() as { data?: Array<{ body: string }>; error?: { message: string } }
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })
    const body = data.data?.[0]?.body || ''
    // Extract iframe src
    const match = body.match(/src="([^"]+)"/)
    if (match) {
      const iframeUrl = match[1].replace(/&amp;/g, '&')
      return NextResponse.json({ iframeUrl })
    }
    return NextResponse.json({ error: 'No preview available' }, { status: 404 })
  } catch (err) {
    console.error('Error fetching ad preview:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
