'use client'

import { useEffect, useMemo, useState } from 'react'
import { EMAIL_BLOCK_TEMPLATES } from '@/lib/email-block-templates'
import {
  buildEmailInboxPreview,
  DEFAULT_EMAIL_THEME,
  parseEmailBlocks,
  resolveEmailTheme,
  type EmailBlock,
  type EmailBlockAlign,
  type EmailBlockConditionalSection,
  type EmailBlockDynamicText,
  type EmailBlockHeading,
  type EmailBlockSocialRow,
  type EmailDynamicTextVariant,
  type EmailThemeValues,
} from '@/lib/email-blocks'
import { crmFetch } from '@/lib/crm-browser'

const mono = {
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
} as const

export type AiTone = 'casual' | 'professional' | 'urgent' | 'friendly'

type BlockKind = EmailBlock['kind']
type RewriteMode = 'shorten' | 'expand' | 'casual' | 'professional' | 'urgent'

interface WorkspaceSavedBlock {
  id: number
  name: string
  category: string | null
  preview_text: string | null
  blocks_json: string
}

interface WorkspaceEmailTheme extends EmailThemeValues {
  id: number
  name: string
}

export interface EmailBlockBuilderProps {
  value: EmailBlock[]
  onChange: (next: EmailBlock[]) => void
  onSave?: () => void
  saving?: boolean
  accentColor?: string
  subject?: string
  onSubjectChange?: (subject: string) => void
  subjectB?: string
  onSubjectBChange?: (subject: string) => void
  subjectSplitPct?: number
  onSubjectSplitPctChange?: (value: number) => void
  previewText?: string
  onPreviewTextChange?: (value: string) => void
  themeId?: number | null
  onThemeChange?: (themeId: number | null) => void
  emptyHint?: string
}

type BlockLibraryEntry = {
  kind: BlockKind
  label: string
  hint: string
  group: 'Content' | 'Commerce' | 'Personalization' | 'Utility'
}

const BLOCK_LIBRARY: BlockLibraryEntry[] = [
  { kind: 'heading', label: 'Heading', hint: 'Title or section break', group: 'Content' },
  { kind: 'text', label: 'Text', hint: 'Paragraph with lightweight markdown', group: 'Content' },
  { kind: 'image', label: 'Image', hint: 'Hosted image with operator-safe sizing', group: 'Content' },
  { kind: 'button', label: 'Button', hint: 'Primary call to action', group: 'Content' },
  { kind: 'divider', label: 'Divider', hint: 'Thin rule between sections', group: 'Content' },
  { kind: 'spacer', label: 'Spacer', hint: 'Vertical breathing room', group: 'Utility' },
  { kind: 'product_card', label: 'Product card', hint: 'Launch, sale, or featured offer', group: 'Commerce' },
  { kind: 'video_thumb', label: 'Video thumb', hint: 'Thumbnail, title, and target link', group: 'Commerce' },
  { kind: 'social_row', label: 'Social row', hint: 'Compact linked social actions', group: 'Utility' },
  { kind: 'countdown', label: 'Countdown', hint: 'Static urgency block for time-bound sends', group: 'Utility' },
  { kind: 'dynamic_text', label: 'Dynamic text', hint: 'Swap copy by segment or region', group: 'Personalization' },
  { kind: 'conditional_section', label: 'Conditional section', hint: 'Show a nested section only for matching contacts', group: 'Personalization' },
]

