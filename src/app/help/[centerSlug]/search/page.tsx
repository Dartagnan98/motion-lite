import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  getCrmHelpCenterBySlug,
  listPublicCrmHelpCollections,
  recordCrmHelpSearchQuery,
  searchCrmHelpArticles,
} from '@/lib/db'
import { fireHelpSearchNoResultTrigger } from '@/lib/help-triggers'
import { PasswordGate } from '../PasswordGate'
import { PublicSearchBar } from '../PublicSearchBar'
import { AiAskPanel } from './AiAskPanel'
import { PublicHelpShell, buildHelpArticleHref, isHelpCenterAccessible } from '../helpShell'

export const dynamic = 'force-dynamic'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): ReactNode {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (!text || tokens.length === 0) return text
  const splitRegex = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'ig')
  const matchRegex = new RegExp(`^(${tokens.map(escapeRegExp).join('|')})$`, 'i')
  return text.split(splitRegex).map((part, index) => (
    matchRegex.test(part)
      ? <mark key={`${part}-${index}`} style={{ background: 'var(--bg-active)', color: 'var(--text)', padding: '0 2px', borderRadius: 3 }}>{part}</mark>
      : <span key={`${part}-${index}`}>{part}</span>
  ))
}

export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ centerSlug: string }>
    searchParams?: Promise<Record<string, string | string[] | undefined>>
  },
): Promise<Metadata> {
  const { centerSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) return { title: 'Not found' }
  const sp = (await searchParams) || {}
  const q = typeof sp.q === 'string' ? sp.q : ''
  return {
    title: q ? `${q} — ${center.name}` : `Search — ${center.name}`,
    description: q ? `Search results for ${q} on ${center.name}.` : `Search ${center.name}.`,
    robots: q ? 'noindex' : undefined,
  }
}

export default async function HelpSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ centerSlug: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { centerSlug } = await params
  const sp = (await searchParams) || {}
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center || center.status !== 'published') notFound()

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(`ctrl_help_${center.public_slug}`)?.value
  if (!isHelpCenterAccessible(center, accessCookie)) return <PasswordGate center={center} />

  const query = typeof sp.q === 'string' ? sp.q.trim() : ''
  const collections = listPublicCrmHelpCollections(center.id)
  const collectionSlugById = new Map(collections.map((collection) => [collection.id, collection.slug]))
  const hits = query ? searchCrmHelpArticles(center.id, query, { limit: 30 }) : []

  if (query) {
    recordCrmHelpSearchQuery({ helpCenterId: center.id, query, resultsCount: hits.length })
    if (hits.length === 0) fireHelpSearchNoResultTrigger(center.workspace_id, query)
  }

  return (
    <PublicHelpShell center={center}>
      <div style={{ width: 'min(960px, calc(100vw - 32px))', margin: '0 auto', padding: '40px 0 72px' }}>
        <div style={{ marginBottom: 22 }}>
          <PublicSearchBar centerSlug={center.public_slug} initialValue={query} hero />
        </div>

        {!query ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'var(--bg-elevated)', padding: 20 }}>
            <div style={{ fontSize: 15, color: 'var(--text)' }}>Type a question or a topic to search.</div>
            <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-dim)' }}>We match across article titles, excerpts, and body text.</div>
          </div>
        ) : hits.length === 0 ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'var(--bg-elevated)', padding: 22 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
                No matches
              </div>
              <h1 style={{ fontSize: 26, lineHeight: 1.05, letterSpacing: '-0.04em', margin: '0 0 10px' }}>Nothing matched “{query}”.</h1>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0 }}>
                Try different keywords, browse the collections, or ask AI if this help center has it enabled.
              </p>
            </div>
            {center.ai_search_enabled === 1 && <AiAskPanel centerSlug={center.public_slug} query={query} />}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 8 }}>
                Search results
              </div>
              <h1 style={{ fontSize: 28, lineHeight: 1.04, letterSpacing: '-0.04em', margin: 0 }}>
                {hits.length} result{hits.length === 1 ? '' : 's'} for “{query}”
              </h1>
            </div>
            {hits.map((hit) => (
              <Link
                key={hit.article.id}
                href={buildHelpArticleHref(center.public_slug, hit.article.collection_id ? collectionSlugById.get(hit.article.collection_id) || null : null, hit.article.slug)}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 18,
                  background: 'var(--bg-elevated)',
                  boxShadow: 'var(--glass-shadow)',
                  padding: 18,
                  color: 'inherit',
                  textDecoration: 'none',
                  display: 'block',
                }}
              >
                <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 8 }}>
                  {highlightText(hit.article.title, query)}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)' }}>
                  {highlightText(hit.snippet || hit.article.excerpt || '', query)}
                </div>
              </Link>
            ))}
            {center.ai_search_enabled === 1 && hits[0] && hits[0].score < 5 && <AiAskPanel centerSlug={center.public_slug} query={query} />}
          </div>
        )}
      </div>
    </PublicHelpShell>
  )
}
