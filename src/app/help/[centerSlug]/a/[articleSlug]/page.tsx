import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import {
  getCrmHelpArticleBySlug,
  getCrmHelpCenterBySlug,
  getCrmHelpCollectionById,
} from '@/lib/db'
import { PasswordGate } from '../../PasswordGate'
import { PublicHelpShell, isHelpCenterAccessible } from '../../helpShell'
import { ArticleFeedback } from './ArticleFeedback'
import { HelpArticleContactForm } from '../../HelpArticleContactForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ centerSlug: string; articleSlug: string }> },
): Promise<Metadata> {
  const { centerSlug, articleSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) return { title: 'Not found' }
  const article = getCrmHelpArticleBySlug(center.id, articleSlug)
  if (!article || article.status !== 'published') return { title: 'Not found' }
  return {
    title: article.meta_title || `${article.title} — ${center.name}`,
    description: article.meta_description || article.excerpt || `${article.title} on ${center.name}.`,
  }
}

export default async function LegacyHelpArticlePage({
  params,
}: {
  params: Promise<{ centerSlug: string; articleSlug: string }>
}) {
  const { centerSlug, articleSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center || center.status !== 'published') notFound()

  const cookieStore = await cookies()
  const accessCookie = cookieStore.get(`ctrl_help_${center.public_slug}`)?.value
  if (!isHelpCenterAccessible(center, accessCookie)) return <PasswordGate center={center} />

  const article = getCrmHelpArticleBySlug(center.id, articleSlug)
  if (!article || article.status !== 'published') notFound()

  const collection = article.collection_id ? getCrmHelpCollectionById(article.collection_id, center.workspace_id) : null
  if (collection?.slug) {
    redirect(`/help/${center.public_slug}/${collection.slug}/${article.slug}`)
  }

  const updatedDate = article.last_updated_at
    ? new Date(article.last_updated_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <PublicHelpShell center={center}>
      <div style={{ width: 'min(920px, calc(100vw - 32px))', margin: '0 auto', padding: '34px 0 72px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>
          <Link href={`/help/${center.public_slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>{center.name}</Link>
          <span>/</span>
          <span>{article.title}</span>
        </nav>
        <article>
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
            className="legacy-help-article-body"
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
              <HelpArticleContactForm centerSlug={center.public_slug} articleSlug={article.slug} articleTitle={article.title} supportEmail={center.support_email} />
            </section>
          )}
        </article>
      </div>

      <style>{`
        .legacy-help-article-body h1,
        .legacy-help-article-body h2,
        .legacy-help-article-body h3,
        .legacy-help-article-body h4 {
          color: var(--text);
          letter-spacing: -0.03em;
          line-height: 1.08;
          margin: 1.7em 0 0.55em;
        }
        .legacy-help-article-body h2 { font-size: 1.9rem; }
        .legacy-help-article-body h3 { font-size: 1.45rem; }
        .legacy-help-article-body p { margin: 0 0 1em; color: var(--text-secondary); }
        .legacy-help-article-body ul,
        .legacy-help-article-body ol { margin: 0 0 1.1em; padding-left: 1.4em; color: var(--text-secondary); }
        .legacy-help-article-body li { margin: 0.4em 0; }
        .legacy-help-article-body a { color: var(--accent-text); text-underline-offset: 2px; }
        .legacy-help-article-body blockquote {
          margin: 1.2em 0;
          padding: 1em 1.1em;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--bg-elevated);
          color: var(--text-secondary);
        }
        .legacy-help-article-body code {
          font-family: var(--font-mono);
          background: var(--bg-field);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.1em 0.35em;
          font-size: 0.92em;
        }
        .legacy-help-article-body pre {
          margin: 1.2em 0;
          padding: 1em 1.1em;
          border-radius: 18px;
          overflow: auto;
          background: var(--bg-chrome);
          border: 1px solid var(--border);
          box-shadow: var(--glass-shadow);
        }
        .legacy-help-article-body pre code {
          background: transparent;
          border: 0;
          padding: 0;
        }
        .legacy-help-article-body hr {
          border: 0;
          border-top: 1px solid var(--border);
          margin: 2em 0;
        }
        .legacy-help-article-body img {
          max-width: 100%;
          height: auto;
          border-radius: 18px;
          display: block;
          margin: 1.2em 0;
        }
      `}</style>
    </PublicHelpShell>
  )
}