const CATEGORY_OPTIONS = ['Content', 'Commerce', 'Personalization', 'Utility'] as const

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function futureIso(days = 7): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function buildDefaultBlock(kind: BlockKind): EmailBlock {
  switch (kind) {
    case 'heading':
      return { id: nextId('h'), kind: 'heading', text: 'New heading', level: 2, align: 'left' }
    case 'text':
      return { id: nextId('t'), kind: 'text', markdown: 'Write something here. **Bold**, _italic_, and [links](https://example.com) are supported.' }
    case 'image':
      return { id: nextId('i'), kind: 'image', url: '', alt: '', align: 'center', width_pct: 100 }
    case 'button':
      return { id: nextId('b'), kind: 'button', label: 'Click here', url: 'https://example.com', align: 'left' }
    case 'divider':
      return { id: nextId('d'), kind: 'divider', style: 'solid', opacity: 0.4 }
    case 'spacer':
      return { id: nextId('s'), kind: 'spacer', height: 24 }
    case 'product_card':
      return {
        id: nextId('pc'),
        kind: 'product_card',
        eyebrow: 'New release',
        title: 'Flagship offer',
        description: 'Explain the offer in one tight paragraph. Call out who it is for and what changed.',
        image_url: '',
        price_label: '$249',
        cta_label: 'View offer',
        cta_url: 'https://example.com',
      }
    case 'video_thumb':
      return {
        id: nextId('vt'),
        kind: 'video_thumb',
        thumbnail_url: '',
        title: 'Watch the walkthrough',
        caption: 'Short caption explaining why the reader should click through.',
        target_url: 'https://example.com',
      }
    case 'social_row':
      return {
        id: nextId('sr'),
        kind: 'social_row',
        items: [
          { id: nextId('li'), network: 'linkedin', label: 'LinkedIn', url: 'https://linkedin.com' },
          { id: nextId('ig'), network: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
          { id: nextId('yt'), network: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
        ],
      }
    case 'countdown':
      return {
        id: nextId('co'),
        kind: 'countdown',
        target_at: futureIso(),
        fallback_label: 'Offer ends soon',
        align: 'left',
      }
    case 'dynamic_text':
      return {
        id: nextId('dt'),
        kind: 'dynamic_text',
        default_markdown: 'Default copy for everyone.',
        variants: [
          { id: nextId('dv'), mode: 'segment', value: 'Customer', markdown: 'Copy that only customers should see.' },
        ],
      }
    case 'conditional_section':
      return {
        id: nextId('cs'),
        kind: 'conditional_section',
        rule: { field: 'segment', operator: 'is', value: 'Customer' },
        blocks: [
          { id: nextId('t'), kind: 'text', markdown: 'This section only appears for the matching audience.' },
          { id: nextId('b'), kind: 'button', label: 'View details', url: 'https://example.com', align: 'left' },
        ],
      }
    default:
      return { id: nextId('t'), kind: 'text', markdown: '' }
  }
}

function cloneBlockWithFreshIds(block: EmailBlock): EmailBlock {
  if (block.kind === 'social_row') {
    return {
      ...block,
      id: nextId('sr'),
      items: block.items.map((item) => ({ ...item, id: nextId(item.network.slice(0, 2) || 'so') })),
    }
  }
  if (block.kind === 'dynamic_text') {
    return {
      ...block,
      id: nextId('dt'),
      variants: block.variants.map((variant) => ({ ...variant, id: nextId('dv') })),
    }
  }
  if (block.kind === 'conditional_section') {
    return {
      ...block,
      id: nextId('cs'),
      blocks: block.blocks.map((nested) => cloneBlockWithFreshIds(nested)),
    }
  }
  return { ...block, id: nextId(block.kind.slice(0, 2)) }
}

function cloneBlocksWithFreshIds(blocks: EmailBlock[]): EmailBlock[] {
  return blocks.map((block) => cloneBlockWithFreshIds(block))
}

function insertBlocksAfter(blocks: EmailBlock[], selectedId: string | null, nextBlocks: EmailBlock[]): EmailBlock[] {
  if (!selectedId) return [...blocks, ...nextBlocks]
  const index = blocks.findIndex((block) => block.id === selectedId)
  if (index < 0) return [...blocks, ...nextBlocks]
  return [...blocks.slice(0, index + 1), ...nextBlocks, ...blocks.slice(index + 1)]
}

function groupSavedBlocks(items: WorkspaceSavedBlock[]): Array<{ category: string; items: WorkspaceSavedBlock[] }> {
  const map = new Map<string, WorkspaceSavedBlock[]>()
  for (const item of items) {
    const category = (item.category || 'Utility').trim() || 'Utility'
    if (!map.has(category)) map.set(category, [])
    map.get(category)!.push(item)
  }
  return Array.from(map.entries())
    .map(([category, grouped]) => ({ category, items: grouped }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

function countThemeUsageLabel(themeId: number | null, themes: WorkspaceEmailTheme[]): string {
  if (themeId === null) return 'Workspace default'
  return themes.find((theme) => theme.id === themeId)?.name || 'Selected theme'
}

function blockCategory(kind: BlockKind): string {
  return BLOCK_LIBRARY.find((entry) => entry.kind === kind)?.group || 'Utility'
}

function renderMarkdownPreview(raw: string): string {
  const escaped = raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#'
      return `<a href="${safe}" style="color:inherit;text-decoration:underline">${label}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
}

export function EmailBlockBuilder({
  value,
  onChange,
  onSave,
  saving,
  accentColor,
  subject,
  onSubjectChange,
  subjectB,
  onSubjectBChange,
  subjectSplitPct = 50,
  onSubjectSplitPctChange,
  previewText,
  onPreviewTextChange,
  themeId = null,
  onThemeChange,
  emptyHint,
}: EmailBlockBuilderProps) {
  const blocks = useMemo(() => (Array.isArray(value) ? value : []), [value])
  const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [savedBlocks, setSavedBlocks] = useState<WorkspaceSavedBlock[]>([])
  const [themes, setThemes] = useState<WorkspaceEmailTheme[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [saveFormOpen, setSaveFormOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCategory, setSaveCategory] = useState<string>('Content')
  const [savePreviewText, setSavePreviewText] = useState('')
  const [savingAsset, setSavingAsset] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [subjectOptions, setSubjectOptions] = useState<string[] | null>(null)
  const [loadingSubjects, setLoadingSubjects] = useState(false)
  const [subjectError, setSubjectError] = useState<string | null>(null)

  useEffect(() => {
    if (blocks.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !blocks.some((block) => block.id === selectedId)) {
      setSelectedId(blocks[0]?.id ?? null)
    }
  }, [blocks, selectedId])

  useEffect(() => {
    let cancelled = false
    async function loadAssets() {
      setLoadingAssets(true)
      try {
        const [savedRows, themeRows] = await Promise.all([
          crmFetch<WorkspaceSavedBlock[]>('/api/crm/email/saved-blocks'),
          crmFetch<WorkspaceEmailTheme[]>('/api/crm/email/themes'),
        ])
        if (cancelled) return
        setSavedBlocks(savedRows)
        setThemes(themeRows)
      } catch {
        if (!cancelled) {
          setSavedBlocks([])
          setThemes([])
        }
      } finally {
        if (!cancelled) setLoadingAssets(false)
      }
    }
    loadAssets().catch(() => {})
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(() => blocks.find((block) => block.id === selectedId) || null, [blocks, selectedId])
  const selectedTheme = useMemo(() => themes.find((theme) => theme.id === themeId) || null, [themes, themeId])
  const previewTheme = useMemo(
    () => resolveEmailTheme(selectedTheme || undefined, accentColor || DEFAULT_EMAIL_THEME.accent_color),
    [selectedTheme, accentColor],
  )
  const groupedSavedBlocks = useMemo(() => groupSavedBlocks(savedBlocks), [savedBlocks])
  const preview = useMemo(() => buildEmailInboxPreview({
    blocks,
    subject,
    subject_b: subjectB,
    preview_text: previewText,
    theme: selectedTheme || undefined,
  }), [blocks, previewText, selectedTheme, subject, subjectB])

  function appendBlock(kind: BlockKind) {
    const block = buildDefaultBlock(kind)
    const next = insertBlocksAfter(blocks, selectedId, [block])
    onChange(next)
    setSelectedId(block.id)
  }

  function applyTemplate(slug: string) {
    const template = EMAIL_BLOCK_TEMPLATES.find((entry) => entry.slug === slug)
    if (!template) return
    const next = template.build()
    onChange(next)
    setSelectedId(next[0]?.id ?? null)
  }

  function updateBlock(id: string, patch: Partial<EmailBlock>) {
    onChange(blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as EmailBlock) : block)))
  }

  function deleteBlock(id: string) {
    const next = blocks.filter((block) => block.id !== id)
    onChange(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
    setSaveFormOpen(false)
  }

  function duplicateBlock(id: string) {
    const index = blocks.findIndex((block) => block.id === id)
    if (index < 0) return
    const copy = cloneBlockWithFreshIds(blocks[index])
    onChange([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)])
    setSelectedId(copy.id)
  }

  function moveBlock(dragIdValue: string, targetId: string) {
    if (dragIdValue === targetId) return
    const from = blocks.findIndex((block) => block.id === dragIdValue)
    const to = blocks.findIndex((block) => block.id === targetId)
    if (from < 0 || to < 0) return
    const next = blocks.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  function insertSavedBlock(asset: WorkspaceSavedBlock) {
    const parsed = cloneBlocksWithFreshIds(parseEmailBlocks(asset.blocks_json))
    if (!parsed.length) return
    const next = insertBlocksAfter(blocks, selectedId, parsed)
    onChange(next)
    setSelectedId(parsed[0]?.id ?? null)
  }

  async function saveSelectedAsset() {
    if (!selected || !saveName.trim()) {
      setAssetError('Name is required')
      return
    }
    setAssetError(null)
    setSavingAsset(true)
    try {
      const created = await crmFetch<WorkspaceSavedBlock>('/api/crm/email/saved-blocks', {
        method: 'POST',
        body: JSON.stringify({
          name: saveName.trim(),
          category: saveCategory,
          preview_text: savePreviewText || null,
          blocks: [selected],
        }),
      })
      setSavedBlocks((current) => [created, ...current])
      setSaveFormOpen(false)
      setSaveName('')
      setSavePreviewText('')
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Could not save block')
    } finally {
      setSavingAsset(false)
    }
  }

  async function handleAiDraft(prompt: string, tone: AiTone, contactId: number | null) {
    const payload = {
      kind: 'draft_email' as const,
      prompt,
      context: {
        tone,
        ...(contactId ? { contact_id: contactId } : {}),
        ...(subject ? { campaign_goal: subject } : {}),
      },
    }
    const res = await crmFetch<{ subject?: string; body_blocks?: EmailBlock[]; error?: string }>(
      '/api/crm/ai/content',
      { method: 'POST', body: JSON.stringify(payload) },
    )
    if (res.error) throw new Error(res.error)
    if (Array.isArray(res.body_blocks) && res.body_blocks.length > 0) {
      onChange(res.body_blocks)
      setSelectedId(res.body_blocks[0]?.id ?? null)
    }
    if (res.subject && onSubjectChange) onSubjectChange(res.subject)
  }

  async function handleSuggestSubjects() {
    setSubjectError(null)
    setLoadingSubjects(true)
    try {
      const res = await crmFetch<{ options?: string[]; error?: string }>('/api/crm/ai/content', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'subject_lines',
          prompt: subject || 'Email subject for this send',
          context: { existing_text: subject || '' },
        }),
      })
      if (res.error) throw new Error(res.error)
      setSubjectOptions(res.options || [])
    } catch (error) {
      setSubjectError(error instanceof Error ? error.message : 'Could not suggest subjects')
    } finally {
      setLoadingSubjects(false)
    }
  }

  useEffect(() => {
    if (!selected) {
      setSaveFormOpen(false)
      return
    }
    if (!saveFormOpen) return
    setSaveCategory(blockCategory(selected.kind))
  }, [saveFormOpen, selected])

  return (
    <div className="flex flex-col gap-3">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <AiDraftButton onClick={() => setAiModalOpen(true)} />
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={primaryButtonStyle(saving)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        {subjectOptions && subjectOptions.length > 0 && onSubjectChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {subjectOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onSubjectChange(option)
                  setSubjectOptions(null)
                }}
                style={ghostPillStyle}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[220px,minmax(0,1fr),320px]">
        <aside style={railStyle}>
          <RailLabel>Start from</RailLabel>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) applyTemplate(event.target.value)
              event.target.value = ''
            }}
            style={fieldStyle}
          >
            <option value="">Choose a starter…</option>
            {EMAIL_BLOCK_TEMPLATES.map((template) => (
              <option key={template.slug} value={template.slug}>{template.name}</option>
            ))}
          </select>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            {CATEGORY_OPTIONS.map((category) => (
              <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <RailLabel>{category}</RailLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {BLOCK_LIBRARY.filter((entry) => entry.group === category).map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      onClick={() => appendBlock(entry.kind)}
                      title={entry.hint}
                      style={tileStyle}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{entry.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{entry.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={sectionStyle}>
            <RailLabel>Saved blocks</RailLabel>
            {loadingAssets ? (
              <div style={helperCopyStyle}>Loading reusable blocks…</div>
            ) : groupedSavedBlocks.length === 0 ? (
              <div style={helperCopyStyle}>
                Save a block for repeated cases like a product launch card, webinar reminder section, or nurture follow-up CTA.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {groupedSavedBlocks.map((group) => (
                  <div key={group.category} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>{group.category}</div>
                    {group.items.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => insertSavedBlock(asset)}
                        style={savedBlockButtonStyle}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>{asset.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                          {asset.preview_text || 'Insert into the current canvas position'}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <RailLabel>Save selected</RailLabel>
                <button
                  type="button"
                  onClick={() => {
                    setSaveFormOpen((open) => !open)
                    setSaveCategory(blockCategory(selected.kind))
                    setSaveName(selected.kind.replace('_', ' '))
                  }}
                  style={secondaryButtonStyle}
                >
                  {saveFormOpen ? 'Close' : 'Save'}
                </button>
              </div>
              {!saveFormOpen ? (
                <div style={helperCopyStyle}>
                  Save the selected block{selected.kind === 'conditional_section' ? ' or conditional section' : ''} so the team can drop it into future emails without rebuilding it.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                    placeholder="Saved block name"
                    style={fieldStyle}
                  />
                  <select value={saveCategory} onChange={(event) => setSaveCategory(event.target.value)} style={fieldStyle}>
                    {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <textarea
                    value={savePreviewText}
                    onChange={(event) => setSavePreviewText(event.target.value)}
                    rows={3}
                    placeholder="Short internal note about when to use it"
                    style={{ ...fieldStyle, resize: 'vertical', minHeight: 72 }}
                  />
                  {assetError && <div style={errorTextStyle}>{assetError}</div>}
                  <button type="button" onClick={() => { saveSelectedAsset().catch(() => {}) }} disabled={savingAsset} style={primaryButtonStyle(savingAsset)}>
                    {savingAsset ? 'Saving…' : 'Save selected'}
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        <section
          style={{
            minHeight: 560,
            background: previewTheme.canvas_bg,
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div
            style={{
              maxWidth: 640,
              margin: '0 auto',
              background: previewTheme.surface_bg,
              borderRadius: 18,
              border: `1px solid ${previewTheme.muted_color}22`,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {blocks.length === 0 ? (
              <div
                style={{
                  border: '1px dashed var(--border)',
                  borderRadius: 12,
                  padding: '48px 24px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {emptyHint || 'Empty canvas. Start from a product launch, webinar reminder, or nurture follow-up template, or drop in a saved block from the left rail.'}
              </div>
            ) : (
              blocks.map((block) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  selected={selectedId === block.id}
                  theme={previewTheme}
                  dragging={dragId === block.id}
                  dropTarget={dropTargetId === block.id && dragId !== null && dragId !== block.id}
                  onSelect={() => setSelectedId(block.id)}
                  onDelete={() => deleteBlock(block.id)}
                  onDuplicate={() => duplicateBlock(block.id)}
                  onDragStart={() => setDragId(block.id)}
                  onDragOver={() => setDropTargetId(block.id)}
                  onDragLeave={() => setDropTargetId((current) => (current === block.id ? null : current))}
                  onDrop={() => {
                    if (dragId) moveBlock(dragId, block.id)
                    setDragId(null)
                    setDropTargetId(null)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropTargetId(null)
                  }}
                />
              ))
            )}
          </div>
        </section>

        <aside style={railStyle}>
          <CompositionControls
            themes={themes}
            loadingThemes={loadingAssets}
            themeId={themeId}
            onThemeChange={onThemeChange}
            subject={subject}
            onSubjectChange={onSubjectChange}
            subjectB={subjectB}
            onSubjectBChange={onSubjectBChange}
            subjectSplitPct={subjectSplitPct}
            onSubjectSplitPctChange={onSubjectSplitPctChange}
            previewText={previewText}
            onPreviewTextChange={onPreviewTextChange}
            onSuggestSubjects={() => { handleSuggestSubjects().catch(() => {}) }}
            loadingSubjects={loadingSubjects}
            subjectError={subjectError}
            preview={preview}
          />

          <div style={sectionStyle}>
            <RailLabel>Inspector</RailLabel>
            {selected ? (
              <BlockInspector
                block={selected}
                onChange={(patch) => updateBlock(selected.id, patch)}
                onRewrite={
                  selected.kind === 'text'
                    ? async (mode) => {
                        const kind = mode === 'shorten' ? 'shorten' : mode === 'expand' ? 'expand' : 'rewrite'
                        const tone: AiTone | undefined =
                          mode === 'casual' ? 'casual'
                            : mode === 'professional' ? 'professional'
                              : mode === 'urgent' ? 'urgent'
                                : undefined
                        const res = await crmFetch<{ text?: string; error?: string }>('/api/crm/ai/content', {
                          method: 'POST',
                          body: JSON.stringify({
                            kind,
                            prompt: 'Rewrite this email text block while keeping the markdown valid.',
                            context: {
                              existing_text: selected.markdown,
                              ...(tone ? { tone } : {}),
                            },
                          }),
                        })
                        if (res.error) throw new Error(res.error)
                        if (res.text) updateBlock(selected.id, { markdown: res.text } as Partial<EmailBlock>)
                      }
                    : undefined
                }
              />
            ) : (
              <div style={helperCopyStyle}>Select a block to edit its fields.</div>
            )}
          </div>
        </aside>
      </div>

      <AiDraftModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onSubmit={handleAiDraft}
      />
    </div>
  )
}

function CompositionControls({
  themes,
  loadingThemes,
  themeId,
  onThemeChange,
  subject,
  onSubjectChange,
  subjectB,
  onSubjectBChange,
  subjectSplitPct,
  onSubjectSplitPctChange,
  previewText,
  onPreviewTextChange,
  onSuggestSubjects,
  loadingSubjects,
  subjectError,
  preview,
}: {
  themes: WorkspaceEmailTheme[]
  loadingThemes: boolean
  themeId: number | null
  onThemeChange?: (themeId: number | null) => void
  subject?: string
  onSubjectChange?: (value: string) => void
  subjectB?: string
  onSubjectBChange?: (value: string) => void
  subjectSplitPct: number
  onSubjectSplitPctChange?: (value: number) => void
  previewText?: string
  onPreviewTextChange?: (value: string) => void
  onSuggestSubjects: () => void
  loadingSubjects: boolean
  subjectError: string | null
  preview: ReturnType<typeof buildEmailInboxPreview>
}) {
  return (
    <div style={sectionStyle}>
      <RailLabel>Preview rail</RailLabel>

      {onThemeChange && (
        <InspectorField label="Theme">
          <select
            value={themeId ?? ''}
            onChange={(event) => onThemeChange(event.target.value ? Number(event.target.value) : null)}
            style={fieldStyle}
          >
            <option value="">Workspace default</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>{theme.name}</option>
            ))}
          </select>
          <div style={helperCopyStyle}>
            {loadingThemes ? 'Loading themes…' : countThemeUsageLabel(themeId, themes)}
          </div>
        </InspectorField>
      )}

      {onSubjectChange && (
        <InspectorField label="Subject A">
          <input
            value={subject || ''}
            onChange={(event) => onSubjectChange(event.target.value)}
            placeholder="Primary subject line"
            style={fieldStyle}
          />
          <button type="button" onClick={onSuggestSubjects} disabled={loadingSubjects} style={secondaryButtonStyle}>
            {loadingSubjects ? 'Drafting…' : 'Suggest 5'}
          </button>
        </InspectorField>
      )}

      {onSubjectBChange && (
        <InspectorField label="Subject B">
          <input
            value={subjectB || ''}
            onChange={(event) => onSubjectBChange(event.target.value)}
            placeholder="Alternative subject line"
            style={fieldStyle}
          />
        </InspectorField>
      )}

      {onSubjectSplitPctChange && (
        <InspectorField label="B split %">
          <input
            type="number"
            min={0}
            max={100}
            value={subjectSplitPct}
            onChange={(event) => onSubjectSplitPctChange(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
            style={fieldStyle}
          />
        </InspectorField>
      )}

      {onPreviewTextChange && (
        <InspectorField label="Preheader">
          <textarea
            value={previewText || ''}
            onChange={(event) => onPreviewTextChange(event.target.value)}
            rows={3}
            placeholder="Preview text shown beside the subject in inboxes"
            style={{ ...fieldStyle, minHeight: 72, resize: 'vertical' }}
          />
        </InspectorField>
      )}

      {subjectError && <div style={errorTextStyle}>{subjectError}</div>}

      {preview.subjects.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RailLabel>Subject test</RailLabel>
          {preview.subjects.map((item) => (
            <div key={item.variant} style={previewCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>Variant {item.variant.toUpperCase()}</span>
                <span style={{ fontSize: 12, color: 'var(--text)' }}>{item.score}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{item.subject}</div>
            </div>
          ))}
          <div style={helperCopyStyle}>
            {preview.recommended_variant
              ? `Likely cleaner inbox fit: variant ${preview.recommended_variant.toUpperCase()}.`
              : 'Both variants read similarly. Use judgment or run a live split.'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RailLabel>Inbox preview</RailLabel>
        {preview.rows.map((row) => (
          <div key={row.client} style={previewCardStyle}>
            <div style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{row.label}</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{row.subject}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>{row.preview}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RailLabel>Warnings</RailLabel>
        {preview.warnings.length === 0 ? (
          <div style={helperCopyStyle}>No obvious flags from the local heuristic pass.</div>
        ) : (
          preview.warnings.map((warning) => (
            <div key={warning} style={warningRowStyle}>{warning.replaceAll('_', ' ')}</div>
          ))
        )}
      </div>
    </div>
  )
}

function BlockCard({
  block,
  selected,
  theme,
  dragging,
  dropTarget,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  block: EmailBlock
  selected: boolean
  theme: EmailThemeValues
  dragging: boolean
  dropTarget: boolean
  onSelect: () => void
  onDelete: () => void
  onDuplicate: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', block.id)
        onDragStart()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      style={{
        position: 'relative',
        background: theme.surface_bg,
        border: `1px solid ${selected ? theme.accent_color : `${theme.muted_color}22`}`,
        borderRadius: 14,
        padding: 16,
        cursor: 'grab',
        opacity: dragging ? 0.55 : 1,
        boxShadow: selected ? `0 0 0 1px ${theme.accent_color}` : 'none',
      }}
    >
      {dropTarget && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: -1,
            height: 2,
            background: theme.accent_color,
            borderRadius: 999,
          }}
        />
      )}

      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDuplicate() }} style={miniIconButtonStyle}>Copy</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }} style={miniIconButtonStyle}>Delete</button>
      </div>

      <BlockPreview block={block} theme={theme} />

      <div style={{ ...mono, fontSize: 9, color: 'var(--text-muted)', marginTop: 10 }}>
        {block.kind.replaceAll('_', ' ')}
      </div>
    </div>
  )
}

function BlockPreview({ block, theme }: { block: EmailBlock; theme: EmailThemeValues }) {
  if (block.kind === 'heading') {
    const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 18
    return <div style={{ fontSize: size, fontWeight: 700, color: theme.text_color, textAlign: block.align }}>{block.text || 'Heading'}</div>
  }
  if (block.kind === 'text') {
    return <div style={{ fontSize: 15, lineHeight: 1.6, color: theme.text_color }} dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(block.markdown || 'Text block') }} />
  }
  if (block.kind === 'image') {
    return block.url ? (
      <div style={{ textAlign: block.align }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={block.url} alt={block.alt} style={{ display: 'inline-block', width: `${block.width_pct}%`, maxWidth: '100%', borderRadius: 10 }} />
      </div>
    ) : (
      <div style={placeholderBoxStyle}>Add an image URL</div>
    )
  }
  if (block.kind === 'button') {
    return (
      <div style={{ textAlign: block.align }}>
        <span
          style={{
            display: 'inline-block',
            background: theme.accent_color,
            color: '#ffffff',
            padding: '11px 18px',
            borderRadius: theme.button_radius,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {block.label || 'Button'}
        </span>
      </div>
    )
  }
  if (block.kind === 'divider') {
    return <div style={{ borderTop: `1px ${block.style} ${theme.muted_color}55`, height: 1 }} />
  }
  if (block.kind === 'spacer') {
    return <div style={{ height: Math.min(block.height, 64), borderRadius: 8, background: `${theme.muted_color}14` }} />
  }
  if (block.kind === 'product_card') {
    return (
      <div style={previewCardInnerStyle(theme)}>
        {block.image_url ? <img src={block.image_url} alt={block.title} style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} /> : <div style={placeholderBoxStyle}>Product image</div>}
        {block.eyebrow && <div style={{ ...mono, fontSize: 10, color: theme.muted_color, marginTop: 10 }}>{block.eyebrow}</div>}
        <div style={{ fontSize: 20, fontWeight: 700, color: theme.text_color, marginTop: 6 }}>{block.title || 'Product title'}</div>
        {block.price_label && <div style={{ fontSize: 14, fontWeight: 600, color: theme.text_color, marginTop: 8 }}>{block.price_label}</div>}
        {block.description && <div style={{ fontSize: 13, color: theme.text_color, lineHeight: 1.6, marginTop: 8 }}>{block.description}</div>}
      </div>
    )
  }
  if (block.kind === 'video_thumb') {
    return (
      <div style={previewCardInnerStyle(theme)}>
        {block.thumbnail_url ? <img src={block.thumbnail_url} alt={block.title} style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} /> : <div style={placeholderBoxStyle}>Video thumbnail</div>}
        <div style={{ fontSize: 18, fontWeight: 700, color: theme.text_color }}>{block.title || 'Video title'}</div>
        {block.caption && <div style={{ fontSize: 13, color: theme.muted_color, lineHeight: 1.55, marginTop: 8 }}>{block.caption}</div>}
      </div>
    )
  }
  if (block.kind === 'social_row') {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {block.items.map((item) => (
          <span key={item.id} style={{ border: `1px solid ${theme.muted_color}33`, borderRadius: 999, padding: '8px 12px', fontSize: 12, color: theme.text_color }}>
            {item.label || item.network}
          </span>
        ))}
      </div>
    )
  }
  if (block.kind === 'countdown') {
    return (
      <div style={{ display: 'flex', gap: 8, justifyContent: block.align === 'center' ? 'center' : 'flex-start' }}>
        {['09', '12', '44'].map((value, index) => (
          <div key={value + index} style={{ border: `1px solid ${theme.accent_color}33`, background: `${theme.accent_color}14`, borderRadius: 12, padding: '10px 12px', minWidth: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: theme.text_color }}>{value}</div>
            <div style={{ ...mono, fontSize: 9, color: theme.muted_color, marginTop: 4 }}>{index === 0 ? 'Days' : index === 1 ? 'Hours' : 'Mins'}</div>
          </div>
        ))}
      </div>
    )
  }
  if (block.kind === 'dynamic_text') {
    return (
      <div style={previewCardInnerStyle(theme)}>
        <div style={{ ...mono, fontSize: 10, color: theme.muted_color, marginBottom: 8 }}>Default copy · {block.variants.length} variant{block.variants.length === 1 ? '' : 's'}</div>
        <div style={{ fontSize: 14, color: theme.text_color, lineHeight: 1.6 }}>{block.default_markdown || 'Dynamic text fallback'}</div>
      </div>
    )
  }
  if (block.kind === 'conditional_section') {
    return (
      <div style={previewCardInnerStyle(theme)}>
        <div style={{ ...mono, fontSize: 10, color: theme.muted_color, marginBottom: 10 }}>
          Show when {block.rule.field} {block.rule.operator === 'is_not' ? 'is not' : 'is'} {block.rule.value || 'set'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {block.blocks.map((nested) => (
            <div key={nested.id} style={{ border: `1px solid ${theme.muted_color}22`, borderRadius: 10, padding: 10 }}>
              <BlockPreview block={nested} theme={theme} />
            </div>
          ))}
        </div>
      </div>
    )
  }
  return null
}

function BlockInspector({
  block,
  onChange,
  onRewrite,
}: {
  block: EmailBlock
  onChange: (patch: Partial<EmailBlock>) => void
  onRewrite?: (mode: RewriteMode) => Promise<void>
}) {
  if (block.kind === 'heading') {
    return (
      <>
        <InspectorField label="Text">
          <input value={block.text} onChange={(event) => onChange({ text: event.target.value } as Partial<EmailBlockHeading>)} style={fieldStyle} />
        </InspectorField>
        <InspectorField label="Level">
          <select value={block.level} onChange={(event) => onChange({ level: Number(event.target.value) as 1 | 2 | 3 } as Partial<EmailBlockHeading>)} style={fieldStyle}>
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
        </InspectorField>
        <InspectorField label="Align">
          <AlignChoice value={block.align} onChange={(align) => onChange({ align } as Partial<EmailBlockHeading>)} />
        </InspectorField>
      </>
    )
  }

  if (block.kind === 'text') {
    return (
      <>
        <InspectorField label="Markdown">
          <textarea value={block.markdown} onChange={(event) => onChange({ markdown: event.target.value } as Partial<EmailBlock>)} rows={8} style={{ ...fieldStyle, minHeight: 160, resize: 'vertical' }} />
        </InspectorField>
        <div style={helperCopyStyle}>Supports **bold**, _italic_, and [links](https://example.com).</div>
        {onRewrite && <RewriteDropdown onRewrite={onRewrite} />}
      </>
    )
  }

  if (block.kind === 'image') {
    return (
      <>
        <InspectorField label="Image URL">
          <input value={block.url} onChange={(event) => onChange({ url: event.target.value } as Partial<EmailBlock>)} placeholder="https://…" style={fieldStyle} />
        </InspectorField>
        <InspectorField label="Alt text">
          <input value={block.alt} onChange={(event) => onChange({ alt: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} />
        </InspectorField>
        <InspectorField label="Width %">
          <input type="number" min={10} max={100} value={block.width_pct} onChange={(event) => onChange({ width_pct: Math.max(10, Math.min(100, Number(event.target.value) || 100)) } as Partial<EmailBlock>)} style={fieldStyle} />
        </InspectorField>
        <InspectorField label="Align">
          <AlignChoice value={block.align} onChange={(align) => onChange({ align } as Partial<EmailBlock>)} />
        </InspectorField>
      </>
    )
  }

  if (block.kind === 'button') {
    return (
      <>
        <InspectorField label="Label">
          <input value={block.label} onChange={(event) => onChange({ label: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} />
        </InspectorField>
        <InspectorField label="URL">
          <input value={block.url} onChange={(event) => onChange({ url: event.target.value } as Partial<EmailBlock>)} placeholder="https://…" style={fieldStyle} />
        </InspectorField>
        <InspectorField label="Align">
          <AlignChoice value={block.align} onChange={(align) => onChange({ align } as Partial<EmailBlock>)} />
        </InspectorField>
      </>
    )
  }

  if (block.kind === 'divider') {
    return (
      <>
        <InspectorField label="Style">
          <select value={block.style} onChange={(event) => onChange({ style: event.target.value as 'solid' | 'dashed' } as Partial<EmailBlock>)} style={fieldStyle}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </InspectorField>
        <InspectorField label="Opacity">
          <input type="number" min={0} max={1} step={0.1} value={block.opacity} onChange={(event) => onChange({ opacity: Math.max(0, Math.min(1, Number(event.target.value) || 0)) } as Partial<EmailBlock>)} style={fieldStyle} />
        </InspectorField>
      </>
    )
  }

  if (block.kind === 'spacer') {
    return (
      <InspectorField label="Height">
        <input type="number" min={4} max={160} value={block.height} onChange={(event) => onChange({ height: Math.max(4, Math.min(160, Number(event.target.value) || 16)) } as Partial<EmailBlock>)} style={fieldStyle} />
      </InspectorField>
    )
  }

  if (block.kind === 'product_card') {
    return (
      <>
        <InspectorField label="Eyebrow"><input value={block.eyebrow} onChange={(event) => onChange({ eyebrow: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Title"><input value={block.title} onChange={(event) => onChange({ title: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Description"><textarea value={block.description} onChange={(event) => onChange({ description: event.target.value } as Partial<EmailBlock>)} rows={4} style={{ ...fieldStyle, minHeight: 96, resize: 'vertical' }} /></InspectorField>
        <InspectorField label="Image URL"><input value={block.image_url} onChange={(event) => onChange({ image_url: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Price label"><input value={block.price_label} onChange={(event) => onChange({ price_label: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="CTA label"><input value={block.cta_label} onChange={(event) => onChange({ cta_label: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="CTA URL"><input value={block.cta_url} onChange={(event) => onChange({ cta_url: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
      </>
    )
  }

  if (block.kind === 'video_thumb') {
    return (
      <>
        <InspectorField label="Thumbnail URL"><input value={block.thumbnail_url} onChange={(event) => onChange({ thumbnail_url: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Title"><input value={block.title} onChange={(event) => onChange({ title: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Caption"><textarea value={block.caption} onChange={(event) => onChange({ caption: event.target.value } as Partial<EmailBlock>)} rows={4} style={{ ...fieldStyle, minHeight: 96, resize: 'vertical' }} /></InspectorField>
        <InspectorField label="Target URL"><input value={block.target_url} onChange={(event) => onChange({ target_url: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
      </>
    )
  }

  if (block.kind === 'social_row') {
    return <SocialRowEditor block={block} onChange={onChange} />
  }

  if (block.kind === 'countdown') {
    return (
      <>
        <InspectorField label="Target ISO"><input value={block.target_at} onChange={(event) => onChange({ target_at: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Fallback label"><input value={block.fallback_label} onChange={(event) => onChange({ fallback_label: event.target.value } as Partial<EmailBlock>)} style={fieldStyle} /></InspectorField>
        <InspectorField label="Align"><AlignChoice value={block.align} onChange={(align) => onChange({ align } as Partial<EmailBlock>)} /></InspectorField>
      </>
    )
  }

  if (block.kind === 'dynamic_text') {
    return <DynamicTextEditor block={block} onChange={onChange} />
  }

  if (block.kind === 'conditional_section') {
    return <ConditionalSectionEditor block={block} onChange={onChange} />
  }

  return null
}

function SocialRowEditor({ block, onChange }: { block: EmailBlockSocialRow; onChange: (patch: Partial<EmailBlock>) => void }) {
  function updateItem(id: string, patch: Partial<EmailBlockSocialRow['items'][number]>) {
    onChange({
      items: block.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    } as Partial<EmailBlock>)
  }

  function addItem() {
    onChange({
      items: [...block.items, { id: nextId('so'), network: 'network', label: 'Label', url: 'https://example.com' }],
    } as Partial<EmailBlock>)
  }

  function removeItem(id: string) {
    onChange({ items: block.items.filter((item) => item.id !== id) } as Partial<EmailBlock>)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {block.items.map((item) => (
        <div key={item.id} style={nestedCardStyle}>
          <input value={item.network} onChange={(event) => updateItem(item.id, { network: event.target.value })} placeholder="Network" style={fieldStyle} />
          <input value={item.label} onChange={(event) => updateItem(item.id, { label: event.target.value })} placeholder="Label" style={fieldStyle} />
          <input value={item.url} onChange={(event) => updateItem(item.id, { url: event.target.value })} placeholder="URL" style={fieldStyle} />
          <button type="button" onClick={() => removeItem(item.id)} style={secondaryButtonStyle}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={addItem} style={secondaryButtonStyle}>Add item</button>
    </div>
  )
}

function DynamicTextEditor({ block, onChange }: { block: EmailBlockDynamicText; onChange: (patch: Partial<EmailBlock>) => void }) {
  function updateVariant(id: string, patch: Partial<EmailDynamicTextVariant>) {
    onChange({
      variants: block.variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)),
    } as Partial<EmailBlock>)
  }

  function addVariant() {
    onChange({
      variants: [...block.variants, { id: nextId('dv'), mode: 'segment', value: '', markdown: '' }],
    } as Partial<EmailBlock>)
  }

  function removeVariant(id: string) {
    onChange({ variants: block.variants.filter((variant) => variant.id !== id) } as Partial<EmailBlock>)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <InspectorField label="Default markdown">
        <textarea value={block.default_markdown} onChange={(event) => onChange({ default_markdown: event.target.value } as Partial<EmailBlock>)} rows={5} style={{ ...fieldStyle, minHeight: 110, resize: 'vertical' }} />
      </InspectorField>
      {block.variants.map((variant) => (
        <div key={variant.id} style={nestedCardStyle}>
          <select value={variant.mode} onChange={(event) => updateVariant(variant.id, { mode: event.target.value as EmailDynamicTextVariant['mode'] })} style={fieldStyle}>
            <option value="segment">Segment</option>
            <option value="region">Region</option>
          </select>
          <input value={variant.value} onChange={(event) => updateVariant(variant.id, { value: event.target.value })} placeholder="Match value" style={fieldStyle} />
          <textarea value={variant.markdown} onChange={(event) => updateVariant(variant.id, { markdown: event.target.value })} rows={4} placeholder="Variant markdown" style={{ ...fieldStyle, minHeight: 96, resize: 'vertical' }} />
          <button type="button" onClick={() => removeVariant(variant.id)} style={secondaryButtonStyle}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={addVariant} style={secondaryButtonStyle}>Add variant</button>
    </div>
  )
}

function ConditionalSectionEditor({ block, onChange }: { block: EmailBlockConditionalSection; onChange: (patch: Partial<EmailBlock>) => void }) {
  const [selectedNestedId, setSelectedNestedId] = useState<string | null>(block.blocks[0]?.id ?? null)

  useEffect(() => {
    if (!selectedNestedId || !block.blocks.some((nested) => nested.id === selectedNestedId)) {
      setSelectedNestedId(block.blocks[0]?.id ?? null)
    }
  }, [block.blocks, selectedNestedId])

  const selectedNested = block.blocks.find((nested) => nested.id === selectedNestedId) || null

  function updateNested(id: string, patch: Partial<EmailBlock>) {
    onChange({
      blocks: block.blocks.map((nested) => (nested.id === id ? ({ ...nested, ...patch } as EmailBlock) : nested)),
    } as Partial<EmailBlock>)
  }

  function addNested(kind: BlockKind) {
    if (kind === 'conditional_section') return
    const nested = buildDefaultBlock(kind)
    onChange({ blocks: [...block.blocks, nested] } as Partial<EmailBlock>)
    setSelectedNestedId(nested.id)
  }

  function removeNested(id: string) {
    const next = block.blocks.filter((nested) => nested.id !== id)
    onChange({ blocks: next } as Partial<EmailBlock>)
    if (selectedNestedId === id) setSelectedNestedId(next[0]?.id ?? null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <select
          value={block.rule.field}
          onChange={(event) => onChange({ rule: { ...block.rule, field: event.target.value as EmailBlockConditionalSection['rule']['field'] } } as Partial<EmailBlock>)}
          style={fieldStyle}
        >
          <option value="segment">Segment</option>
          <option value="tag">Tag</option>
          <option value="region">Region</option>
        </select>
        <select
          value={block.rule.operator}
          onChange={(event) => onChange({ rule: { ...block.rule, operator: event.target.value as EmailBlockConditionalSection['rule']['operator'] } } as Partial<EmailBlock>)}
          style={fieldStyle}
        >
          <option value="is">Is</option>
          <option value="is_not">Is not</option>
        </select>
      </div>
      <input value={block.rule.value} onChange={(event) => onChange({ rule: { ...block.rule, value: event.target.value } } as Partial<EmailBlock>)} placeholder="Match value" style={fieldStyle} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BLOCK_LIBRARY.filter((entry) => entry.kind !== 'conditional_section').map((entry) => (
          <button key={entry.kind} type="button" onClick={() => addNested(entry.kind)} style={miniIconButtonStyle}>{entry.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {block.blocks.map((nested) => (
          <button
            key={nested.id}
            type="button"
            onClick={() => setSelectedNestedId(nested.id)}
            style={{
              ...savedBlockButtonStyle,
              borderColor: nested.id === selectedNestedId ? 'var(--accent)' : 'var(--border)',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{nested.kind.replaceAll('_', ' ')}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nested block</span>
          </button>
        ))}
      </div>
      {selectedNested && (
        <div style={nestedCardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>{selectedNested.kind.replaceAll('_', ' ')}</span>
            <button type="button" onClick={() => removeNested(selectedNested.id)} style={secondaryButtonStyle}>Remove</button>
          </div>
          <BlockInspector block={selectedNested} onChange={(patch) => updateNested(selectedNested.id, patch)} />
        </div>
      )}
    </div>
  )
}

function InspectorField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  )
}

function AlignChoice({ value, onChange }: { value: EmailBlockAlign; onChange: (align: EmailBlockAlign) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {(['left', 'center'] as const).map((align) => (
        <button key={align} type="button" onClick={() => onChange(align)} style={{ ...secondaryButtonStyle, borderColor: align === value ? 'var(--accent)' : 'var(--border)' }}>
          {align}
        </button>
      ))}
    </div>
  )
}

export function AiDraftButton({
  label = 'Draft with AI',
  loading = false,
  onClick,
}: {
  label?: string
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={loading} style={secondaryButtonStyle}>
      {loading ? 'Drafting…' : label}
    </button>
  )
}

function RewriteDropdown({ onRewrite }: { onRewrite: (mode: RewriteMode) => Promise<void> }) {
  const [loading, setLoading] = useState<RewriteMode | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(mode: RewriteMode) {
    setError(null)
    setLoading(mode)
    setOpen(false)
    try {
      await onRewrite(mode)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Rewrite failed')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((current) => !current)} disabled={loading !== null} style={secondaryButtonStyle}>
        {loading ? 'Drafting…' : 'Rewrite'}
      </button>
      {open && loading === null && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 20 }}>
          {[
            ['shorten', 'Shorten'],
            ['expand', 'Expand'],
            ['casual', 'More casual'],
            ['professional', 'More professional'],
            ['urgent', 'More urgent'],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => { run(value as RewriteMode).catch(() => {}) }} style={secondaryButtonStyle}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <div style={errorTextStyle}>{error}</div>}
    </div>
  )
}

interface AiContactLite { id: number; name: string; email: string | null; company: string | null }

export function AiDraftModal({
  open,
  onClose,
  onSubmit,
  title = 'Draft email with AI',
  subtitle = 'Describe the email in plain English. The builder will turn it into blocks.',
  smsMode = false,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (prompt: string, tone: AiTone, contactId: number | null) => Promise<void>
  title?: string
  subtitle?: string
  smsMode?: boolean
}) {
  const [prompt, setPrompt] = useState('')
  const [tone, setTone] = useState<AiTone>('friendly')
  const [contactId, setContactId] = useState<number | null>(null)
  const [contactSearch, setContactSearch] = useState('')
  const [contacts, setContacts] = useState<AiContactLite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPrompt('')
    setTone('friendly')
    setContactId(null)
    setContactSearch('')
    setContacts([])
    setError(null)
    setLoading(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const query = contactSearch.trim()
    const timer = window.setTimeout(() => {
      const url = query ? `/api/crm/contacts?search=${encodeURIComponent(query)}` : '/api/crm/contacts'
      crmFetch<AiContactLite[]>(url).then((rows) => setContacts(rows.slice(0, 8))).catch(() => setContacts([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [contactSearch, open])

  if (!open) return null

  async function submit() {
    if (!prompt.trim()) {
      setError('Describe what you want the draft to do.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await onSubmit(prompt.trim(), tone, contactId)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'AI draft failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.52)' }}
      onClick={(event) => { if (event.target === event.currentTarget && !loading) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 560, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>{smsMode ? 'Draft SMS' : 'Draft email'}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>Brief</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder={smsMode ? 'Short SMS for a webinar reminder with a registration link.' : 'Product launch email for current customers with one CTA and a short social row.'} style={{ ...fieldStyle, minHeight: 120, resize: 'vertical' }} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>Tone</span>
            <select value={tone} onChange={(event) => setTone(event.target.value as AiTone)} style={fieldStyle}>
              <option value="friendly">Friendly</option>
              <option value="casual">Casual</option>
              <option value="professional">Professional</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>Contact</span>
            <input value={contactSearch} onChange={(event) => { setContactSearch(event.target.value); setContactId(null) }} placeholder="Optional search…" style={fieldStyle} />
          </label>
        </div>

        {contactSearch.trim() && contacts.length > 0 && !contactId && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-surface)', padding: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {contacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => { setContactId(contact.id); setContactSearch(contact.name || contact.email || '') }}
                style={savedBlockButtonStyle}
              >
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{contact.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{contact.email || contact.company || ''}</span>
              </button>
            ))}
          </div>
        )}

        {contactId && <div style={helperCopyStyle}>Drafting with contact context enabled.</div>}
        {error && <div style={errorTextStyle}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={loading} style={secondaryButtonStyle}>Cancel</button>
          <button type="button" onClick={() => { submit().catch(() => {}) }} disabled={loading} style={primaryButtonStyle(loading)}>
            {loading ? 'Drafting…' : smsMode ? 'Draft SMS' : 'Draft email'}
          </button>
        </div>
      </div>
    </div>
  )
}

const railStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-field)',
  border: '1px solid var(--border-field)',
  borderRadius: 10,
  padding: '9px 11px',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
}

const tileStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '10px 11px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  textAlign: 'left',
  cursor: 'pointer',
}

const savedBlockButtonStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '9px 10px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

const primaryButtonStyle = (disabled = false): React.CSSProperties => ({
  border: 'none',
  borderRadius: 10,
  padding: '9px 14px',
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'wait' : 'pointer',
  opacity: disabled ? 0.72 : 1,
})

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '8px 12px',
  background: 'var(--bg-surface)',
  color: 'var(--text)',
  fontSize: 12,
  cursor: 'pointer',
}

const miniIconButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '5px 9px',
  background: 'var(--bg-surface)',
  color: 'var(--text-muted)',
  fontSize: 11,
  cursor: 'pointer',
}

const ghostPillStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '6px 10px',
  background: 'var(--bg-surface)',
  color: 'var(--text)',
  fontSize: 12,
  cursor: 'pointer',
}

const helperCopyStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.55,
}

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--status-overdue)',
}

const previewCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg-surface)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const previewCardInnerStyle = (theme: EmailThemeValues): React.CSSProperties => ({
  border: `1px solid ${theme.muted_color}26`,
  borderRadius: 12,
  background: theme.surface_bg,
  padding: 12,
})

const nestedCardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--bg-surface)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const warningRowStyle: React.CSSProperties = {
  border: '1px solid color-mix(in oklab, var(--status-active) 30%, var(--border))',
  borderRadius: 10,
  background: 'color-mix(in oklab, var(--status-active) 10%, var(--bg-surface))',
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--text)',
  lineHeight: 1.45,
}

const placeholderBoxStyle: React.CSSProperties = {
  border: '1px dashed var(--border)',
  borderRadius: 10,
  minHeight: 140,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'var(--text-muted)',
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>{children}</div>
}
