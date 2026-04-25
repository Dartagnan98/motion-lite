/**
 * Shared block-model + rendering helpers for CRM email composition.
 *
 * The system stores JSON blocks for richer email content and renders those
 * blocks into:
 *  - final HTML safe for major mail clients
 *  - plain-text fallbacks
 *  - inbox preview rows + heuristic warnings
 *
 * The block model deliberately stays narrower than a full WYSIWYG. Rich text
 * is still the tiny markdown subset: **bold**, _italic_, [label](url).
 */

export type EmailBlockAlign = 'left' | 'center'
export type EmailConditionalField = 'segment' | 'tag' | 'region'
export type EmailConditionalOperator = 'is' | 'is_not'
export type EmailDynamicVariantMode = 'region' | 'segment'
export type EmailPreviewWarning =
  | 'long_subject'
  | 'missing_preheader'
  | 'image_heavy'
  | 'too_many_links'
  | 'weak_plain_text'

export interface EmailThemeValues {
  accent_color: string
  canvas_bg: string
  surface_bg: string
  text_color: string
  muted_color: string
  button_radius: number
}

export interface EmailVariantContext {
  segment?: string | null
  region?: string | null
  tags?: string[] | null
  now?: string | number | Date | null
}

export type EmailBlockHeading = {
  id: string
  kind: 'heading'
  text: string
  level: 1 | 2 | 3
  align: EmailBlockAlign
}

export type EmailBlockText = {
  id: string
  kind: 'text'
  markdown: string
}

export type EmailBlockImage = {
  id: string
  kind: 'image'
  url: string
  alt: string
  align: EmailBlockAlign
  width_pct: number
}

export type EmailBlockButton = {
  id: string
  kind: 'button'
  label: string
  url: string
  align: EmailBlockAlign
}

export type EmailBlockDivider = {
  id: string
  kind: 'divider'
  style: 'solid' | 'dashed'
  opacity: number
}

export type EmailBlockSpacer = {
  id: string
  kind: 'spacer'
  height: number
}

export type EmailBlockProductCard = {
  id: string
  kind: 'product_card'
  eyebrow: string
  title: string
  description: string
  image_url: string
  price_label: string
  cta_label: string
  cta_url: string
}

export type EmailBlockVideoThumb = {
  id: string
  kind: 'video_thumb'
  thumbnail_url: string
  title: string
  caption: string
  target_url: string
}

export type EmailSocialRowItem = {
  id: string
  network: string
  label: string
  url: string
}

export type EmailBlockSocialRow = {
  id: string
  kind: 'social_row'
  items: EmailSocialRowItem[]
}

export type EmailBlockCountdown = {
  id: string
  kind: 'countdown'
  target_at: string
  fallback_label: string
  align: EmailBlockAlign
}

export type EmailDynamicTextVariant = {
  id: string
  mode: EmailDynamicVariantMode
  value: string
  markdown: string
}

export type EmailBlockDynamicText = {
  id: string
  kind: 'dynamic_text'
  default_markdown: string
  variants: EmailDynamicTextVariant[]
}

export type EmailConditionalRule = {
  field: EmailConditionalField
  operator: EmailConditionalOperator
  value: string
}

export type EmailBlockConditionalSection = {
  id: string
  kind: 'conditional_section'
  rule: EmailConditionalRule
  blocks: EmailBlock[]
}

export type EmailBlock =
  | EmailBlockHeading
  | EmailBlockText
  | EmailBlockImage
  | EmailBlockButton
  | EmailBlockDivider
  | EmailBlockSpacer
  | EmailBlockProductCard
  | EmailBlockVideoThumb
  | EmailBlockSocialRow
  | EmailBlockCountdown
  | EmailBlockDynamicText
  | EmailBlockConditionalSection

type MaterializedEmailBlock = Exclude<EmailBlock, EmailBlockDynamicText | EmailBlockConditionalSection>

export interface RenderEmailBlocksOptions {
  accentColor?: string | null
  workspaceName?: string | null
  theme?: Partial<EmailThemeValues> | null
  variantContext?: EmailVariantContext | null
  now?: string | number | Date | null
}

export interface EmailInboxPreviewRow {
  client: 'gmail_desktop' | 'gmail_mobile' | 'outlook'
  label: string
  subject: string
  preview: string
}

export interface EmailSubjectVariantPreview {
  variant: 'a' | 'b'
  subject: string
  score: number
  warnings: EmailPreviewWarning[]
}

