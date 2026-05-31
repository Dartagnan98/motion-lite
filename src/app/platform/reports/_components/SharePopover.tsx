'use client'

// SharePopover — shown on the report header.
// Clicking "Share" generates a token (or shows the existing URL) with copy + revoke controls.
// Shows a warning that anyone with the link can view the report.

import { useState, useRef, useEffect } from 'react'

interface SharePopoverProps {
  reportId: number
  /** If the report already has a share token, pass the full URL here so we don't
   *  need an extra round-trip on open. Pass null if not yet shared. */
  initialShareUrl: string | null
}

export function SharePopover({ reportId, initialShareUrl }: SharePopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl)
  const [loading, setLoading] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  async function handleGenerateLink() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/reports/${reportId}/share`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; shareUrl?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to generate link')
      setShareUrl(data.shareUrl ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/reports/${reportId}/unshare`, { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to revoke link')
      setShareUrl(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRevoking(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for non-HTTPS environments.
      const el = document.createElement('textarea')
      el.value = shareUrl
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
        aria-label="Share report"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
        Share
        {shareUrl && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 p-4">
          <p className="text-sm font-medium text-gray-900 mb-1">Share Report</p>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs text-amber-700 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Anyone with this link can view the report — no login required.
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {!shareUrl ? (
            <button
              onClick={handleGenerateLink}
              disabled={loading}
              className="w-full bg-[var(--accent,#0891b2)] hover:opacity-90 disabled:opacity-50 text-white font-medium py-2 px-3 rounded-lg text-sm transition-opacity flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate share link'
              )}
            </button>
          ) : (
            <div className="space-y-3">
              {/* URL display + copy */}
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 min-w-0 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono truncate focus:outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors flex-shrink-0 ${
                    copied
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              {/* Revoke */}
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="w-full text-xs text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 py-2 px-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {revoking ? (
                  <>
                    <span className="w-3 h-3 border border-red-300 border-t-red-600 rounded-full animate-spin" />
                    Revoking...
                  </>
                ) : (
                  'Revoke link'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
