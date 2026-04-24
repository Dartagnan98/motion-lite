import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listPublishedCrmHelpCenters } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default function HelpIndexPage() {
  const centers = listPublishedCrmHelpCenters(50)
  if (centers.length === 1) {
    redirect(`/help/${centers[0].public_slug}`)
  }

  return (
    <div data-theme="light" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ width: 'min(980px, calc(100vw - 32px))', margin: '0 auto', padding: '72px 0 96px' }}>
        <div style={{ maxWidth: 640, marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 12 }}>
            Help centers
          </div>
          <h1 style={{ fontSize: 44, lineHeight: 1, letterSpacing: '-0.05em', margin: '0 0 12px' }}>
            Self-service support, organized by workspace.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 }}>
            Pick a published help center below.
          </p>
        </div>
        {centers.length === 0 ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 20, background: 'var(--bg-elevated)', padding: 24, boxShadow: 'var(--glass-shadow)' }}>
            <div style={{ fontSize: 15, color: 'var(--text)' }}>No published help centers yet.</div>
            <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-dim)' }}>
              Publish a help center from the CRM to make it available here.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {centers.map((center) => (
              <Link
                key={center.id}
                href={`/help/${center.public_slug}`}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 20,
                  background: 'var(--bg-elevated)',
                  padding: 22,
                  boxShadow: 'var(--glass-shadow)',
                  color: 'inherit',
                  textDecoration: 'none',
                  display: 'block',
                }}
              >
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 12 }}>
                  /help/{center.public_slug}
                </div>
                <div style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: '-0.03em', marginBottom: 8 }}>{center.name}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                  {center.tagline || center.description || 'Browse collections, search articles, and get routed to support when self-service runs out.'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
