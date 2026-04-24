import { getDoc, getDocByPublicId } from '@/lib/db'
import { parseDocParams } from '@/lib/url-utils'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

function resolveDoc(id: number | string | null) {
  if (id === null) return null
  if (typeof id === 'number') return getDoc(id)
  return getDocByPublicId(id) || getDoc(parseInt(id)) // fallback to numeric parse
}

export async function generateMetadata({ params }: { params: Promise<{ params: string[] }> }): Promise<Metadata> {
  const { params: segments } = await params
  const docId = parseDocParams(segments)
  const doc = resolveDoc(docId)
  return {
    title: doc ? `${doc.title} | Motion Lite` : 'Document | Motion Lite',
    description: doc ? `Document: ${doc.title}` : 'Document in Motion Lite',
    openGraph: {
      title: doc?.title || 'Document',
      description: doc ? `Document: ${doc.title}` : 'Document in Motion Lite',
      siteName: 'Motion Lite',
    },
  }
}

export default function DocLayout({ children }: { children: React.ReactNode }) {
  return children
}
