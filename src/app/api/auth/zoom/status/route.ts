import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getProviderToken } from '@/lib/provider-tokens'

export async function GET() {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ connected: false })

  const token = await getProviderToken(user.id, 'zoom')
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    email: token.provider_email || null,
  })
}
