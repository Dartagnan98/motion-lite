import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  getCrmHelpCenterBySlug,
  getCrmHelpCollectionBySlug,
  listPublishedCrmHelpArticles,
} from '@/lib/db'
import { PasswordGate } from '../PasswordGate'
import { PublicSearchBar } from '../PublicSearchBar'
import { PublicHelpShell, buildHelpArticleHref, isHelpCenterAccessible } from '../helpShell'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ centerSlug: string; collectionSlug: string }> },
): Promise<Metadata> {
  const { centerSlug, collectionSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) return { title: 'Not found' }
  const collection = getCrmHelpCollectionBySlug(center.id, collectionSlug)
  if (!collection) return { title: 'Not found' }
  return {
    title: `${collection.name} — ${center.name}`,
    description: collection.description || `Browse ${collection.name} articles on ${center.name}.`,
  }
}

export default async function HelpCollectionPage({
  params,
}: {
  params: Promise<{ centerSlug: string; collectionSlug: string }>
}) {
  const { centerSlug, collectionSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center || center.status !== 'published') notFound()
  const collection = getCrmHelpCollectionBySlug(center.id, collectionSlug)
  if (!collection || collection.is_public !== 1) notFound()

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(`ctrl_help_${center.public_slug}`)?.value
  if (!isHelpCenterAccessible(center, accessCookie)) return <PasswordGate center={center} />

  const articles = listPublishedCrmHelpArticles(center.id, { collectionId: collection.id, limit: 500 })

  return (
    <PublicHelpShell center={center}>
      <div style={{ width: 'min(960px, calc(100vw - 32px))', margin: '0 auto', padding: '38px 0 72px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          <Link href={`/help/${center.public_slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{center.name}</Link>
          <span>/</span>
          <span>{collection.name}</span>
        </nav>
        <div style={{ display: 'grid', gap: 20, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
              Collection
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 0.98, letterSpacing: '-0.05em', margin: '0 0 10px' }}>{collection.name}</h1>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 }}>
              {collection.description || 'Every published article in this collection.'}
            </p>
          </div>
          <div style={{ width: 'min(720px, 100%)' }}>
            <PublicSearchBar centerSlug={center.public_slug} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {articles.map((article) => (
            <Link
              key={article.id}
              href={buildHelpArticleHref(center.public_slug, collection.slug, article.slug)}
              style={{
                display: 'block',
                border: '1px solid var(--border)',
                borderRadius: 18,
                background: 'var(--bg-elevated)',
                boxShadow: 'var(--glass-shadow)',
                padding: 18,
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 8 }}>{article.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)' }}>{article.excerpt || 'Open the article for the full answer.'}</div>
            </Link>
          ))}
          {articles.length === 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'var(--bg-elevated)', padding: 18, color: 'var(--text-dim)' }}>
              No published articles are in this collection yet.
            </div>
          )}
        </div>
      </div>
    </PublicHelpShell>
  )
}
