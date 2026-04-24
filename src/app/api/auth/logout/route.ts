import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { deleteSession } from '@/lib/auth'

export async function POST() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('session')?.value
  if (sessionId) {
    deleteSession(sessionId)
    cookieStore.delete('session')
  }
  return NextResponse.json({ ok: true })
}
