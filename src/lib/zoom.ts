import { getProviderToken, updateProviderToken } from './provider-tokens'

// ─── OAuth ───

export function getZoomOAuthUrl(state?: string): string {
  const clientId = process.env.ZOOM_CLIENT_ID
  const redirectUri = process.env.ZOOM_REDIRECT_URI || 'https://app.example.com/api/auth/zoom/callback'
  if (!clientId) throw new Error('ZOOM_CLIENT_ID not set')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
  })
  if (state) params.set('state', state)

  return `https://zoom.us/oauth/authorize?${params.toString()}`
}

export async function exchangeZoomCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  email: string
  name: string
  avatar_url: string
  zoom_user_id: string
}> {
  const clientId = process.env.ZOOM_CLIENT_ID!
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!
  const redirectUri = process.env.ZOOM_REDIRECT_URI || 'https://app.example.com/api/auth/zoom/callback'

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const tokenRes = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokens.access_token) throw new Error('Zoom token exchange failed: ' + JSON.stringify(tokens))

  // Get user info
  const userRes = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const profile = await userRes.json()

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    email: profile.email,
    name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email,
    avatar_url: profile.pic_url || '',
    zoom_user_id: profile.id,
  }
}

async function refreshZoomToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'zoom')
  if (!token?.refresh_token) throw new Error('No Zoom refresh token')

  const clientId = process.env.ZOOM_CLIENT_ID!
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Zoom token refresh failed')

  await updateProviderToken(userId, 'zoom', data.access_token, data.refresh_token || token.refresh_token, data.expires_in)

  return data.access_token
}

export async function getValidZoomToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'zoom')
  if (!token) throw new Error('No Zoom token for user')

  const now = Math.floor(Date.now() / 1000)
  if (token.token_expiry > now + 60) return token.access_token
  return refreshZoomToken(userId)
}

// ─── Meeting Creation ───

export async function createZoomMeeting(userId: number, opts: {
  topic: string
  startTime: string  // ISO datetime
  duration: number   // minutes
}): Promise<{ join_url: string; meeting_id: number; password: string }> {
  const token = await getValidZoomToken(userId)

  const res = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: opts.topic,
      type: 2, // Scheduled meeting
      start_time: opts.startTime,
      duration: opts.duration,
      timezone: 'America/Los_Angeles',
      settings: {
        join_before_host: true,
        waiting_room: false,
        auto_recording: 'none',
      },
    }),
  })
  const data = await res.json()
  if (!data.join_url) throw new Error('Failed to create Zoom meeting: ' + JSON.stringify(data))

  return {
    join_url: data.join_url,
    meeting_id: data.id,
    password: data.password || '',
  }
}
