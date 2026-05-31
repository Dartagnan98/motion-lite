// NpsWidget — once-per-calendar-month NPS banner on the PM dashboard.
//
// Server decides whether to render at all (based on DB check in dashboard page.tsx).
// Client handles the 0-10 picker, optional comment, submit, and "Maybe later".
//
// "Maybe later" sets a localStorage flag with the YYYY-MM key so the banner stays
// hidden for the rest of the month without a DB write. The server component
// re-evaluates on next month's load.
//
// Hidden on /r/[token] (public renderer) — that page never renders this.
// Hidden in read-only mode (pass readOnly prop from server component).

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const LS_KEY = 'hiilite_nps_snoozed'

function isSnoozedThisMonth(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(LS_KEY)
    const currentYYYYMM = new Date().toISOString().slice(0, 7)
    return stored === currentYYYYMM
  } catch {
    return false
  }
}

function snoozeThisMonth() {
  try {
    const currentYYYYMM = new Date().toISOString().slice(0, 7)
    localStorage.setItem(LS_KEY, currentYYYYMM)
  } catch {
    // localStorage unavailable (private browsing, etc.) — no-op
  }
}

export function NpsWidget() {
  const router = useRouter()
  const [visible, setVisible] = useState(() => !isSnoozedThisMonth())
  const [selectedScore, setSelectedScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!visible) return null

  if (submitted) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm text-emerald-700 font-medium">Thanks for your feedback!</span>
      </div>
    )
  }

  function handleMaybeLater() {
    snoozeThisMonth()
    setVisible(false)
  }

  async function handleSubmit() {
    if (selectedScore === null) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: selectedScore,
          comment: comment.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Failed to submit')
        return
      }
      setSubmitted(true)
      // Refresh so server doesn't re-render the widget next time.
      router.refresh()
    } catch {
      setError('Network error — could not submit')
    } finally {
      setSubmitting(false)
    }
  }

  const npsLabels: Record<string, string> = {
    '0': 'Not at all', '5': 'Neutral', '10': 'Extremely likely'
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-sm font-medium text-blue-900">
          How likely are you to recommend the Hiilite Platform to a fellow agency? (0-10)
        </p>
        <button
          onClick={handleMaybeLater}
          className="text-xs text-blue-400 hover:text-blue-600 whitespace-nowrap flex-shrink-0 transition-colors"
        >
          Maybe later
        </button>
      </div>

      {/* 0-10 number picker */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            onClick={() => setSelectedScore(n)}
            className={`w-8 h-8 text-sm font-medium rounded-md transition-colors border ${
              selectedScore === n
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-xs text-blue-400 mb-3 px-0.5">
        <span>{npsLabels['0']}</span>
        <span>{npsLabels['5']}</span>
        <span>{npsLabels['10']}</span>
      </div>

      {/* Optional comment — shown after score is selected */}
      {selectedScore !== null && (
        <div className="mb-3">
          {/* PHASE2-TIPTAP: textarea could become Tiptap for richer feedback */}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything you'd like to share? (optional)"
            rows={2}
            maxLength={2000}
            className="w-full text-sm border border-blue-200 rounded-md px-3 py-2 bg-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       resize-y placeholder:text-blue-200"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={selectedScore === null || submitting}
          className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2
                     rounded-md disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}
