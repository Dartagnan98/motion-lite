import Link from 'next/link'
import type { CrmHelpCenter } from '@/lib/db'

export function buildHelpArticleHref(centerSlug: string, collectionSlug: string | null, articleSlug: string): string {
  return collectionSlug
    ? `/help/${centerSlug}/${collectionSlug}/${articleSlug}`
    : `/help/${centerSlug}/a/${articleSlug}`
}

export function PublicHelpShell({
  center,
  children,
}: {
  center: CrmHelpCenter
  children: React.ReactNode
}) {
  return (
    <div
      data-theme="light"
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-chrome)' }}>
        <div
          style={{
            width: 'min(1120px, calc(100vw - 32px))',
            margin: '0 auto',
            padding: '16px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Link
            href={`/help/${center.public_slug}`}
            style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'inherit', textDecoration: 'none', minWidth: 0 }}
          >
            {center.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={center.logo_url} alt={center.name} style={{ height: 28, width: 'auto', display: 'block' }} />
            ) : (
              <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>{center.name}</span>
            )}
            {center.tagline && (
              <span style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {center.tagline}
              </span>
            )}
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {center.support_email && (
              <a href={`mailto:${center.support_email}`} style={{ fontSize: 12, color: 'var(--text-dim)', textDecoration: 'none' }}>
                {center.support_email}
              </a>
            )}
          </div>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-chrome)' }}>
        <div
          style={{
            width: 'min(1120px, calc(100vw - 32px))',
            margin: '0 auto',
            padding: '14px 0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
            {center.name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            © {new Date().getFullYear()} {center.name}
          </span>
        </div>
      </footer>
    </div>
  )
}

export function isHelpCenterAccessible(center: CrmHelpCenter, cookieValue: string | undefined): boolean {
  if (center.status !== 'published') return false
  if (center.public_visibility === 'public') return true
  return Boolean(cookieValue)
}
