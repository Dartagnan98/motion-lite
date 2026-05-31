// /platform/* layout — scroll container + white-label theme tokens.
//
// AppShell's main panel uses `flex-1 min-h-0` inside an `overflow-hidden`
// parent and provides no scroll itself. Platform pages render their own
// `<main className="min-h-screen ...">` which is taller than the AppShell
// panel by design (full client report). Without this wrapper, the bottom
// of the page is clipped — the user sees no scrollbar, no way down.
//
// Wrapping every /platform/* route in an `overflow-y-auto h-full` div
// gives the inner content its own scroll surface inside AppShell's panel.
//
// White-label v1: set --platform-accent (Hiilite teal) on this wrapper.
// Phase 4 overrides these per-agency on layout boot via DB lookup.

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-platform-scroll
      className="h-full overflow-y-auto"
      style={{
        // Hiilite platform teal — overrides the main app orange accent for
        // report-specific primary color. Phase 4: per-agency override.
        '--platform-accent': '#0891b2',
        '--platform-accent-hover': '#0e7490',
        '--platform-accent-dim': 'rgba(8,145,178,0.10)',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
