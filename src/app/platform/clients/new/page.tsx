// /platform/clients/new — redirects to the unified /clients/new form.
// Phase A convergence: new client creation happens in motion-lite's CRM flow.
import { redirect } from 'next/navigation'

export default function PlatformClientsNewPage() {
  redirect('/clients/new')
}
