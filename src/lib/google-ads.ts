// Google Ads OAuth + API helpers
// Uses provider='google_ads' in provider_tokens (separate from 'google' used for login/calendar)
import { getProviderToken, updateProviderToken } from './provider-tokens'

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v22'

// ─── OAuth ───

export function getGoogleAdsOAuthUrl(state?: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 'https://app.example.com/api/auth/google-ads/callback'
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not set')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
  })
  if (state) params.set('state', state)

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGoogleAdsCode(code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  email: string
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI || 'https://app.example.com/api/auth/google-ads/callback'

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenRes.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number
    error?: string; error_description?: string
  }
  if (!tokens.access_token) throw new Error('Google Ads token exchange failed: ' + (tokens.error_description || JSON.stringify(tokens)))

  // Get email
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const user = await userRes.json() as { email?: string }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || '',
    expires_in: tokens.expires_in || 3600,
    email: user.email || '',
  }
}

export async function refreshGoogleAdsToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'google_ads')
  if (!token || !token.refresh_token) throw new Error('No Google Ads refresh token for user')

  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string }
  if (!data.access_token) throw new Error('Google Ads token refresh failed: ' + (data.error || 'unknown'))

  await updateProviderToken(userId, 'google_ads', data.access_token, undefined, data.expires_in || 3600)
  return data.access_token
}

export async function getValidGoogleAdsToken(userId: number): Promise<string> {
  const token = await getProviderToken(userId, 'google_ads')
  if (!token) throw new Error('No Google Ads token for user')

  const now = Math.floor(Date.now() / 1000)
  if (token.token_expiry > now + 300) return token.access_token // valid for 5+ min

  return refreshGoogleAdsToken(userId)
}

// ─── Google Ads API Helpers ───

function getDevToken(): string {
  const t = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!t) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not set')
  return t
}

function getMccId(): string | undefined {
  return process.env.GOOGLE_ADS_MCC_ID || undefined
}

function adsHeaders(accessToken: string, options?: { includeMcc?: boolean; loginCustomerId?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': getDevToken(),
    'Content-Type': 'application/json',
  }
  if (options?.loginCustomerId) {
    headers['login-customer-id'] = options.loginCustomerId.replace(/-/g, '')
  } else if (options?.includeMcc !== false) {
    const mcc = getMccId()
    if (mcc) headers['login-customer-id'] = mcc.replace(/-/g, '')
  }
  return headers
}

export interface GoogleAdsAccount {
  customer_id: string       // e.g. "1234567890" (no dashes)
  descriptive_name: string
  currency_code: string
  manager: boolean
  status: string            // ENABLED, CANCELLED, SUSPENDED, CLOSED
}

export async function fetchAccessibleCustomers(accessToken: string): Promise<string[]> {
  const url = `${GOOGLE_ADS_API}/customers:listAccessibleCustomers`
  const res = await fetch(url, {
    headers: adsHeaders(accessToken, { includeMcc: false }),
  })
  const text = await res.text()
  let data: { resourceNames?: string[]; error?: { message: string } }
  try { data = JSON.parse(text) } catch { console.error('[google-ads] Non-JSON response'); return [] }
  if (data.error) {
    console.error('[google-ads] listAccessibleCustomers error:', data.error.message)
    return []
  }
  // resourceNames like ["customers/1234567890"]
  return (data.resourceNames || []).map(r => r.replace('customers/', ''))
}

export async function fetchCustomerDetails(accessToken: string, customerId: string): Promise<GoogleAdsAccount | null> {
  const query = `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1`
  const cleanId = customerId.replace(/-/g, '')

  // Try with the customer's own ID first (for direct access), fall back to MCC
  let res = await fetch(`${GOOGLE_ADS_API}/customers/${cleanId}/googleAds:searchStream`, {
    method: 'POST',
    headers: adsHeaders(accessToken, { loginCustomerId: cleanId }),
    body: JSON.stringify({ query }),
  })
  let data = await res.json() as Array<{ results?: Array<{ customer?: { id?: string; descriptiveName?: string; currencyCode?: string; manager?: boolean; status?: string } }> }> | { error?: { message: string; status: string } }

  // If direct access fails and we have an MCC, try through MCC
  if ('error' in data && data.error && getMccId()) {
    res = await fetch(`${GOOGLE_ADS_API}/customers/${cleanId}/googleAds:searchStream`, {
      method: 'POST',
      headers: adsHeaders(accessToken, { includeMcc: true }),
      body: JSON.stringify({ query }),
    })
    data = await res.json() as typeof data
  }

  if ('error' in data && data.error) {
    console.error(`[google-ads] fetchCustomerDetails(${cleanId}) error:`, data.error.message)
    return null
  }

  const results = Array.isArray(data) ? data : []
  const customer = results[0]?.results?.[0]?.customer
  if (!customer) return null

  return {
    customer_id: String(customer.id || cleanId),
    descriptive_name: customer.descriptiveName || 'Unnamed Account',
    currency_code: customer.currencyCode || 'CAD',
    manager: customer.manager || false,
    status: customer.status || 'UNKNOWN',
  }
}

