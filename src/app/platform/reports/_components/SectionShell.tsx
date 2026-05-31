'use client'

// SectionShell — client-side loading overlay wrapper for a report section.
//
// Owns the `refreshing` boolean and exposes it via SectionShellContext so any
// child component (RefetchButton, SectionControlBar Apply action) can flip it.
//
// Visual contract:
//   - Shell is `relative`.
//   - Content fades to opacity-50 + pointer-events-none while refreshing.
//   - Overlay (absolute inset-0) with a centred spinner + "Refreshing…" text.
//   - Both transitions use `transition-opacity duration-200 ease-out` so the
//     fade is smooth in both directions.

import { createContext, useContext, useState } from 'react'

// ─── Context ────────────────────────────────────────────────────────────────

export interface SectionShellContextValue {
  refreshing: boolean
  setRefreshing: (value: boolean) => void
}

export const SectionShellContext = createContext<SectionShellContextValue | null>(null)

/** Consume SectionShellContext from any child inside a <SectionShell>.
 *  Returns null when used outside a SectionShell — callers must guard. */
export function useSectionShell(): SectionShellContextValue | null {
  return useContext(SectionShellContext)
}

// ─── Shell component ─────────────────────────────────────────────────────────

interface SectionShellProps {
  children: React.ReactNode
}

export function SectionShell({ children }: SectionShellProps) {
  const [refreshing, setRefreshing] = useState(false)

  return (
    <SectionShellContext.Provider value={{ refreshing, setRefreshing }}>
      <div className="relative">
        {/* Section content — fades when refreshing */}
        <div
          className={`transition-opacity duration-200 ease-out ${
            refreshing ? 'opacity-50 pointer-events-none' : 'opacity-100'
          }`}
        >
          {children}
        </div>

        {/* Loading overlay — only rendered when refreshing */}
        {refreshing && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            {/* Subtle backdrop */}
            <div className="absolute inset-0 bg-white/40 rounded-xl" />
            {/* Spinner + label */}
            <div className="relative flex flex-col items-center gap-2">
              <svg
                className="w-6 h-6 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-20"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="var(--platform-accent, #0891b2)"
                  strokeWidth="3"
                />
                <path
                  d="M4 12a8 8 0 018-8"
                  stroke="var(--platform-accent, #0891b2)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-xs font-medium text-gray-500 select-none">
                Refreshing&hellip;
              </span>
            </div>
          </div>
        )}
      </div>
    </SectionShellContext.Provider>
  )
}
