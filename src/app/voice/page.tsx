'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

interface BrandVoice {
  id: number
  voice_sample_text: string
  tone_words: string[]
  do_words: string[]
  avoid_words: string[]
  style_rules: string[]
}

interface AnalyzeResult {
  tone_words: string[]
  do_words: string[]
  avoid_words: string[]
  style_rules: string[]
  rationale: string
}

const toLines = (xs: string[]) => xs.join('\n')

export default function VoicePage() {
  const [loaded, setLoaded] = useState(false)
  const [voiceSample, setVoiceSample] = useState('')
  const [toneWords, setToneWords] = useState('')
  const [doWords, setDoWords] = useState('')
  const [avoidWords, setAvoidWords] = useState('')
  const [styleRules, setStyleRules] = useState('')
  const [rationale, setRationale] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/voice', { credentials: 'include' })
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      const v = await res.json() as BrandVoice
      setVoiceSample(v.voice_sample_text || '')
      setToneWords(toLines(v.tone_words || []))
      setDoWords(toLines(v.do_words || []))
      setAvoidWords(toLines(v.avoid_words || []))
      setStyleRules(toLines(v.style_rules || []))
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Could not load brand voice' })
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { void load() }, [])

  async function analyze() {
    if (!voiceSample.trim()) {
      setStatus({ kind: 'err', text: 'Paste a writing sample first.' })
      return
    }
    setAnalyzing(true)
    setStatus(null)
    setRationale('')
    try {
      const res = await fetch('/api/voice/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sample: voiceSample }),
      })
      const data = await res.json() as AnalyzeResult & { error?: string }
      if (!res.ok) throw new Error(data.error || `Analyze failed (${res.status})`)
      setToneWords(toLines(data.tone_words || []))
      setDoWords(toLines(data.do_words || []))
      setAvoidWords(toLines(data.avoid_words || []))
      setStyleRules(toLines(data.style_rules || []))
      setRationale(data.rationale || '')
      setStatus({ kind: 'ok', text: 'Analyzed. Review the fields below and click Save when ready.' })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Analysis failed' })
    } finally {
      setAnalyzing(false)
    }
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/voice', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          voice_sample_text: voiceSample,
          tone_words: toneWords,
          do_words: doWords,
          avoid_words: avoidWords,
          style_rules: styleRules,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        throw new Error(data.error || `Save failed (${res.status})`)
      }
      setStatus({ kind: 'ok', text: 'Brand voice saved.' })
      setTimeout(() => setStatus(null), 1800)
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Brand Voice"
        subtitle="Paste a writing sample. AI extracts tone, preferred words, words to avoid, and style rules. Saved guardrails inject into every AI prompt this workspace runs."
        action={{ label: saving ? 'Saving…' : 'Save', onClick: () => { void save() } }}
        secondaryAction={{ label: analyzing ? 'Analyzing…' : 'Analyze sample with AI', onClick: () => { void analyze() } }}
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div style={{ display: 'grid', gap: 14, maxWidth: 1100, margin: '0 auto' }}>
          <Card surface="panel" padding={18} radius={16}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Voice sample</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Paste real, approved writing — emails, social posts, transcripts, sales pages. The longer the sample, the better the analysis.</div>
            </div>
            <textarea
              value={voiceSample}
              onChange={(e) => setVoiceSample(e.target.value)}
              rows={12}
              placeholder="Paste a strong sample of writing here…"
              style={ta(260)}
            />
          </Card>

          {rationale && (
            <Card surface="surface" padding={14} radius={12}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 6 }}>What makes this voice distinct</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{rationale}</div>
            </Card>
          )}

          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Card surface="surface" padding={16} radius={14}>
              <FieldHeader title="Tone words" subtitle="What it should feel like." />
              <textarea value={toneWords} onChange={(e) => setToneWords(e.target.value)} rows={8} placeholder={'direct\ncalm\ncredible'} style={ta(160)} />
            </Card>
            <Card surface="surface" padding={16} radius={14}>
              <FieldHeader title="Do words" subtitle="Words and phrases to prefer." />
              <textarea value={doWords} onChange={(e) => setDoWords(e.target.value)} rows={8} placeholder={'plain english\nclear next step\nreal numbers'} style={ta(160)} />
            </Card>
            <Card surface="surface" padding={16} radius={14}>
              <FieldHeader title="Avoid words" subtitle="Phrases to suppress globally." />
              <textarea value={avoidWords} onChange={(e) => setAvoidWords(e.target.value)} rows={8} placeholder={'delve\nrevolutionary\nseamless'} style={ta(160)} />
            </Card>
          </div>

          <Card surface="surface" padding={18} radius={14}>
            <FieldHeader title="Style rules" subtitle="One rule per line. Keep them operational, not aspirational." />
            <textarea
              value={styleRules}
              onChange={(e) => setStyleRules(e.target.value)}
              rows={6}
              placeholder={'Lead with the result, not the setup.\nPrefer short sentences.\nNo exclamation marks unless explicitly asked.'}
              style={ta(140)}
            />
          </Card>

          {!loaded && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading brand voice…</div>}
          {status && (
            <div style={{ fontSize: 12, color: status.kind === 'ok' ? 'var(--status-completed, #7a9e87)' : 'var(--status-overdue, #d97757)' }}>
              {status.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{subtitle}</div>
    </div>
  )
}

function ta(minHeight: number): React.CSSProperties {
  return {
    width: '100%',
    minHeight,
    borderRadius: 10,
    border: '1px solid var(--border-field, var(--border))',
    background: 'var(--bg-field, var(--bg-surface))',
    color: 'var(--text)',
    padding: 12,
    fontSize: 13,
    lineHeight: 1.6,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  }
}