export interface EmailInboxPreviewResult {
  rows: EmailInboxPreviewRow[]
  warnings: EmailPreviewWarning[]
  subjects: EmailSubjectVariantPreview[]
  recommended_variant: 'a' | 'b' | null
  plain_text: string
  html: string
}

export const DEFAULT_EMAIL_THEME: EmailThemeValues = {
  accent_color: '#D97757',
  canvas_bg: '#f5f1ea',
  surface_bg: '#fffdf9',
  text_color: '#1f1d1a',
  muted_color: '#6f675e',
  button_radius: 10,
}

const CONTENT_WIDTH = 560
const MAX_BLOCK_DEPTH = 3

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

function sanitizeUrl(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return '#'
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return '#'
  if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return '#'
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed
  return '#'
}

function sanitizeColor(raw: string | null | undefined, fallback: string): string {
  const value = (raw || '').trim()
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 100
  return Math.max(1, Math.min(100, Math.round(n)))
}

function clampHeight(n: number): number {
  if (!Number.isFinite(n)) return 16
  return Math.max(4, Math.min(160, Math.round(n)))
}

function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(1, n))
}

function clampRadius(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_EMAIL_THEME.button_radius
  return Math.max(0, Math.min(28, Math.round(n)))
}

function normalizeCasefold(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean)) return null
  const full = clean.length === 3 ? clean.split('').map((part) => `${part}${part}`).join('') : clean
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.max(0, Math.min(1, alpha)).toFixed(2)})`
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asAlign(v: unknown): EmailBlockAlign {
  return v === 'center' ? 'center' : 'left'
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function renderInlineMarkdown(raw: string): string {
  const escaped = escapeHtml(raw)
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const safeUrl = escapeAttr(sanitizeUrl(url))
      return `<a href="${safeUrl}" style="color:inherit;text-decoration:underline">${label}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
}

function stripInlineMarkdown(raw: string): string {
  return (raw || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => `${label} (${url})`)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
}

function countMarkdownLinks(raw: string): number {
  const matches = raw.match(/\[([^\]]+)\]\(([^)\s]+)\)/g)
  return matches ? matches.length : 0
}

function resolveNow(input?: string | number | Date | null): Date {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input
  if (typeof input === 'number') {
    const d = new Date(input)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof input === 'string' && input.trim()) {
    const d = new Date(input)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

function formatCountdownTarget(targetAt: string): string {
  const d = new Date(targetAt)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

function getCountdownParts(targetAt: string, now: Date): { days: number; hours: number; minutes: number } | null {
  const target = new Date(targetAt)
  if (Number.isNaN(target.getTime())) return null
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return null
  const totalMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  return { days, hours, minutes }
}

export function resolveEmailTheme(
  theme?: Partial<EmailThemeValues> | null,
  accentColor?: string | null,
): EmailThemeValues {
  return {
    accent_color: sanitizeColor(theme?.accent_color || accentColor, DEFAULT_EMAIL_THEME.accent_color),
    canvas_bg: sanitizeColor(theme?.canvas_bg, DEFAULT_EMAIL_THEME.canvas_bg),
    surface_bg: sanitizeColor(theme?.surface_bg, DEFAULT_EMAIL_THEME.surface_bg),
    text_color: sanitizeColor(theme?.text_color, DEFAULT_EMAIL_THEME.text_color),
    muted_color: sanitizeColor(theme?.muted_color, DEFAULT_EMAIL_THEME.muted_color),
    button_radius: clampRadius(theme?.button_radius ?? DEFAULT_EMAIL_THEME.button_radius),
  }
}

function normalizeSocialItems(raw: unknown): EmailSocialRowItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): EmailSocialRowItem | null => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const label = asString(obj.label).trim() || asString(obj.network).trim() || 'Link'
      const url = asString(obj.url).trim()
      if (!url) return null
      return {
        id: asString(obj.id) || nextId('social'),
        network: asString(obj.network).trim() || label,
        label,
        url,
      }
    })
    .filter((item): item is EmailSocialRowItem => item !== null)
}

function normalizeDynamicVariants(raw: unknown): EmailDynamicTextVariant[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): EmailDynamicTextVariant | null => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const mode = obj.mode === 'region' ? 'region' : obj.mode === 'segment' ? 'segment' : null
      const value = asString(obj.value).trim()
      const markdown = asString(obj.markdown)
      if (!mode || !value || !markdown.trim()) return null
      return {
        id: asString(obj.id) || nextId('dyn'),
        mode,
        value,
        markdown,
      }
    })
    .filter((item): item is EmailDynamicTextVariant => item !== null)
}

