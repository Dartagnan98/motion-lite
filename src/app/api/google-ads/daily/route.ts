import { NextRequest, NextResponse } from 'next/server'
import { getAllEnabledGoogleAdsAccounts } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  return getAllEnabledGoogleAdsAccounts().map(a => ({ id: a.customer_id, name: a.account_name, slug: a.client_slug || '' }))
}

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const accountId = req.nextUrl.searchParams.get('account') || null

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
    let url = `${SUPABASE_URL}/rest/v1/google_ads_daily?select=*&date=gte.${dateStart}&date=lte.${dateEnd}&order=date.asc`

    if (accountId) {
      url += `&customer_id=eq.${accountId}`
    } else {
      const accountIds = getAccounts().map(a => a.id)
      if (accountIds.length > 0) {
        url += `&customer_id=in.(${accountIds.join(',')})`
      }
    }

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    })

    const rows = await response.json()
    return NextResponse.json({ rows })
  } catch (err) {
    console.error('Google Ads daily API error:', err)
    return NextResponse.json({ error: 'Failed to fetch daily data' }, { status: 500 })
  }
}
