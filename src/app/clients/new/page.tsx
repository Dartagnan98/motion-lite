'use client'

// /clients/new
//
// Unified new-client wizard. Creates a client_profiles row (motion-lite CRM)
// and optionally promotes it into the platform (Phase C: client_profiles is the
// canonical account record; platform_accounts is gone).
//
// "Set up platform reporting" toggle (default ON) controls whether the API call
// to /api/platform/accounts runs — that endpoint sets tenant_id + platform_public_id
// + agency_id + platform_status on the client_profiles row, promoting it. When
// OFF: only the CRM record is created and reporting can be added later from the
// client's Integrations tab (which calls the same endpoint with clientProfileId).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AVATAR_COLORS } from '@/lib/client-business-constants'
import { Avatar } from '@/components/ui/Avatar'

export default function NewClientPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [domainUrl, setDomainUrl] = useState('')
  const [color, setColor] = useState(AVATAR_COLORS[0])
  const [setupReporting, setSetupReporting] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) { setError('Client name is required'); return }

    setSubmitting(true)
    setError(null)

    try {
      // Step 1: Create client_profiles row via existing /api/clients POST.
      const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      const profileRes = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          slug,
          avatar_color: color,
          // Persist the domain on the client record up front so it's reused
          // when connecting tools (PageSpeed URL, GSC/GA4 domain matching).
          website: domainUrl.trim() || undefined,
        }),
      })
      const profileData = await profileRes.json() as { profile?: { id: number; slug: string }; error?: string }
      if (!profileRes.ok || !profileData.profile) {
        setError(profileData.error ?? 'Failed to create client')
        return
      }
      const clientProfileId = profileData.profile.id
      const clientSlug = profileData.profile.slug

      // Step 2: Optionally promote the client_profile into the platform (Phase C).
      if (setupReporting) {
        const accountRes = await fetch('/api/platform/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            domainUrl: domainUrl.trim() || undefined,
            clientProfileId,  // Phase B: link immediately on creation
          }),
        })
        if (!accountRes.ok) {
          // Non-fatal: client profile was created. Reporting can be set up later.
          console.warn('[new-client] platform account creation failed — client CRM record exists')
          router.push(`/clients/${clientSlug}?tab=integrations`)
          return
        }
        const accountData = await accountRes.json() as { id?: number }
        router.push(`/platform/connect?accountId=${accountData.id ?? ''}`)
        return
      }

      router.push(`/clients/${clientSlug}`)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 flex justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 self-start">
        {/* Back link */}
        <Link
          href="/clients"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Clients
        </Link>

        <h1 className="text-lg font-semibold text-gray-900 mb-1">New client</h1>
        <p className="text-sm text-gray-500 mb-6">
          Add a client to track their CRM profile, integrations, and reports in one place.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Avatar color preview */}
          <div className="flex items-center gap-4">
            <Avatar name={name || 'New'} size={48} color={color} />
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
                />
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Client name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Glenvalley Dental"
              maxLength={100}
              className="w-full text-sm border border-gray-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder-gray-400"
              disabled={submitting}
              autoFocus
            />
          </div>

          {/* Primary domain — kept on the client record + reused when connecting tools */}
          <div>
            <label htmlFor="domainUrl" className="block text-sm font-medium text-gray-700 mb-1.5">
              Primary domain <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="domainUrl"
              type="text"
              value={domainUrl}
              onChange={e => setDomainUrl(e.target.value)}
              placeholder="https://glenvalleydental.com"
              className="w-full text-sm border border-gray-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder-gray-400"
              disabled={submitting}
            />
            <p className="text-xs text-gray-400 mt-1">Saved to the client and reused for PageSpeed, GSC/GA4 matching.</p>
          </div>

          {/* Reporting toggle */}
          <div className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 bg-gray-50">
            <button
              type="button"
              role="switch"
              aria-checked={setupReporting}
              onClick={() => setSetupReporting(v => !v)}
              className={`relative w-10 h-5 rounded-full flex-shrink-0 mt-0.5 transition-colors ${setupReporting ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${setupReporting ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <p className="text-sm font-medium text-gray-700">Set up platform reporting</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {setupReporting
                  ? 'Creates a reporting account and takes you to connect integrations.'
                  : 'Creates CRM profile only. You can set up reporting later from the client\'s Integrations tab.'}
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : (
              setupReporting ? 'Create client + connect integrations' : 'Create client'
            )}
          </button>
        </form>
      </div>
    </main>
  )
}
