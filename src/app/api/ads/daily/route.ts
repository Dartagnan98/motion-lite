import { NextRequest, NextResponse } from 'next/server'
import { getAllEnabledAdAccounts, getDb } from '@/lib/db'
import { requireOwner } from '@/lib/auth'
import crypto from 'crypto'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  return getAllEnabledAdAccounts().map(a => ({ id: a.account_id, name: a.account_name, slug: a.client_slug || '' }))
}

function getPortalAccountIds(portalSlug: string, portalToken: string): string[] | null {
  const db = getDb()
  const portal = db.prepare('SELECT * FROM portal_access WHERE client_slug = ? AND enabled = 1').get(portalSlug) as {
    password_hash: string | null; magic_link_token: string | null
  } | undefined
  if (!portal) return null

  if (portal.password_hash) {
    const validMagic = portal.magic_link_token && portalToken === portal.magic_link_token
    let validPw = false
    if (!validMagic && portalToken && portal.password_hash.includes(':')) {
      const [salt, hash] = portal.password_hash.split(':')
      const attempt = crypto.scryptSync(portalToken, salt, 64).toString('hex')
      validPw = hash.length === attempt.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(attempt))
    }
    if (!validMagic && !validPw) return null
  }

  const clientRow = db.prepare('SELECT id FROM client_profiles WHERE slug = ?').get(portalSlug) as { id: number } | undefined
  if (!clientRow) return null
  const businesses = db.prepare('SELECT ad_account_id FROM client_businesses WHERE client_id = ? AND ad_account_id IS NOT NULL').all(clientRow.id) as { ad_account_id: string }[]
  return businesses.map(b => b.ad_account_id)
}

export async function GET(req: NextRequest) {
  const portalSlug = req.nextUrl.searchParams.get('portal_slug')
  const portalToken = req.nextUrl.searchParams.get('portal_token')

  let allowedAccountIds: string[] | null = null
  if (portalSlug) {
    allowedAccountIds = getPortalAccountIds(portalSlug, portalToken || '')
    if (!allowedAccountIds) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else {
    try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const accountId = req.nextUrl.searchParams.get('account') || null

  // Reject cross-tenant account requests from portal users
  if (accountId && allowedAccountIds && !allowedAccountIds.includes(accountId)) {
    return NextResponse.json({ error: 'Account not authorized for this portal' }, { status: 403 })
  }

  const today = new Date()
  let dateEnd = today.toISOString().split('T')[0]
  let dateStart: string
  const startParam = req.nextUrl.searchParams.get('start')
  const endParam = req.nextUrl.searchParams.get('end')
  if (startParam && endParam) {
    dateStart = startParam
    dateEnd = endParam
  } else {
    const days = parseInt(req.nextUrl.searchParams.get('days') || '7')
    const sd = new Date()
    sd.setDate(today.getDate() - days)
    dateStart = sd.toISOString().split('T')[0]
  }

  try {
    let url = `${SUPABASE_URL}/rest/v1/ad_performance_daily?select=date,ad_id,ad_name,account_name,campaign_id,campaign_name,spend,impressions,clicks,link_clicks,leads,purchases,purchase_value,video_views,video_thruplay,reach,cpm&date=gte.${dateStart}&date=lte.${dateEnd}&order=date.asc`

    if (accountId) {
      // For portal: validate the account is in the allowed list
      if (allowedAccountIds && !allowedAccountIds.includes(accountId)) {
        url += `&account_id=in.(${allowedAccountIds.join(',')})`
      } else {
        url += `&account_id=eq.${accountId}`
      }
    } else if (allowedAccountIds) {
      url += `&account_id=in.(${allowedAccountIds.join(',')})`
    } else {
      const accountIds = getAccounts().map(a => a.id)
      url += `&account_id=in.(${accountIds.join(',')})`
    }

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    })

    const rows = await response.json()
    return NextResponse.json({ rows })
  } catch (err) {
    console.error('Daily API error:', err)
    return NextResponse.json({ error: 'Failed to fetch daily data' }, { status: 500 })
  }
}
