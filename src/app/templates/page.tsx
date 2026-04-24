import { getTemplates } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { TemplatesPage } from '@/components/templates/TemplatesPage'

export const dynamic = 'force-dynamic'

export default async function Templates() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const templates = getTemplates()

  return <TemplatesPage templates={templates} />
}
