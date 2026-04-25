// Facebook OAuth + Graph API helpers for Meta ad accounts, pages, and Instagram
import { getProviderToken, updateProviderToken } from './provider-tokens'

const GRAPH_API = 'https://graph.facebook.com/v19.0'

// ─── OAuth ───

const SCOPES = [
  'email',
  'public_profile',
  'ads_read',
  'ads_management',
  'business_management',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
].join(',')

export function getFacebookOAuthUrl(state?: string): string {
  const appId = process.env.FACEBOOK_APP_ID
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 'https://app.example.com/api/auth/facebook/callback'
  if (!appId) throw new Error('FACEBOOK_APP_ID not set')

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
  })
  if (state) params.set('state', state)

  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`
}

export async function exchangeFacebookCode(code: string): Promise<{
  access_token: string
  expires_in: number
  email: string
  name: string
  avatar_url: string
  fb_user_id: string
}> {
  const appId = process.env.FACEBOOK_APP_ID!
  const appSecret = process.env.FACEBOOK_APP_SECRET!
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 'https://app.example.com/api/auth/facebook/callback'

  // Step 1: Exchange code for short-lived token
  const tokenRes = await fetch(`${GRAPH_API}/oauth/access_token?${new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })}`)
  const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } }
  if (!tokenData.access_token) throw new Error('Facebook token exchange failed: ' + JSON.stringify(tokenData))

  // Step 2: Exchange short-lived for long-lived token (~60 days)
  const longRes = await fetch(`${GRAPH_API}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: tokenData.access_token,
  })}`)
  const longData = await longRes.json() as { access_token?: string; expires_in?: number; error?: { message: string } }
  const accessToken = longData.access_token || tokenData.access_token
  const expiresIn = longData.expires_in || 5184000 // default 60 days

  // Step 3: Get user profile
  const profileRes = await fetch(`${GRAPH_API}/me?fields=id,name,email,picture.width(200).height(200)&access_token=${accessToken}`)
  const profile = await profileRes.json() as {
    id: string; name: string; email?: string
    picture?: { data?: { url?: string } }
    error?: { message: string }
  }
  if (profile.error) throw new Error('Facebook profile fetch failed: ' + profile.error.message)

  return {
    access_token: accessToken,
    expires_in: expiresIn,
    email: profile.email || '',
    name: profile.name || '',
    avatar_url: profile.picture?.data?.url || '',
    fb_user_id: profile.id,
  }
}

// Facebook doesn't have refresh tokens -- exchange a still-valid long-lived token for a new one
export async function refreshFacebookToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'facebook')
  if (!token) throw new Error('No Facebook token for user')

  const now = Math.floor(Date.now() / 1000)
  if (token.token_expiry < now) throw new Error('Facebook token expired -- user must re-authenticate')

  const appId = process.env.FACEBOOK_APP_ID!
  const appSecret = process.env.FACEBOOK_APP_SECRET!

  const res = await fetch(`${GRAPH_API}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token.access_token,
  })}`)
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: { message: string } }
  if (!data.access_token) throw new Error('Facebook token refresh failed: ' + JSON.stringify(data))

  await updateProviderToken(userId, 'facebook', data.access_token, null, data.expires_in || 5184000)

  return data.access_token
}

export async function getValidFacebookToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'facebook')
  if (!token) throw new Error('No Facebook token for user')

  const now = Math.floor(Date.now() / 1000)
  // Refresh if within 7 days of expiry
  if (token.token_expiry < now + 7 * 86400) {
    try {
      return await refreshFacebookToken(userId)
    } catch {
      // If refresh fails but token isn't expired yet, use current one
      if (token.token_expiry > now) return token.access_token
      throw new Error('Facebook token expired and refresh failed -- user must re-authenticate')
    }
  }
  return token.access_token
}

// ─── Graph API: Ad Accounts ───

export interface FacebookAdAccount {
  id: string            // e.g. "act_123456"
  name: string
  account_id: string    // numeric ID without "act_" prefix
  account_status: number // 1=active, 2=disabled, 3=unsettled, etc.
  currency: string
  business_name: string
}

export async function fetchUserAdAccounts(accessToken: string): Promise<FacebookAdAccount[]> {
  const accounts: FacebookAdAccount[] = []
  let url: string | null = `${GRAPH_API}/me/adaccounts?fields=name,account_id,account_status,currency,business_name&limit=100&access_token=${accessToken}`

  while (url) {
    const res = await fetch(url)
    const data = await res.json() as {
      data?: Array<{ id: string; name: string; account_id: string; account_status: number; currency: string; business_name?: string }>
      paging?: { next?: string }
      error?: { message: string }
    }
    if (data.error) {
      console.error('Facebook API error fetching ad accounts:', data.error.message)
      break
    }
    if (data.data) {
      for (const acc of data.data) {
        accounts.push({
          id: acc.id,
          name: acc.name || 'Unnamed Account',
          account_id: acc.account_id,
          account_status: acc.account_status,
          currency: acc.currency || 'USD',
          business_name: acc.business_name || '',
        })
      }
    }
    url = data.paging?.next || null
  }

  return accounts
}

// ─── Graph API: Pages ───

export interface FacebookPage {
  id: string
  name: string
  category: string
  access_token: string  // permanent page access token
  picture_url: string
  fan_count: number
  instagram_account_id: string | null
}

export async function fetchUserPages(accessToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = []
  let url: string | null = `${GRAPH_API}/me/accounts?fields=id,name,category,access_token,picture,fan_count&limit=100&access_token=${accessToken}`

  while (url) {
    const res = await fetch(url)
    const data = await res.json() as {
      data?: Array<{
        id: string; name: string; category: string; access_token: string
        picture?: { data?: { url?: string } }; fan_count?: number
      }>
      paging?: { next?: string }
      error?: { message: string }
    }
    if (data.error) {
      console.error('Facebook API error fetching pages:', data.error.message)
      break
    }
    if (data.data) {
      for (const page of data.data) {
        // Check for linked Instagram account
        let igId: string | null = null
        try {
          const igRes = await fetch(`${GRAPH_API}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`)
          const igData = await igRes.json() as { instagram_business_account?: { id: string } }
          igId = igData.instagram_business_account?.id || null
        } catch { /* ignore */ }

        pages.push({
          id: page.id,
          name: page.name,
          category: page.category || '',
          access_token: page.access_token,
          picture_url: page.picture?.data?.url || '',
          fan_count: page.fan_count || 0,
          instagram_account_id: igId,
        })
      }
    }
    url = data.paging?.next || null
  }

  return pages
}
