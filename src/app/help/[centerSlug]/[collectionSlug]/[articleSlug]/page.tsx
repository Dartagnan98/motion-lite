import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  getCrmHelpArticleBySlug,
  getCrmHelpCenterBySlug,
  getCrmHelpCollectionBySlug,
  listPublishedCrmHelpArticles,
} from '@/lib/db'
import { PasswordGate } from '../../PasswordGate'
import { PublicHelpShell, buildHelpArticleHref, isHelpCenterAccessible } from '../../helpShell'
import { ArticleFeedback } from '../../a/[articleSlug]/ArticleFeedback'
import { HelpArticleContactForm } from '../../HelpArticleContactForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ centerSlug: string; collectionSlug: string; articleSlug: string }> },
): Promise<Metadata> {
  const { centerSlug, collectionSlug, articleSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) return { title: 'Not found' }
  const collection = getCrmHelpCollectionBySlug(center.id, collectionSlug)
  if (!collection) return { title: 'Not found' }
  const article = getCrmHelpArticleBySlug(center.id, articleSlug)
  if (!article || article.collection_id !== collection.id || article.status !== 'published') return { title: 'Not found' }
  return {
    title: article.meta_title || `${article.title} — ${center.name}`,
    description: article.meta_description || article.excerpt || `${article.title} on ${center.name}.`,
  }
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ centerSlug: string; collectionSlug: string; articleSlug: string }>
}) {
  const { centerSlug, collectionSlug, articleSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center || center.status !== 'published') notFound()
  const collection = getCrmHelpCollectionBySlug(center.id, collectionSlug)
  if (!collection || collection.is_public !== 1) notFound()
  const article = getCrmHelpArticleBySlug(center.id, articleSlug)
  if (!article || article.collection_id !== collection.id || article.status !== 'published') notFound()

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(`ctrl_help_${center.public_slug}`)?.value
  if (!isHelpCenterAccessible(center, accessCookie)) return <PasswordGate center={center} />

  const collectionArticles = listPublishedCrmHelpArticles(center.id, { collectionId: collection.id, limit: 500 })
  const updatedDate = article.last_updated_at
    ? new Date(article.last_updated_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <PublicHelpShell center={center}>
      <div style={{ width: 'min(1160px, calc(100vw - 32px))', margin: '0 auto', padding: '34px 0 72px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>
          <Link href={`/help/${center.public_slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{center.name}</Link>
          <span>/</span>
          <Link href={`/help/${center.public_slug}/${collection.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{collection.name}</Link>
          <span>/</span>
          <span>{article.title}</span>
        </nav>

        <div className="help-article-layout">
          <aside className="help-article-sidebar">
            <div style={{ border: '1px solid var(--border)', borderRadius: 20, background: 'var(--bg-elevated)', boxShadow: 'var(--glass-shadow)', padding: 18 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 12 }}>
                {collection.name}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {collectionArticles.map((entry) => {
                  const active = entry.id === article.id
                  return (
                    <Link
                      key={entry.id}
                      href={buildHelpArticleHref(center.public_slug, collection.slug, entry.slug)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: active ? 'var(--bg-active)' : 'transparent',
                        color: active ? 'var(--text)' : 'var(--text-dim)',
                        textDecoration: 'none',
                        display: 'block',
                      }}
                    >
                      <span style={{ fontSize: 14, lineHeight: 1.45 }}>{entry.title}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          </aside>

          <article style={{ minWidth: 0 }}>
            <header style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 12 }}>
                Article
              </div>
              <h1 style={{ fontSize: 'clamp(34px, 5vw, 54px)', lineHeight: 0.98, letterSpacing: '-0.06em', margin: '0 0 14px' }}>{article.title}</h1>
              {article.excerpt && <p style={{ fontSize: 17, lineHeight: 1.7, color: 'var(--text-dim)', margin: '0 0 12px' }}>{article.excerpt}</p>}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)' }}>
                {article.author_name && <span>By {article.author_name}</span>}
                {updatedDate && <span>Updated {updatedDate}</span>}
                <span>{article.views} views</span>
              </div>
            </header>

            <div
              className="help-article-body"
              style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--text)' }}
              dangerouslySetInnerHTML={{ __html: article.body_html || '' }}
            />

            <ArticleFeedback centerSlug={center.public_slug} articleSlug={article.slug} articleId={article.id} />

            {center.enable_contact_form === 1 && (
              <section style={{ marginTop: 36, border: '1px solid var(--border)', borderRadius: 22, background: 'var(--bg-elevated)', padding: 22, boxShadow: 'var(--glass-shadow)' }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
                  Still need help?
                </div>
                <h2 style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: '-0.04em', margin: '0 0 10px' }}>Send the team a follow-up request.</h2>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)', margin: '0 0 18px' }}>
                  Include the missing detail or the question this article did not cover, and we will route it into the CRM for follow-up.
                </p>
                <HelpArticleContactForm
                  centerSlug={center.public_slug}
                  articleSlug={article.slug}
                  articleTitle={article.title}
                  supportEmail={center.support_email}
                />
              </section>
            )}
          </article>
        </div>
      </div>

      <style>{`
        .help-article-layout {
          display: grid;
          grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
          gap: 24px;
          align-items: start;
        }
        .help-article-sidebar {
          position: sticky;
          top: 20px;
        }
        .help-article-body h1,
        .help-article-body h2,
        .help-article-body h3,
        .help-article-body h4 {
          color: var(--text);
          letter-spacing: -0.03em;
          line-height: 1.08;
          margin: 1.7em 0 0.55em;
        }
        .help-article-body h2 { font-size: 1.9rem; }
        .help-article-body h3 { font-size: 1.45rem; }
        .help-article-body p { margin: 0 0 1em; color: var(--text-secondary); }
        .help-article-body ul,
        .help-article-body ol { margin: 0 0 1.1em; padding-left: 1.4em; color: var(--text-secondary); }
        .help-article-body li { margin: 0.4em 0; }
        .help-article-body a { color: var(--accent-text); text-underline-offset: 2px; }
        .help-article-body blockquote {
          margin: 1.2em 0;
          padding: 1em 1.1em;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--bg-elevated);
          color: var(--text-secondary);
        }
        .help-article-body code {
          font-family: var(--font-mono);
          background: var(--bg-field);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.1em 0.35em;
          font-size: 0.92em;
        }
        .help-article-body pre {
          margin: 1.2em 0;
          padding: 1em 1.1em;
          border-radius: 18px;
          overflow: auto;
          background: var(--bg-chrome);
          border: 1px solid var(--border);
          box-shadow: var(--glass-shadow);
        }
        .help-article-body pre code {
          background: transparent;
          border: 0;
          padding: 0;
        }
        .help-article-body hr {
          border: 0;
          border-top: 1px solid var(--border);
          margin: 2em 0;
        }
        .help-article-body img {
          max-width: 100%;
          height: auto;
          border-radius: 18px;
          display: block;
          margin: 1.2em 0;
        }
        @media (max-width: 920px) {
          .help-article-layout {
            grid-template-columns: 1fr;
          }
          .help-article-sidebar {
            position: static;
          }
        }
      `}</style>
    </PublicHelpShell>
  )
}
