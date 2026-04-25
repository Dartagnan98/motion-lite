import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getProviderToken } from '@/lib/provider-tokens'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ connected: false })

  const token = await getProviderToken(user.id, 'google_ads')
  if (!token) return NextResponse.json({ connected: false })

  const expired = token.token_expiry < Math.floor(Date.now() / 1000)

  return NextResponse.json({
    connected: true,
    expired,
    email: token.provider_email,
  })
}
