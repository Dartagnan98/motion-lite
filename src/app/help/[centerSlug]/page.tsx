import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  getCrmHelpCenterBySlug,
  listPublicCrmHelpCollections,
  listPublishedCrmHelpArticles,
} from '@/lib/db'
import { PasswordGate } from './PasswordGate'
import { PublicSearchBar } from './PublicSearchBar'
import { PublicHelpShell, buildHelpArticleHref, isHelpCenterAccessible } from './helpShell'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ centerSlug: string }> },
): Promise<Metadata> {
  const { centerSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) return { title: 'Not found' }
  return {
    title: center.name,
    description: center.tagline || center.description || `${center.name} help center`,
  }
}

export default async function HelpCenterHome({ params }: { params: Promise<{ centerSlug: string }> }) {
  const { centerSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center || center.status !== 'published') notFound()

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(`ctrl_help_${center.public_slug}`)?.value
  if (!isHelpCenterAccessible(center, accessCookie)) return <PasswordGate center={center} />

  const collections = listPublicCrmHelpCollections(center.id)
  const popularArticles = listPublishedCrmHelpArticles(center.id, { limit: 6 })
  const collectionSlugById = new Map(collections.map((collection) => [collection.id, collection.slug]))

  return (
    <PublicHelpShell center={center}>
      <section style={{ width: 'min(1120px, calc(100vw - 32px))', margin: '0 auto', padding: '54px 0 36px' }}>
        <div style={{ textAlign: 'center', maxWidth: 760, margin: '0 auto 26px' }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 14 }}>
            Self-service help
          </div>
          <h1 style={{ fontSize: 'clamp(40px, 7vw, 72px)', lineHeight: 0.96, letterSpacing: '-0.06em', margin: '0 0 12px', color: 'var(--text)' }}>
            {center.hero_headline || center.name}
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--text-dim)', margin: '0 auto 24px', maxWidth: 620 }}>
            {center.tagline || center.hero_subheadline || 'Search for an answer, then browse the collections below for the full library.'}
          </p>
          <div style={{ width: 'min(720px, 100%)', margin: '0 auto' }}>
            <PublicSearchBar centerSlug={center.public_slug} hero />
          </div>
        </div>

        {collections.length > 0 && (
          <div className="help-collection-grid">
            {collections.map((collection, index) => (
              <Link
                key={collection.id}
                href={`/help/${center.public_slug}/${collection.slug}`}
                style={{
                  display: 'block',
                  border: '1px solid var(--border)',
                  borderRadius: 24,
                  background: 'var(--bg-elevated)',
                  padding: index === 0 ? '26px 26px 30px' : '22px',
                  boxShadow: 'var(--glass-shadow)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
                  <div style={{ fontSize: index === 0 ? 30 : 24, lineHeight: 1 }}>{collection.icon || '•'}</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
                    {collection.article_count || 0} article{collection.article_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ fontSize: index === 0 ? 30 : 22, lineHeight: 1.02, letterSpacing: '-0.04em', marginBottom: 10 }}>{collection.name}</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)', maxWidth: index === 0 ? 420 : 'none' }}>
                  {collection.description || 'Open this collection to browse every article in one place.'}
                </div>
              </Link>
            ))}
          </div>
        )}

        {popularArticles.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 6 }}>
                  Popular articles
                </div>
                <div style={{ fontSize: 18, letterSpacing: '-0.02em' }}>Start with the pages people use most.</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              {popularArticles.map((article) => (
                <Link
                  key={article.id}
                  href={buildHelpArticleHref(center.public_slug, article.collection_id ? collectionSlugById.get(article.collection_id) || null : null, article.slug)}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 18,
                    background: 'var(--bg-elevated)',
                    padding: 18,
                    boxShadow: 'var(--glass-shadow)',
                    color: 'inherit',
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 8 }}>{article.title}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)' }}>{article.excerpt || 'Open the article for the full answer.'}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </section>

      <style>{`
        .help-collection-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .help-collection-grid > :first-child {
          grid-column: span 2;
        }
        @media (max-width: 920px) {
          .help-collection-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .help-collection-grid > :first-child {
            grid-column: span 2;
          }
        }
        @media (max-width: 640px) {
          .help-collection-grid {
            grid-template-columns: 1fr;
          }
          .help-collection-grid > :first-child {
            grid-column: span 1;
          }
        }
      `}</style>
    </PublicHelpShell>
  )
}
