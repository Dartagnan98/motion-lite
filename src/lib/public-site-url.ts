export function getPublicSiteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.example.com'
  return String(raw).replace(/\/+$/, '') || 'https://app.example.com'
}
