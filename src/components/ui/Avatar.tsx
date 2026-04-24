'use client'

// ── Unified avatar colors ────────────────────────────────────────────
// Single source of truth for agent/team member colors.
// Matches the messages sidebar (AGENT_USERS in messages/types.ts).

const KNOWN_COLORS: Record<string, string> = {
  jimmy: '#7a6b55',
  gary: '#ffa726',
  ricky: '#ab47bc',
  sofia: '#ec407a',
  jimmyclaw: '#7a6b55',
}

const HASH_COLORS = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc',
  '#26c6da', '#ec407a', '#8d6e63', '#78909c', '#5c6bc0',
]

export function avatarColor(name: string): string {
  const lower = (name || '').toLowerCase()
  const known = KNOWN_COLORS[lower]
  if (known) return known
  // Hash-based fallback
  let hash = 0
  for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash)
  return HASH_COLORS[Math.abs(hash) % HASH_COLORS.length]
}

// ── Avatar component ─────────────────────────────────────────────────
// Use this EVERYWHERE a person/agent avatar is shown.
//
// Props:
//   name   - display name (required, used for initial + color fallback)
//   size   - pixel size (default 32)
//   src    - image URL (uploaded photo, Google profile pic, etc.)
//   color  - explicit color override (from DB team_members.color)

export function Avatar({
  name,
  size = 32,
  src,
  color,
}: {
  name: string
  size?: number
  src?: string | null
  color?: string | null
}) {
  const isUrl = src && (src.startsWith('http') || src.startsWith('/'))

  if (isUrl) {
    return (
      <img
        src={src}
        alt={name}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
        }}
        onError={(e) => {
          // On error, replace with initial circle
          const parent = e.currentTarget.parentElement
          if (parent) {
            const div = document.createElement('div')
            Object.assign(div.style, {
              width: `${size}px`, height: `${size}px`, borderRadius: '50%',
              background: color || avatarColor(name),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: `${size * 0.38}px`, fontWeight: '700', color: '#fff',
              flexShrink: '0',
            })
            div.textContent = name[0]?.toUpperCase() || '?'
            e.currentTarget.replaceWith(div)
          }
        }}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || avatarColor(name),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: '#fff',
      flexShrink: 0, letterSpacing: '-0.02em',
    }}>
      {name[0]?.toUpperCase() || '?'}
    </div>
  )
}
