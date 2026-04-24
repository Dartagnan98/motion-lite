import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public paths that don't require any auth
const PUBLIC_PATHS = ['/login', '/invite', '/uploads/', '/api/auth/', '/booking', '/api/booking', '/published/', '/portal/', '/api/portal', '/api/messages/ai-queue', '/api/dispatch/queue', '/api/push/sse', '/api/push/test', '/api/push/poll', '/api/webhooks/', '/api/forms/', '/api/calendars/', '/api/webchat/', '/api/unsubscribe', '/api/pixel/', '/api/public/', '/api/cron/', '/f/', '/b/', '/w/', '/u/', '/s/', '/help', '/c/', '/p/invoices/', '/pay/']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Local dev bypass — skip all auth on localhost
  if (process.env.BYPASS_AUTH === 'true') {
    return NextResponse.next()
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const response = NextResponse.next()
    if (pathname.startsWith('/published/')) {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    }
    return response
  }

  // Allow static assets and Next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Allow portal-authenticated API requests (routes handle their own auth)
  if ((pathname.startsWith('/api/ads/dashboard') || pathname.startsWith('/api/ads/daily')) && request.nextUrl.searchParams.get('portal_slug')) {
    return NextResponse.next()
  }

  // Allow portal-scoped ads API requests (routes validate portal_token themselves)
  if (pathname.startsWith('/api/ads/') && request.nextUrl.searchParams.get('portal_slug')) {
    return NextResponse.next()
  }

  // Allow internal API calls from agent runtime -- validate token VALUE via route handler
  // Middleware validates against env var if set; route handlers do full validation
  const internalToken = request.headers.get('x-internal-token')
  if (internalToken && pathname.startsWith('/api/')) {
    const envSecret = process.env.INTERNAL_API_SECRET
    if (envSecret && internalToken !== envSecret) {
      return NextResponse.json({ error: 'Invalid internal token' }, { status: 401 })
    }
    // Token present (and passes env check if available) -- let route handler do full validation
    const response = NextResponse.next()
    response.headers.set('x-auth-source', 'internal')
    return response
  }

  // Allow dispatch bridge requests with verified bridge secret
  const bridgeSecret = request.headers.get('x-bridge-secret')
  if (bridgeSecret && pathname.startsWith('/api/dispatch')) {
    const expectedBridgeSecret = process.env.BRIDGE_SECRET
    if (!expectedBridgeSecret || bridgeSecret !== expectedBridgeSecret) {
      return NextResponse.json({ error: 'Invalid bridge secret' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Allow Bearer token auth for external API and MCP server access
  // External API tokens (ctrl_...) are validated by route handlers
  // MCP API keys (ctrlm_...) are validated against env var here
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && pathname.startsWith('/api/')) {
    const token = authHeader.slice(7)
    if (token.startsWith('ctrlm_')) {
      const validKey = process.env.CTRL_MOTION_API_KEY
      if (validKey && token === validKey) {
        const response = NextResponse.next()
        response.headers.set('x-auth-source', 'api-key')
        return response
      }
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }
    if (token.startsWith('ctrl_') && pathname.startsWith('/api/external/')) {
      // Let external API route handlers validate the token and scopes
      const response = NextResponse.next()
      response.headers.set('x-auth-source', 'external-token')
      return response
    }
  }

  // Check for session cookie
  const session = request.cookies.get('session')?.value
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Session cookie exists -- pass it along for route-level validation
  const response = NextResponse.next()

  // Prevent aggressive browser caching of HTML pages (fixes iOS Safari stale JS)
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/_next')) {
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
