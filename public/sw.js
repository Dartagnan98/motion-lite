const ASSET_CACHE = 'ctrl-motion-assets-v8'
const NETWORK_CACHE = 'ctrl-motion-network-v8'
const OFFLINE_URL = '/crm/offline'
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => ![ASSET_CACHE, NETWORK_CACHE].includes(key))
        .map((key) => caches.delete(key)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isStaticAsset(request, url) {
  return request.destination === 'script'
    || request.destination === 'style'
    || request.destination === 'font'
    || url.pathname.startsWith('/_next/static/')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.woff2')
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok && request.method === 'GET') {
    const cache = await caches.open(ASSET_CACHE)
    cache.put(request, response.clone()).catch(() => undefined)
  }
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok && request.method === 'GET') {
      const cache = await caches.open(NETWORK_CACHE)
      cache.put(request, response.clone()).catch(() => undefined)
    }
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached

    const url = new URL(request.url)
    if (request.mode === 'navigate' && url.pathname.startsWith('/crm')) {
      const offline = await caches.match(OFFLINE_URL)
      if (offline) return offline
    }

    if (isApiRequest(url)) {
      return new Response(JSON.stringify({ data: null, error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isStaticAsset(request, url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate' || isApiRequest(url) || request.destination === 'document') {
    event.respondWith(networkFirst(request))
  }
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Motion Lite', body: 'New notification', url: '/crm/today' }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Motion Lite', {
      body: data.body || '',
      icon: '/notification-icon-192.png',
      badge: '/notification-icon-192.png',
      tag: data.tag || 'default',
      data: { url: data.url || '/crm/today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/crm/today'
  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windowClients) {
      if (!client.url.startsWith(self.location.origin)) continue
      if ('navigate' in client) await client.navigate(targetUrl)
      if ('focus' in client) return client.focus()
    }
    return clients.openWindow(targetUrl)
  })())
})