function normalizeConditionalRule(raw: unknown): EmailConditionalRule {
  if (!raw || typeof raw !== 'object') {
    return { field: 'segment', operator: 'is', value: '' }
  }
  const obj = raw as Record<string, unknown>
  return {
    field: obj.field === 'tag' ? 'tag' : obj.field === 'region' ? 'region' : 'segment',
    operator: obj.operator === 'is_not' ? 'is_not' : 'is',
    value: asString(obj.value).trim(),
  }
}

export function normalizeEmailBlock(entry: unknown, depth = 0): EmailBlock | null {
  if (!entry || typeof entry !== 'object' || depth > MAX_BLOCK_DEPTH) return null
  const obj = entry as Record<string, unknown>
  const id = asString(obj.id) || nextId('blk')
  switch (obj.kind) {
    case 'heading': {
      const levelRaw = obj.level
      const level: 1 | 2 | 3 = levelRaw === 1 ? 1 : levelRaw === 3 ? 3 : 2
      return { id, kind: 'heading', text: asString(obj.text), level, align: asAlign(obj.align) }
    }
    case 'text':
      return { id, kind: 'text', markdown: asString(obj.markdown) }
    case 'image':
      return {
        id,
        kind: 'image',
        url: asString(obj.url),
        alt: asString(obj.alt),
        align: asAlign(obj.align),
        width_pct: clampPct(asNumber(obj.width_pct, 100)),
      }
    case 'button':
      return {
        id,
        kind: 'button',
        label: asString(obj.label, 'Click here'),
        url: asString(obj.url),
        align: asAlign(obj.align),
      }
    case 'divider':
      return {
        id,
        kind: 'divider',
        style: obj.style === 'dashed' ? 'dashed' : 'solid',
        opacity: clampOpacity(asNumber(obj.opacity, 0.4)),
      }
    case 'spacer':
      return { id, kind: 'spacer', height: clampHeight(asNumber(obj.height, 16)) }
    case 'product_card':
      return {
        id,
        kind: 'product_card',
        eyebrow: asString(obj.eyebrow),
        title: asString(obj.title),
        description: asString(obj.description),
        image_url: asString(obj.image_url),
        price_label: asString(obj.price_label),
        cta_label: asString(obj.cta_label, 'View product'),
        cta_url: asString(obj.cta_url),
      }
    case 'video_thumb':
      return {
        id,
        kind: 'video_thumb',
        thumbnail_url: asString(obj.thumbnail_url),
        title: asString(obj.title),
        caption: asString(obj.caption),
        target_url: asString(obj.target_url),
      }
    case 'social_row':
      return { id, kind: 'social_row', items: normalizeSocialItems(obj.items) }
    case 'countdown':
      return {
        id,
        kind: 'countdown',
        target_at: asString(obj.target_at),
        fallback_label: asString(obj.fallback_label, 'Offer ends soon'),
        align: asAlign(obj.align),
      }
    case 'dynamic_text':
      return {
        id,
        kind: 'dynamic_text',
        default_markdown: asString(obj.default_markdown),
        variants: normalizeDynamicVariants(obj.variants),
      }
    case 'conditional_section': {
      const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : []
      const blocks = rawBlocks
        .map((item) => normalizeEmailBlock(item, depth + 1))
        .filter((item): item is EmailBlock => item !== null)
      return {
        id,
        kind: 'conditional_section',
        rule: normalizeConditionalRule(obj.rule),
        blocks,
      }
    }
    default:
      return null
  }
}

function resolveDynamicMarkdown(block: EmailBlockDynamicText, context: EmailVariantContext): string {
  const segment = normalizeCasefold(context.segment)
  const region = normalizeCasefold(context.region)
  for (const variant of block.variants) {
    const value = normalizeCasefold(variant.value)
    if (variant.mode === 'segment' && value && value === segment) return variant.markdown
    if (variant.mode === 'region' && value && value === region) return variant.markdown
  }
  return block.default_markdown
}

