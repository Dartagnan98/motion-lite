'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function AdsIframe() {
  const searchParams = useSearchParams()

  // Forward any query params to the dashboard route
  const params = searchParams.toString()
  const src = `/api/ads/dashboard${params ? '?' + params : ''}`

  return (
    <iframe
      src={src}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: 'var(--bg-chrome)',
      }}
      title="Meta Ads Dashboard"
    />
  )
}

export default function AdsPage() {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
    }}>
      <Suspense fallback={
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-dim)',

          fontSize: '14px',
        }}>
          Loading Meta Ads...
        </div>
      }>
        <AdsIframe />
      </Suspense>
    </div>
  )
}
