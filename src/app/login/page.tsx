'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function CtrlFlowLogo() {
  const [phase, setPhase] = useState<'draw' | 'pulse' | 'done'>('draw')

  useEffect(() => {
    // After draw completes (1.4s), start pulse
    const t1 = setTimeout(() => setPhase('pulse'), 1400)
    // After pulse completes (1.6s more), settle
    const t2 = setTimeout(() => setPhase('done'), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  return (
    <div className="login-logo-wrap">
      <div className={`login-logo ${phase}`}>
        {/* The sweeping reveal line */}
        <div className="logo-reveal-line" />
        <span className="logo-ctrl">Ctrl</span>
        <span className="logo-flow">flow</span>
      </div>

      <style>{`
        .login-logo-wrap {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 8px 0;
        }

        .login-logo {
          position: relative;
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
          overflow: hidden;
          font-family: inherit;
        }

        .logo-ctrl {
          font-size: 48px;
          font-weight: 800;
          font-style: italic;
          color: #ffffff;
          letter-spacing: -1px;
        }

        .logo-flow {
          font-size: 48px;
          font-weight: 300;
          font-style: italic;
          color: #ffffff;
          opacity: 0.7;
          letter-spacing: -0.5px;
        }

        /* ── Phase 1: Draw / Reveal ── */
        .login-logo.draw .logo-ctrl,
        .login-logo.draw .logo-flow {
          opacity: 0;
          animation: textReveal 1.2s ease-out forwards;
        }

        .login-logo.draw .logo-flow {
          animation-delay: 0.3s;
        }

        /* The glowing line that sweeps across */
        .logo-reveal-line {
          position: absolute;
          top: 0;
          left: -4px;
          width: 2px;
          height: 100%;
          background: linear-gradient(
            180deg,
            transparent 5%,
            rgba(59, 155, 143, 0.3) 20%,
            #7a6b55 50%,
            rgba(59, 155, 143, 0.3) 80%,
            transparent 95%
          );
          box-shadow: 0 0 12px 3px rgba(59, 155, 143, 0.5),
                      0 0 24px 6px rgba(59, 155, 143, 0.2);
          opacity: 0;
          border-radius: 1px;
        }

        .login-logo.draw .logo-reveal-line {
          animation: lineSwipe 1.4s ease-in-out forwards;
        }

        /* ── Phase 2: Pulse ── */
        .login-logo.pulse .logo-ctrl,
        .login-logo.pulse .logo-flow {
          opacity: 1;
          animation: textPulse 0.8s ease-in-out 2;
        }

        .login-logo.pulse .logo-flow {
          animation: textPulse 0.8s ease-in-out 2;
          opacity: 0.7;
        }

        .login-logo.pulse .logo-reveal-line {
          opacity: 0;
        }

        /* ── Phase 3: Done / Settled ── */
        .login-logo.done .logo-ctrl {
          opacity: 1;
        }

        .login-logo.done .logo-flow {
          opacity: 0.7;
        }

        .login-logo.done .logo-reveal-line {
          opacity: 0;
        }

        /* ── Keyframes ── */
        @keyframes textReveal {
          0% {
            opacity: 0;
            clip-path: inset(0 100% 0 0);
            filter: blur(2px);
          }
          60% {
            filter: blur(0px);
          }
          100% {
            opacity: 1;
            clip-path: inset(0 0% 0 0);
            filter: blur(0px);
          }
        }

        @keyframes lineSwipe {
          0% {
            left: -4px;
            opacity: 0;
          }
          5% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            left: 100%;
            opacity: 0;
          }
        }

        @keyframes textPulse {
          0%, 100% {
            text-shadow: 0 0 0 transparent;
          }
          50% {
            text-shadow: 0 0 20px rgba(59, 155, 143, 0.4),
                         0 0 40px rgba(59, 155, 143, 0.15);
          }
        }
      `}</style>
    </div>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm space-y-6 px-6">
        {/* Animated Logo */}
        <div className="flex flex-col items-center gap-4">
          <CtrlFlowLogo />
          <p className="text-[13px] text-text-dim text-center">
            Sign in to your workspace
          </p>
        </div>

        {/* Google sign-in removed -- self-host your own OAuth in /api/auth/google if you want it back */}

        {/* Email/password form */}
        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3">
          <input
            type="email"
            name="login-email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            required
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          <input
            type="password"
            name="login-pw"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-elevated px-4 py-2.5 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          {error && <p className="text-[13px] text-red">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-[14px] font-semibold text-[var(--accent-fg)] hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-[13px] text-text-dim text-center">
          Invite only. Contact your workspace admin for access.
        </p>
      </div>
    </div>
  )
}
