'use client'

export function AiStreamText({
  text,
  waiting,
  placeholder = 'AI output appears here.',
  minHeight = 220,
}: {
  text: string
  waiting: boolean
  placeholder?: string
  minHeight?: number
}) {
  const showCursor = waiting || Boolean(text)

  return (
    <div
      style={{
        minHeight,
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {!text && waiting ? (
        <div aria-hidden="true" className="ai-stream-skeleton">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : null}

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          whiteSpace: 'pre-wrap',
          fontSize: 13,
          lineHeight: 1.6,
          color: text ? 'var(--text)' : 'var(--text-dim)',
          minHeight: minHeight - 32,
        }}
      >
        {text || (!waiting ? placeholder : '')}
        {showCursor ? <span className="ai-stream-cursor" /> : null}
      </div>

      <style jsx>{`
        .ai-stream-skeleton {
          position: absolute;
          inset: 16px;
          display: grid;
          gap: 10px;
        }
        .ai-stream-skeleton span {
          display: block;
          height: 10px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            color-mix(in oklab, var(--bg-elevated) 85%, transparent) 0%,
            color-mix(in oklab, var(--text-dim) 12%, transparent) 48%,
            color-mix(in oklab, var(--bg-elevated) 85%, transparent) 100%
          );
          background-size: 220% 100%;
          animation: shimmer 1.1s linear infinite;
          opacity: 0.65;
        }
        .ai-stream-skeleton span:nth-child(2) { width: 88%; }
        .ai-stream-skeleton span:nth-child(3) { width: 92%; }
        .ai-stream-skeleton span:nth-child(4) { width: 56%; }
        .ai-stream-cursor {
          display: inline-block;
          width: 1px;
          height: 1em;
          margin-left: 2px;
          vertical-align: text-bottom;
          background: var(--accent);
          animation: blink 0.9s step-end infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -40% 0; }
        }
        @keyframes blink {
          0%, 45% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-stream-skeleton span,
          .ai-stream-cursor {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
