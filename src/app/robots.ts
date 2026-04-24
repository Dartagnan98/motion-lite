import type { MetadataRoute } from 'next'
import { getPublicSiteBaseUrl } from '@/lib/public-site-url'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicSiteBaseUrl()
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