// Walk an MCC's tree to get every sub-account.
// listAccessibleCustomers only returns top-level access, which misses
// sub-accounts that only exist under a manager.
export async function fetchMccChildAccounts(accessToken: string, mccId: string): Promise<GoogleAdsAccount[]> {
  const cleanMcc = mccId.replace(/-/g, '')
  const query = `
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.manager,
      customer_client.status
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'
  `.trim()

  const res = await fetch(`${GOOGLE_ADS_API}/customers/${cleanMcc}/googleAds:searchStream`, {
    method: 'POST',
    headers: adsHeaders(accessToken, { loginCustomerId: cleanMcc }),
    body: JSON.stringify({ query }),
  })
  const data = await res.json()

  if (!Array.isArray(data) || data[0]?.error) {
    console.error(`[google-ads] fetchMccChildAccounts(${cleanMcc}) error:`, JSON.stringify(data).substring(0, 300))
    return []
  }

  const accounts: GoogleAdsAccount[] = []
  for (const batch of data) {
    for (const row of batch.results || []) {
      const c = row.customerClient
      if (!c || !c.id) continue
      accounts.push({
        customer_id: String(c.id),
        descriptive_name: c.descriptiveName || 'Unnamed Account',
        currency_code: c.currencyCode || 'CAD',
        manager: c.manager || false,
        status: c.status || 'UNKNOWN',
      })
    }
  }
  return accounts
}

export async function fetchUserGoogleAdsAccounts(accessToken: string): Promise<GoogleAdsAccount[]> {
  const mccId = getMccId()
  const byId = new Map<string, GoogleAdsAccount>()

  // 1. Walk the MCC tree if configured — this catches every sub-account.
  if (mccId) {
    const mccChildren = await fetchMccChildAccounts(accessToken, mccId)
    for (const a of mccChildren) {
      if (a.status !== 'CANCELLED' && a.status !== 'CLOSED') byId.set(a.customer_id, a)
    }
  }

  // 2. Add any directly-accessible customers that aren't already in the map
  //    (e.g. standalone accounts not linked to the MCC).
  const topLevelIds = await fetchAccessibleCustomers(accessToken)
  for (const id of topLevelIds) {
    if (byId.has(id)) continue
    const details = await fetchCustomerDetails(accessToken, id)
    if (details && details.status !== 'CANCELLED' && details.status !== 'CLOSED') {
      byId.set(details.customer_id, details)
    }
  }

  return Array.from(byId.values())
}

// ─── GAQL Query Execution ───

export interface SearchStreamResult {
  results: Array<Record<string, unknown>>
}

export async function executeGaqlQuery(
  accessToken: string,
  customerId: string,
  query: string
): Promise<SearchStreamResult[]> {
  const cleanId = customerId.replace(/-/g, '')
  const res = await fetch(`${GOOGLE_ADS_API}/customers/${cleanId}/googleAds:searchStream`, {
    method: 'POST',
    headers: adsHeaders(accessToken),
    body: JSON.stringify({ query }),
  })
  const data = await res.json()

  if (data?.error) {
    console.error(`[google-ads] GAQL error for ${cleanId}:`, JSON.stringify(data.error))
    return []
  }
  if (!Array.isArray(data)) {
    console.error(`[google-ads] GAQL non-array response for ${cleanId}:`, JSON.stringify(data).substring(0, 400))
    return []
  }
  // searchStream returns an array of batches; an error can be wrapped in the first element
  if (data[0]?.error) {
    console.error(`[google-ads] GAQL stream error for ${cleanId}:`, JSON.stringify(data[0].error).substring(0, 400))
    return []
  }

  return data
}
