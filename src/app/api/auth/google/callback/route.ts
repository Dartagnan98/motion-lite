import { NextRequest, NextResponse } from 'next/server'
import { upsertUser, createSession, createUser, getUserByEmail } from '@/lib/auth'
import { saveProviderToken } from '@/lib/provider-tokens'
import { syncUserAvatarToTeamMember, getPendingInvitationByEmail, acceptInvitation, createPrivateWorkspace } from '@/lib/db'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', process.env.APP_URL || 'https://app.example.com'))
  }

  // Verify OAuth CSRF state token
  const state = req.nextUrl.searchParams.get('state')
  const cookieStore = await cookies()
  const savedState = cookieStore.get('oauth_state')?.value
  cookieStore.delete('oauth_state')
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL('/login?error=invalid_state', process.env.APP_URL || 'https://app.example.com'))
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID!
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
    const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || 'https://app.example.com/api/auth/google/callback'

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      console.error('Token exchange failed:', tokens)
      return NextResponse.redirect(new URL('/login?error=token_failed', process.env.APP_URL || 'https://app.example.com'))
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await userRes.json()
    const email = profile.email?.toLowerCase()

    // Check if user already exists
    let user = await getUserByEmail(email)

    if (!user) {
      // Check for pending invitation
      const invitation = getPendingInvitationByEmail(email)
      if (!invitation) {
        console.error('Google auth error: No account found. Contact your workspace admin for an invite.')
        return NextResponse.redirect(new URL('/login?error=no_invite', process.env.APP_URL || 'https://app.example.com'))
      }

      // Create user from invitation
      const role = invitation.role === 'client' ? 'client' : 'team'
      user = await createUser(email, profile.name || invitation.name || email, profile.picture, role)
      createPrivateWorkspace(user.id)

      // Accept the invitation (adds user to workspace)
      acceptInvitation(invitation.token, user.id)
      console.log(`[auth] Auto-accepted invitation for ${email}, added to workspace ${invitation.workspace_id}`)
    } else {
      // Existing user, just update
      user = await upsertUser(email, profile.name || email, profile.picture)
    }

    if (profile.picture) syncUserAvatarToTeamMember(user.id, profile.picture)

    await saveProviderToken(user.id, 'google', tokens.access_token, tokens.refresh_token || null, tokens.expires_in || 3600, profile.id, profile.email)

    const sessionId = await createSession(user.id)

    cookieStore.set('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    })

    return NextResponse.redirect(new URL('/', process.env.APP_URL || 'https://app.example.com'))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('Google auth error:', message)
    return NextResponse.redirect(new URL('/login?error=auth_failed', process.env.APP_URL || 'https://app.example.com'))
  }
}
