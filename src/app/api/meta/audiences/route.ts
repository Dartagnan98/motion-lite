import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import { getCustomAudiences, createCustomAudience, createLookalikeAudience } from '@/lib/meta-campaign-api'

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
  if (!accountId) return NextResponse.json({ error: 'account_id or account name required' }, { status: 400 })

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
    const data = await getCustomAudiences(accountId, limit)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as {
    account_id?: string
    account?: string
    account_name?: string
    action?: string // 'lookalike'
    name: string
    description?: string
    subtype?: string
    // Lookalike specific
    origin_audience_id?: string
    country?: string
    ratio?: number
  }

  const accountId = await resolveAccount({ account_id: body.account_id, account: body.account, account_name: body.account_name }, user.id)
  if (!accountId || !body.name) {
    return NextResponse.json({ error: 'account_id (or account name) and name required' }, { status: 400 })
  }

  try {
    if (body.action === 'lookalike') {
      if (!body.origin_audience_id || !body.country || !body.ratio) {
        return NextResponse.json({ error: 'origin_audience_id, country, and ratio required for lookalike' }, { status: 400 })
      }
      const data = await createLookalikeAudience(accountId, {
        name: body.name,
        origin_audience_id: body.origin_audience_id,
        country: body.country,
        ratio: body.ratio,
        description: body.description,
      })
      return NextResponse.json(data)
    }

    const data = await createCustomAudience(accountId, {
      name: body.name,
      description: body.description,
      subtype: body.subtype || 'CUSTOM',
    })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
