import { redirect } from 'next/navigation'
import { getCrmHelpCenterBySlug, getCrmHelpCollectionBySlug } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function LegacyHelpCollectionPage({
  params,
}: {
  params: Promise<{ centerSlug: string; collectionSlug: string }>
}) {
  const { centerSlug, collectionSlug } = await params
  const center = getCrmHelpCenterBySlug(centerSlug)
  if (!center) redirect('/help')
  const collection = getCrmHelpCollectionBySlug(center.id, collectionSlug)
  if (!collection) redirect(`/help/${center.public_slug}`)
  redirect(`/help/${center.public_slug}/${collection.slug}`)
}
