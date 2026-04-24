import type { MetadataRoute } from 'next'
import { getPublicSiteBaseUrl } from '@/lib/public-site-url'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getPublicSiteBaseUrl()
  return [
    { url: baseUrl, lastModified: new Date().toISOString() },
  ]
}
