'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function GoogleAdsIframe() {
  const searchParams = useSearchParams()
  const params = searchParams.toString()
  const src = `/api/google-ads/dashboard${params ? '?' + params : ''}`

  return (
    <iframe
      src={src}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: 'var(--bg-chrome)',
      }}
      title="Google Ads Dashboard"
    />
  )
}

export default function GoogleAdsPage() {
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
          Loading Google Ads...
        </div>
      }>
        <GoogleAdsIframe />
      </Suspense>
    </div>
  )
}
