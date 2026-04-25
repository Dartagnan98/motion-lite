import { NextRequest, NextResponse } from 'next/server'
import { getCachedThumbnail, getActiveToken } from '@/lib/meta-api'
import { requireOwner } from '@/lib/auth'
import { verifyPortalToken, getPortalAdAccountIds } from '@/lib/db'

async function verifyAdBelongsToAccounts(adId: string, allowedAccountIds: string[]): Promise<boolean> {
  const token = getActiveToken()
  if (!token) return false
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
  if (!adId) {
    return NextResponse.json({ error: 'Missing adId' }, { status: 400 })
  }

  // Verify ad belongs to portal's allowed accounts
  if (portalAccountIds && !(await verifyAdBelongsToAccounts(adId, portalAccountIds))) {
    return NextResponse.json({ error: 'Ad not authorized for this portal' }, { status: 403 })
  }

  const result = await getCachedThumbnail(adId)
  if (!result) {
    // Return a 1x1 transparent pixel as fallback
    const pixel = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
    return new NextResponse(pixel, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=1800',
    },
  })
}
