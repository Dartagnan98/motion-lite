'use client'

import Link from 'next/link'

const mono = { fontFamily: 'var(--font-mono)' } as const

function LinkCard({
  label, title, description, href, cta = 'Open',
}: {
  label: string
  title: string
  description: string
  href: string
  cta?: string
}) {
  return (
    <section style={{
      padding: '18px 20px',
      borderRadius: 12,
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 10, ...mono, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--accent-text)',
      }}>
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{description}</div>
      <div style={{ marginTop: 14 }}>
        <Link href={href} style={{
          display: 'inline-block',
          padding: '7px 14px',
          borderRadius: 6,
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          fontSize: 11, ...mono,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          textDecoration: 'none',
        }}>{cta}</Link>
      </div>
    </section>
  )
}

export function CrmVoiceAiLinkSection() {
  return (
    <LinkCard
      label="Voice AI"
      title="AI phone agent"
      description="Inbound + outbound voice agents. Configure greeting, voice, handoff rules, and the knowledge base the agent answers from."
      href="/crm/voice-ai"
      cta="Manage voice agents"
    />
  )
}

export function CrmWebchatLinkSection() {
  return (
    <LinkCard
      label="Webchat"
      title="Website chat widget"
      description="Embedded chat widget. Customize appearance, business hours, pre-chat form, and AI auto-reply per site."
      href="/crm/webchat"
      cta="Manage widgets"
    />
  )
}

export function CrmPhoneLinkSection() {
  return (
    <LinkCard
      label="Phone"
      title="Tracking numbers"
      description="Purchased Twilio numbers. Each routes to SMS or Voice AI and attributes calls / texts to the contact record."
      href="/crm/phone/tracking-numbers"
      cta="Manage numbers"
    />
  )
}

export function CrmSmsKeywordsLinkSection() {
  return (
    <LinkCard
      label="SMS keywords"
      title="Inbound keyword rules"
      description="Map inbound SMS keywords to actions: apply tag, send template, trigger workflow, or book appointment. STOP / UNSTOP compliance is automatic."
      href="/crm/sms/keywords"
      cta="Manage keywords"
    />
  )
}
