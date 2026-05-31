'use client'

// Inline per-section visibility control + period override, shown only in the
// authenticated PM view (hidden in the PDF via [data-section-controls]; the
// public /r/[token] view doesn't render it). Persists immediately.
//
// Slice A additions:
//   - Calendar icon-button opens a popover for per-section period override.
//   - Override badge shown inline when an override is active.
//   - POINT_IN_TIME sections (pagespeed, se_ranking) skip the calendar button.
//   - Apply: PATCH /api/platform/reports/[id]/sections/[sid] → refetch → refresh.
//   - "Use report period": PATCH with periodOverride: null → refetch → refresh.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSectionShell } from './SectionShell'
import type { SectionSettings } from '@/lib/platform/reports'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format an ISO date string (YYYY-MM-DD) as "Apr 1" style. */
function formatShort(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

// ─── Period Override Popover ─────────────────────────────────────────────────

interface PeriodOverridePopoverProps {
  reportId: number
  sectionId: number
  /** Per-section integration IDs for refetch after apply. */
  integrationIds: number[]
  /** Report-level period — used as default for the date inputs. */
  reportPeriodStart: string
  reportPeriodEnd: string
  /** Active override if one is set (from section.settings.periodOverride). */
  currentOverride: { periodStart: string; periodEnd: string } | null | undefined
  /** Account id passed through to refetch payload. */
  accountId: number
  onClose: () => void
}

function PeriodOverridePopover({
  reportId,
  sectionId,
  integrationIds,
  reportPeriodStart,
  reportPeriodEnd,
  currentOverride,
  accountId,
  onClose,
}: PeriodOverridePopoverProps) {
  const router = useRouter()
  const shell = useSectionShell()
  const popoverRef = useRef<HTMLDivElement>(null)

  const [startVal, setStartVal] = useState(
    currentOverride?.periodStart ?? reportPeriodStart
  )
  const [endVal, setEndVal] = useState(
    currentOverride?.periodEnd ?? reportPeriodEnd
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Close on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on ESC.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const applyValid = startVal && endVal && endVal >= startVal

  async function applyOverride(override: { periodStart: string; periodEnd: string } | null) {
    setBusy(true)
    setError(null)
    if (shell) shell.setRefreshing(true)

    try {
      // 1. PATCH the section settings.
      const patchRes = await fetch(
        `/api/platform/reports/${reportId}/sections/${sectionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodOverride: override }),
        }
      )
      if (!patchRes.ok) {
        const data = (await patchRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Failed to update section period')
      }

      // 2. Refetch integrations for the effective window + enforce 400ms min display.
      if (integrationIds.length > 0) {
        const effectiveStart = override?.periodStart ?? reportPeriodStart
        const effectiveEnd = override?.periodEnd ?? reportPeriodEnd
        const refetchAll = async () => {
          await Promise.allSettled(
            integrationIds.map((id) =>
              fetch(`/api/platform/integrations/${id}/refetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  periodStart: effectiveStart,
                  periodEnd: effectiveEnd,
                  accountId,
                }),
              })
            )
          )
        }
        await Promise.all([
          refetchAll(),
          new Promise<void>((r) => setTimeout(r, 400)),
        ])
      } else {
        // Still hold the overlay for the minimum display if no integrations.
        await new Promise<void>((r) => setTimeout(r, 400))
      }

      // 3. Re-render server components.
      router.refresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
      if (shell) shell.setRefreshing(false)
    }
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Custom period for this section"
      style={{ width: 280 }}
      className={`
        absolute right-0 top-full mt-1.5 z-50 rounded-xl shadow-lg
        border border-[var(--border,#e5e7eb)]
        bg-white/95 backdrop-blur-sm
        p-4
      `}
    >
      {/* Header */}
      <p className="text-xs font-semibold text-[var(--text,#111827)] mb-0.5">
        Custom period for this section
      </p>
      <p className="text-[11px] text-[var(--text-dim,#6b7280)] mb-3 leading-snug">
        Overrides the report period for this section only.
      </p>

      {/* Date inputs */}
      <div className="space-y-2 mb-3">
        <div>
          <label className="block text-[11px] font-medium text-[var(--text-dim,#6b7280)] mb-1">
            Start
          </label>
          <input
            type="date"
            value={startVal}
            onChange={(e) => { setStartVal(e.target.value); setError(null) }}
            disabled={busy}
            className="w-full text-xs border border-[var(--border,#e5e7eb)] rounded-md px-2.5 py-1.5
                       text-[var(--text,#111827)] focus:outline-none focus:ring-2
                       focus:ring-[var(--platform-accent,#0891b2)] focus:border-transparent
                       disabled:opacity-50 bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[var(--text-dim,#6b7280)] mb-1">
            End
          </label>
          <input
            type="date"
            value={endVal}
            onChange={(e) => { setEndVal(e.target.value); setError(null) }}
            disabled={busy}
            className="w-full text-xs border border-[var(--border,#e5e7eb)] rounded-md px-2.5 py-1.5
                       text-[var(--text,#111827)] focus:outline-none focus:ring-2
                       focus:ring-[var(--platform-accent,#0891b2)] focus:border-transparent
                       disabled:opacity-50 bg-white"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-500 mb-2">{error}</p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => {
            if (!applyValid) return
            applyOverride({ periodStart: startVal, periodEnd: endVal })
          }}
          disabled={!applyValid || busy}
          className="w-full text-xs font-semibold py-1.5 px-3 rounded-md transition-colors
                     bg-[var(--platform-accent,#0891b2)] text-white
                     hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>

        {/* "Use report period" — only shown when an override is currently active */}
        {currentOverride && (
          <button
            onClick={() => applyOverride(null)}
            disabled={busy}
            className="w-full text-xs font-medium py-1.5 px-3 rounded-md transition-colors
                       text-[var(--text-dim,#6b7280)] hover:text-[var(--text,#111827)]
                       hover:bg-gray-50 disabled:opacity-40"
          >
            Use report period
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SectionControlBar ───────────────────────────────────────────────────────

export function SectionControlBar({
  reportId,
  sectionId,
  position,
  title,
  isHidden,
  settings,
  isPointInTime,
  integrationIds,
  reportPeriodStart,
  reportPeriodEnd,
  accountId,
}: {
  reportId: number
  sectionId: number
  position: number
  title: string
  isHidden: boolean
  /** Parsed section settings — carries periodOverride if one is set. */
  settings?: SectionSettings
  /** True when ALL integrations in this section are POINT_IN_TIME providers.
   *  Hides the calendar button (no period semantics for these sections). */
  isPointInTime?: boolean
  /** Integration IDs referenced by this section — used for refetch after apply. */
  integrationIds?: number[]
  /** Report-level period — default values for the date picker inputs. */
  reportPeriodStart?: string
  reportPeriodEnd?: string
  /** Client account id passed to the refetch payload. */
  accountId?: number
}) {
  const [busy, setBusy] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const router = useRouter()

  const currentOverride = settings?.periodOverride ?? null
  const hasOverride = !!currentOverride

  const togglePopover = useCallback(() => setPopoverOpen((v) => !v), [])
  const closePopover = useCallback(() => setPopoverOpen(false), [])

  async function toggle() {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/reports/${reportId}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: [{ sectionId, position, isHidden: !isHidden }] }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (isHidden) {
    return (
      <div
        data-section-controls
        className="flex items-center justify-between gap-2 px-4 py-2.5 mb-10 rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029M6.228 6.228A9.956 9.956 0 0112 5c4.478 0 8.268 2.943 9.543 7a9.97 9.97 0 01-1.563 3.029M3 3l18 18" />
          </svg>
          <span className="truncate">{title} &mdash; hidden from PDF &amp; client share</span>
        </span>
        <button
          onClick={toggle}
          disabled={busy}
          className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded px-2 py-1 flex-shrink-0 disabled:opacity-50"
        >
          {busy ? '…' : 'Show'}
        </button>
      </div>
    )
  }

  return (
    <div data-section-controls className="flex justify-end items-center gap-2 mb-1 relative">
      {/* Override badge — shown when an active override is set */}
      {hasOverride && currentOverride && (
        <button
          onClick={togglePopover}
          aria-label="Edit custom period"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full
                     bg-[color-mix(in_srgb,var(--platform-accent,#0891b2)_12%,transparent)]
                     text-[var(--platform-accent,#0891b2)]
                     border border-[color-mix(in_srgb,var(--platform-accent,#0891b2)_25%,transparent)]
                     hover:opacity-80 transition-opacity"
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Custom: {formatShort(currentOverride.periodStart)} &ndash; {formatShort(currentOverride.periodEnd)}
        </button>
      )}

      {/* Calendar button — hidden for POINT_IN_TIME sections */}
      {!isPointInTime && (
        <button
          onClick={togglePopover}
          aria-label={hasOverride ? 'Edit custom section period' : 'Set custom period for this section'}
          title={hasOverride ? 'Edit custom period' : 'Set custom period for this section'}
          className={`text-xs inline-flex items-center gap-1 transition-colors
            ${hasOverride
              ? 'text-[var(--platform-accent,#0891b2)] hover:opacity-80'
              : 'text-gray-300 hover:text-gray-600'
            }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      )}

      {/* Hide button */}
      <button
        onClick={toggle}
        disabled={busy}
        title="Hide this section from the PDF & client share view"
        className="text-xs text-gray-300 hover:text-gray-600 inline-flex items-center gap-1 disabled:opacity-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029M6.228 6.228A9.956 9.956 0 0112 5c4.478 0 8.268 2.943 9.543 7a9.97 9.97 0 01-1.563 3.029M3 3l18 18" />
        </svg>
        {busy ? '…' : 'Hide'}
      </button>

      {/* Period override popover */}
      {popoverOpen && !isPointInTime && (
        <PeriodOverridePopover
          reportId={reportId}
          sectionId={sectionId}
          integrationIds={integrationIds ?? []}
          reportPeriodStart={reportPeriodStart ?? ''}
          reportPeriodEnd={reportPeriodEnd ?? ''}
          currentOverride={currentOverride}
          accountId={accountId ?? 0}
          onClose={closePopover}
        />
      )}
    </div>
  )
}
