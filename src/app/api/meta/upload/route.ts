import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveAdAccountId } from '@/lib/db'
import { uploadImage, uploadVideo } from '@/lib/meta-campaign-api'

/** Resolve account_id from query - accepts account_id, account (name/slug lookup), or account_name */
async function resolveAccount(params: { account_id?: string | null; account?: string | null; account_name?: string | null }, userId: number): Promise<string | null> {
  if (params.account_id) return params.account_id
  const query = params.account || params.account_name
  if (!query) return null
  const resolved = resolveAdAccountId(userId, query)
  return resolved?.account_id || null
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json() as {
    account_id?: string
    account?: string
    account_name?: string
    type: 'image' | 'video'
    url: string
    name?: string
  }

  const accountId = await resolveAccount({ account_id: body.account_id, account: body.account, account_name: body.account_name }, user.id)
  if (!accountId || !body.type || !body.url) {
    return NextResponse.json({ error: 'account_id (or account name), type, and url required' }, { status: 400 })
  }

  try {
    if (body.type === 'image') {
      const result = await uploadImage(accountId, body.url, body.name)
      return NextResponse.json(result)
    } else if (body.type === 'video') {
      const result = await uploadVideo(accountId, body.url, body.name)
      return NextResponse.json(result)
    } else {
      return NextResponse.json({ error: 'type must be image or video' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
