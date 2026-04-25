'use client'

import { useState } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import type { CrmAiCampaignPlan } from '@/lib/crm-ai'

const mono = { fontFamily: 'var(--font-mono)' } as const

function ArtifactCard({
  label,
  body,
  onSend,
  sending,
  marketingCampaignId,
}: {
  label: string
  body: string
  onSend: () => void | Promise<void>
  sending: boolean
  marketingCampaignId?: number | null
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card surface="surface" padding={16} radius={14}>
      <CardHeader
        mono
        title={label}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => { handleCopy().catch(() => {}) }}
              style={chipStyle(copied ? 'Copied' : 'Copy')}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            {marketingCampaignId ? (
              <a href={`/crm/campaigns/${marketingCampaignId}`} style={chipStyle('Open campaign')}>
                Open campaign
              </a>
            ) : (
              <button type="button" onClick={() => { void onSend() }} style={primaryChipStyle} disabled={sending}>
                {sending ? 'Sending…' : 'Send to campaigns'}
              </button>
            )}
          </div>
        }
      />
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
        {body || 'Nothing generated yet.'}
      </div>
    </Card>
  )
}

function chipStyle(label: string): React.CSSProperties {
  return {
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg-field)',
    padding: '6px 10px',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: label === 'Copied' ? 'var(--text)' : 'var(--text-dim)',
    textDecoration: 'none',
    ...mono,
  }
}

const primaryChipStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
  background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-field))',
  padding: '6px 10px',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--accent-text)',
  ...mono,
}

export function CampaignPlanCards({
  plan,
  onSendToCampaigns,
  sending,
  marketingCampaignId,
}: {
  plan: CrmAiCampaignPlan
  onSendToCampaigns: () => void | Promise<void>
  sending: boolean
  marketingCampaignId?: number | null
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1.2fr 0.8fr' }}>
        <ArtifactCard
          label="Email body"
          body={plan.email_body}
          onSend={onSendToCampaigns}
          sending={sending}
          marketingCampaignId={marketingCampaignId}
        />
        <ArtifactCard
          label="Subject lines"
          body={(plan.subject_lines || []).join('\n')}
          onSend={onSendToCampaigns}
          sending={sending}
          marketingCampaignId={marketingCampaignId}
        />
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '0.9fr 1.1fr' }}>
        <ArtifactCard
          label="SMS follow-up"
          body={plan.sms_follow_up}
          onSend={onSendToCampaigns}
          sending={sending}
          marketingCampaignId={marketingCampaignId}
        />
        <ArtifactCard
          label="Landing page copy"
          body={plan.landing_page_copy}
          onSend={onSendToCampaigns}
          sending={sending}
          marketingCampaignId={marketingCampaignId}
        />
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '0.9fr 1.1fr' }}>
        <Card surface="surface" padding={16} radius={14}>
          <CardHeader mono title="Schedule" />
          <div style={{ display: 'grid', gap: 8 }}>
            {(plan.schedule || []).map((item, index) => (
              <div key={`${item.channel}-${item.day_offset}-${index}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', ...mono }}>
                    Day {item.day_offset}
                  </span>
                  <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', ...mono }}>
                    {item.channel}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text)' }}>{item.objective}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card surface="surface" padding={16} radius={14}>
          <CardHeader mono title="Strategic notes" />
          <div style={{ display: 'grid', gap: 10 }}>
            {(plan.notes || []).map((note, index) => (
              <div key={index} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
                {note}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
