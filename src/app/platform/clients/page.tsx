// /platform/clients — redirects to the unified /clients list page.
// Phase A convergence: motion-lite client_profiles is now the canonical client list.
import { redirect } from 'next/navigation'

export default function PlatformClientsPage() {
  redirect('/clients')
}