function matchesConditionalRule(rule: EmailConditionalRule, context: EmailVariantContext): boolean {
  const value = normalizeCasefold(rule.value)
  if (!value) return true
  let matched = false
  if (rule.field === 'segment') {
    matched = normalizeCasefold(context.segment) === value
  } else if (rule.field === 'region') {
    matched = normalizeCasefold(context.region) === value
  } else {
    const tags = new Set((context.tags || []).map((tag) => normalizeCasefold(tag)))
    matched = tags.has(value)
  }
  return rule.operator === 'is_not' ? !matched : matched
}

export function materializeEmailBlocks(
  blocks: EmailBlock[],
  context: EmailVariantContext = {},
  depth = 0,
): MaterializedEmailBlock[] {
  if (!Array.isArray(blocks) || depth > MAX_BLOCK_DEPTH) return []
  const materialized: MaterializedEmailBlock[] = []
  for (const block of blocks) {
    if (block.kind === 'dynamic_text') {
      materialized.push({
        id: block.id,
        kind: 'text',
        markdown: resolveDynamicMarkdown(block, context),
      })
      continue
    }
    if (block.kind === 'conditional_section') {
      if (matchesConditionalRule(block.rule, context)) {
        materialized.push(...materializeEmailBlocks(block.blocks, context, depth + 1))
      }
      continue
    }
    materialized.push(block)
  }
  return materialized
}

function renderHeadingHtml(block: EmailBlockHeading, theme: EmailThemeValues): string {
  const level = block.level === 1 ? 1 : block.level === 3 ? 3 : 2
  const tag = `h${level}`
  const sizePx = level === 1 ? 28 : level === 2 ? 22 : 18
  const text = escapeHtml(block.text || '')
  return `<tr><td style="padding:8px 0">
    <${tag} style="margin:0;font:700 ${sizePx}px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)};text-align:${block.align}">${text}</${tag}>
  </td></tr>`
}

function renderTextHtml(block: EmailBlockText, theme: EmailThemeValues): string {
  const content = renderInlineMarkdown(block.markdown || '')
  return `<tr><td style="padding:8px 0">
    <p style="margin:0;font:400 15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${content}</p>
  </td></tr>`
}

function renderImageHtml(block: EmailBlockImage): string {
  const url = escapeAttr(sanitizeUrl(block.url))
  const alt = escapeAttr(block.alt || '')
  const pct = clampPct(block.width_pct)
  return `<tr><td align="${block.align}" style="padding:12px 0">
    <img src="${url}" alt="${alt}" width="${Math.round((pct / 100) * CONTENT_WIDTH)}" style="display:block;max-width:100%;width:${pct}%;height:auto;border:0;outline:none" />
  </td></tr>`
}

function renderButtonHtml(block: EmailBlockButton, theme: EmailThemeValues): string {
  return `<tr><td align="${block.align}" style="padding:14px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
      <tr><td style="background:${escapeAttr(theme.accent_color)};border-radius:${theme.button_radius}px">
        <a href="${escapeAttr(sanitizeUrl(block.url))}" style="display:inline-block;padding:12px 22px;font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#ffffff;text-decoration:none;border-radius:${theme.button_radius}px">${escapeHtml(block.label || 'Click here')}</a>
      </td></tr>
    </table>
  </td></tr>`
}

function renderDividerHtml(block: EmailBlockDivider, theme: EmailThemeValues): string {
  const color = colorWithAlpha(theme.muted_color, clampOpacity(block.opacity))
  return `<tr><td style="padding:12px 0">
    <hr style="border:0;border-top:1px ${block.style} ${escapeAttr(color)};margin:0" />
  </td></tr>`
}

