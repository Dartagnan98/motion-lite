import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'
import { getActiveToken } from '@/lib/meta-api'
import { verifyPortalToken, getPortalAdAccountIds } from '@/lib/db'

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0'

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
    // 1. Get the effective_object_story_id from the ad's creative
    const adResp = await fetch(`${GRAPH_API_BASE}/${adId}?access_token=${token}&fields=creative{effective_object_story_id}`)
    const adData = await adResp.json() as { creative?: { effective_object_story_id?: string }; error?: { message: string } }
    if (adData.error || !adData.creative?.effective_object_story_id) {
      return NextResponse.json({ error: 'No story ID' }, { status: 404 })
    }

    const storyId = adData.creative.effective_object_story_id
    const parts = storyId.split('_')

    // Try to get video source from the post
    try {
      const postResp = await fetch(`${GRAPH_API_BASE}/${storyId}?access_token=${token}&fields=attachments{media{source},type}`)
      const postData = await postResp.json() as { attachments?: { data?: Array<{ type?: string; media?: { source?: string } }> }; error?: { message: string } }
      const attachment = postData.attachments?.data?.[0]
      if (attachment?.media?.source) {
        return NextResponse.json({ url: attachment.media.source })
      }
    } catch { /* fall through */ }

    // Try fetching video source directly
    if (parts.length === 2) {
      try {
        const videoResp = await fetch(`${GRAPH_API_BASE}/${parts[1]}?access_token=${token}&fields=source`)
        const videoData = await videoResp.json() as { source?: string; error?: { message: string } }
        if (videoData.source) {
          return NextResponse.json({ url: videoData.source })
        }
      } catch { /* fall through */ }
    }

    // Fallback: try with page token instead of user token
    if (parts.length >= 1) {
      try {
        const pageId = parts[0]
        const pageResp = await fetch(`${GRAPH_API_BASE}/${pageId}?fields=access_token&access_token=${token}`)
        const pageData = await pageResp.json() as { access_token?: string; error?: { message: string } }
        if (pageData.access_token) {
          // Try getting video from the post with page token
          const postResp = await fetch(`${GRAPH_API_BASE}/${storyId}?access_token=${pageData.access_token}&fields=attachments{type,media{source},subattachments{media{source}}}`)
          const postData = await postResp.json() as { attachments?: { data?: Array<{ type?: string; media?: { source?: string }; subattachments?: { data?: Array<{ media?: { source?: string } }> } }> } }
          const att = postData.attachments?.data?.[0]
          if (att?.media?.source) {
            return NextResponse.json({ url: att.media.source })
          }
          // Check subattachments
          const sub = att?.subattachments?.data?.[0]
          if (sub?.media?.source) {
            return NextResponse.json({ url: sub.media.source })
          }
        }
      } catch { /* fall through */ }
    }

    // Last resort: Ad Library link
    return NextResponse.json({ adLibraryUrl: `https://www.facebook.com/ads/library/?id=${adId}` })
  } catch (err) {
    console.error('Error fetching video from ad:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
