'use client'

// /clients/[slug] — deep-link shim.
// The list+detail UI lives in src/app/clients/page.tsx. This thin client
// component swaps the path-style URL (`/clients/glenvalley-dental`) for the
// query-string form (`/clients?id=glenvalley-dental`) — required because the
// list page's auto-open effect reads `window.location.search`. We use
// `router.replace` so the URL actually changes (server-side `redirect()` does
// an in-place RSC render without changing the URL, which the effect can't see).

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function ClientSlugRedirect() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()

  useEffect(() => {
    const slug = params?.slug
    if (slug) router.replace(`/clients?id=${encodeURIComponent(slug)}`)
  }, [params?.slug, router])

  return null
}