function renderSpacerHtml(block: EmailBlockSpacer): string {
  const h = clampHeight(block.height)
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</td></tr>`
}

function renderProductCardHtml(block: EmailBlockProductCard, theme: EmailThemeValues): string {
  const border = colorWithAlpha(theme.muted_color, 0.24)
  const price = block.price_label.trim()
    ? `<div style="margin-top:8px;font:600 15px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${escapeHtml(block.price_label)}</div>`
    : ''
  const image = block.image_url.trim()
    ? `<tr><td style="padding-bottom:14px">
        <img src="${escapeAttr(sanitizeUrl(block.image_url))}" alt="${escapeAttr(block.title || 'Product image')}" width="${CONTENT_WIDTH}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;border-radius:${Math.max(6, theme.button_radius)}px" />
      </td></tr>`
    : ''
  const cta = block.cta_url.trim()
    ? `<tr><td style="padding-top:16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
          <tr><td style="background:${escapeAttr(theme.accent_color)};border-radius:${theme.button_radius}px">
            <a href="${escapeAttr(sanitizeUrl(block.cta_url))}" style="display:inline-block;padding:11px 18px;font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#ffffff;text-decoration:none;border-radius:${theme.button_radius}px">${escapeHtml(block.cta_label || 'View product')}</a>
          </td></tr>
        </table>
      </td></tr>`
    : ''
  return `<tr><td style="padding:12px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${escapeAttr(border)};border-radius:${Math.max(theme.button_radius + 2, 12)}px;padding:18px;background:${escapeAttr(theme.surface_bg)}">
      ${image}
      <tr><td>
        ${block.eyebrow ? `<div style="font:600 11px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:${escapeAttr(theme.muted_color)}">${escapeHtml(block.eyebrow)}</div>` : ''}
        <div style="margin-top:${block.eyebrow ? 8 : 0}px;font:700 22px/1.25 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${escapeHtml(block.title || 'Product')}</div>
        ${price}
        ${block.description ? `<div style="margin-top:10px;font:400 14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${renderInlineMarkdown(block.description)}</div>` : ''}
      </td></tr>
      ${cta}
    </table>
  </td></tr>`
}

function renderVideoThumbHtml(block: EmailBlockVideoThumb, theme: EmailThemeValues): string {
  const border = colorWithAlpha(theme.muted_color, 0.24)
  const image = block.thumbnail_url.trim()
    ? `<a href="${escapeAttr(sanitizeUrl(block.target_url))}" style="display:block;text-decoration:none">
        <img src="${escapeAttr(sanitizeUrl(block.thumbnail_url))}" alt="${escapeAttr(block.title || 'Video thumbnail')}" width="${CONTENT_WIDTH}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;border-radius:${Math.max(6, theme.button_radius)}px" />
      </a>`
    : `<div style="padding:28px 20px;text-align:center;border:1px dashed ${escapeAttr(border)};border-radius:${Math.max(theme.button_radius, 10)}px;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.muted_color)}">Add a video thumbnail</div>`
  return `<tr><td style="padding:12px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${escapeAttr(border)};border-radius:${Math.max(theme.button_radius + 2, 12)}px;padding:18px;background:${escapeAttr(theme.surface_bg)}">
      <tr><td>${image}</td></tr>
      <tr><td style="padding-top:14px">
        <div style="font:700 18px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${escapeHtml(block.title || 'Watch now')}</div>
        ${block.caption ? `<div style="margin-top:8px;font:400 14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.muted_color)}">${renderInlineMarkdown(block.caption)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>`
}

function renderSocialRowHtml(block: EmailBlockSocialRow, theme: EmailThemeValues): string {
  if (block.items.length === 0) return ''
  const border = colorWithAlpha(theme.muted_color, 0.22)
  const cells = block.items.map((item) => (
    `<td style="padding:0 4px 0 0">
      <a href="${escapeAttr(sanitizeUrl(item.url))}" style="display:inline-block;padding:8px 12px;border-radius:${Math.max(theme.button_radius - 2, 6)}px;border:1px solid ${escapeAttr(border)};font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)};text-decoration:none">${escapeHtml(item.label || item.network)}</a>
    </td>`
  )).join('')
  return `<tr><td style="padding:12px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
  </td></tr>`
}

function renderCountdownHtml(block: EmailBlockCountdown, theme: EmailThemeValues, now: Date): string {
  const parts = getCountdownParts(block.target_at, now)
  if (!parts) {
    return `<tr><td align="${block.align}" style="padding:12px 0">
      <div style="display:inline-block;padding:12px 16px;border-radius:${theme.button_radius}px;background:${escapeAttr(colorWithAlpha(theme.accent_color, 0.10))};font:600 14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)}">${escapeHtml(block.fallback_label || 'Offer ends soon')}</div>
    </td></tr>`
  }
  const targetLabel = formatCountdownTarget(block.target_at)
  const cells = [
    { label: 'Days', value: String(parts.days) },
    { label: 'Hours', value: String(parts.hours).padStart(2, '0') },
    { label: 'Mins', value: String(parts.minutes).padStart(2, '0') },
  ].map((cell) => (
    `<td style="padding:0 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${escapeAttr(colorWithAlpha(theme.accent_color, 0.10))};border:1px solid ${escapeAttr(colorWithAlpha(theme.accent_color, 0.22))};border-radius:${Math.max(theme.button_radius, 8)}px;padding:10px 12px">
        <tr><td style="font:700 18px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.text_color)};text-align:center">${cell.value}</td></tr>
        <tr><td style="padding-top:6px;font:600 10px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:${escapeAttr(theme.muted_color)};text-align:center">${cell.label}</td></tr>
      </table>
    </td>`
  )).join('')
  return `<tr><td align="${block.align}" style="padding:12px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${block.align === 'center' ? '0 auto' : '0'}">
      <tr>${cells}</tr>
      ${targetLabel ? `<tr><td colspan="3" style="padding-top:10px;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:${escapeAttr(theme.muted_color)};text-align:${block.align}">${escapeHtml(targetLabel)}</td></tr>` : ''}
    </table>
  </td></tr>`
}

function renderBlockHtml(block: MaterializedEmailBlock, theme: EmailThemeValues, now: Date): string {
  switch (block.kind) {
    case 'heading': return renderHeadingHtml(block, theme)
    case 'text': return renderTextHtml(block, theme)
    case 'image': return renderImageHtml(block)
    case 'button': return renderButtonHtml(block, theme)
    case 'divider': return renderDividerHtml(block, theme)
    case 'spacer': return renderSpacerHtml(block)
    case 'product_card': return renderProductCardHtml(block, theme)
    case 'video_thumb': return renderVideoThumbHtml(block, theme)
    case 'social_row': return renderSocialRowHtml(block, theme)
    case 'countdown': return renderCountdownHtml(block, theme, now)
    default: return ''
  }
}

export function renderEmailBlocksToHtml(
  blocks: EmailBlock[],
  opts: RenderEmailBlocksOptions = {},
): string {
  const theme = resolveEmailTheme(opts.theme, opts.accentColor)
  const now = resolveNow(opts.now ?? opts.variantContext?.now)
  const materialized = materializeEmailBlocks(blocks, opts.variantContext || {})
  const rows = materialized.map((block) => renderBlockHtml(block, theme, now)).join('')
  const border = colorWithAlpha(theme.muted_color, 0.18)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${escapeAttr(theme.canvas_bg)}">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${CONTENT_WIDTH}" style="max-width:${CONTENT_WIDTH}px;width:100%;background:${escapeAttr(theme.surface_bg)};border:1px solid ${escapeAttr(border)};border-radius:16px;padding:24px">
        ${rows}
      </table>
    </td></tr>
  </table>`
}

function renderBlockText(block: MaterializedEmailBlock, now: Date): string {
  switch (block.kind) {
    case 'heading':
      return (block.text || '').trim()
    case 'text':
      return stripInlineMarkdown(block.markdown || '').trim()
    case 'image':
      return block.alt ? `[Image: ${block.alt}]` : '[Image]'
    case 'button':
      return `${(block.label || 'Click here').trim()} (${sanitizeUrl(block.url)})`
    case 'divider':
      return '---'
    case 'spacer':
      return ''
    case 'product_card': {
      const parts = [
        block.eyebrow.trim(),
        block.title.trim(),
        block.price_label.trim(),
        stripInlineMarkdown(block.description).trim(),
        block.cta_label.trim() && block.cta_url.trim() ? `${block.cta_label.trim()} (${sanitizeUrl(block.cta_url)})` : '',
      ].filter(Boolean)
      return parts.join('\n')
    }
    case 'video_thumb':
      return [
        block.title.trim(),
        stripInlineMarkdown(block.caption).trim(),
        block.target_url.trim() ? `Watch: ${sanitizeUrl(block.target_url)}` : '',
      ].filter(Boolean).join('\n')
    case 'social_row':
      return block.items.map((item) => `${item.label || item.network} (${sanitizeUrl(item.url)})`).join('\n')
    case 'countdown': {
      const parts = getCountdownParts(block.target_at, now)
      if (!parts) return block.fallback_label.trim()
      return `Countdown: ${parts.days}d ${parts.hours}h ${parts.minutes}m${block.fallback_label.trim() ? ` · ${block.fallback_label.trim()}` : ''}`
    }
    default:
      return ''
  }
}

export function renderEmailBlocksToText(
  blocks: EmailBlock[],
  opts: { variantContext?: EmailVariantContext | null; now?: string | number | Date | null } = {},
): string {
  if (!Array.isArray(blocks)) return ''
  const now = resolveNow(opts.now ?? opts.variantContext?.now)
  return materializeEmailBlocks(blocks, opts.variantContext || {})
    .map((block) => renderBlockText(block, now))
    .filter((line) => line.length > 0)
    .join('\n\n')
}

export function buildEmailInboxPreview(
  params: {
    blocks: EmailBlock[]
    subject?: string | null
    subject_b?: string | null
    preview_text?: string | null
    theme?: Partial<EmailThemeValues> | null
    variantContext?: EmailVariantContext | null
    now?: string | number | Date | null
  },
): EmailInboxPreviewResult {
  const previewText = (params.preview_text || '').trim()
  const html = renderEmailBlocksToHtml(params.blocks, {
    theme: params.theme,
    variantContext: params.variantContext || undefined,
    now: params.now,
  })
  const plainText = renderEmailBlocksToText(params.blocks, {
    variantContext: params.variantContext || undefined,
    now: params.now,
  })
  const materialized = materializeEmailBlocks(params.blocks, params.variantContext || {})
  let imageCount = 0
  let linkCount = 0
  for (const block of materialized) {
    if (block.kind === 'image' || block.kind === 'product_card' || block.kind === 'video_thumb') imageCount += 1
    if (block.kind === 'button') linkCount += 1
    if (block.kind === 'product_card' && block.cta_url.trim()) linkCount += 1
    if (block.kind === 'video_thumb' && block.target_url.trim()) linkCount += 1
    if (block.kind === 'social_row') linkCount += block.items.length
    if (block.kind === 'text') linkCount += countMarkdownLinks(block.markdown)
  }

  const warnings = new Set<EmailPreviewWarning>()
  if (!previewText) warnings.add('missing_preheader')
  if (imageCount >= 3 || imageCount > Math.max(1, Math.floor(materialized.length / 2))) warnings.add('image_heavy')
  if (linkCount > 7) warnings.add('too_many_links')
  if (plainText.replace(/\s+/g, ' ').trim().length < 80) warnings.add('weak_plain_text')

  const subjectA = (params.subject || '').trim()
  const subjectB = (params.subject_b || '').trim()
  const subjectVariants: EmailSubjectVariantPreview[] = []

  const buildSubjectVariant = (variant: 'a' | 'b', subject: string): EmailSubjectVariantPreview => {
    const subjectWarnings: EmailPreviewWarning[] = []
    let score = 100
    if (subject.length > 60) {
      subjectWarnings.push('long_subject')
      warnings.add('long_subject')
      score -= 16
    }
    if (subject.length < 24) score -= 6
    if (!/[a-z]/i.test(subject)) score -= 6
    if (/[!?]{2,}/.test(subject)) score -= 5
    score -= Math.max(0, subject.length - 44) * 0.35
    return { variant, subject, score: Math.max(0, Math.round(score)), warnings: subjectWarnings }
  }

  if (subjectA) subjectVariants.push(buildSubjectVariant('a', subjectA))
  if (subjectB) subjectVariants.push(buildSubjectVariant('b', subjectB))

  let recommendedVariant: 'a' | 'b' | null = null
  if (subjectVariants.length === 2) {
    const [first, second] = subjectVariants
    if (Math.abs(first.score - second.score) >= 4) {
      recommendedVariant = first.score > second.score ? first.variant : second.variant
    }
  }

  const rows: EmailInboxPreviewRow[] = [
    { client: 'gmail_desktop', label: 'Gmail desktop', subject: truncatePreview(subjectA || subjectB || 'Subject line', 58), preview: truncatePreview(previewText || plainText, 92) },
    { client: 'gmail_mobile', label: 'Gmail mobile', subject: truncatePreview(subjectA || subjectB || 'Subject line', 34), preview: truncatePreview(previewText || plainText, 50) },
    { client: 'outlook', label: 'Outlook', subject: truncatePreview(subjectA || subjectB || 'Subject line', 52), preview: truncatePreview(previewText || plainText, 74) },
  ]

  return {
    rows,
    warnings: Array.from(warnings),
    subjects: subjectVariants,
    recommended_variant: recommendedVariant,
    plain_text: plainText,
    html,
  }
}

function truncatePreview(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * Safely parse a JSON string into a block list. Unknown fields are dropped;
 * invalid blocks are skipped; always returns an array.
 */
export function parseEmailBlocks(raw: string | null | undefined): EmailBlock[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => normalizeEmailBlock(entry))
      .filter((block): block is EmailBlock => block !== null)
  } catch {
    return []
  }
}
