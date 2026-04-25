// Minimal safe markdown-to-HTML renderer used by the help center. Runs on
// the server so we can cache the rendered HTML alongside the markdown body.
// Covers the subset of markdown that matters for knowledge-base articles:
// headings, bold / italic / code / links, ordered + unordered lists,
// blockquotes, code fences, images, horizontal rules, and paragraphs.
// Anything exotic falls back to a <p> of escaped text — no HTML smuggling.

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInline(text: string): string {
  // Escape first so markdown characters inside text don't accidentally become
  // HTML. We then re-insert the ones we support as real tags.
  let out = escapeHtml(text)

  // Inline code — done before everything else so its contents are immune.
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`)

  // Images ![alt](src) — must come before links because the syntax overlaps.
  out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_m, alt: string, src: string) => {
    const safe = /^https?:\/\//i.test(src) || src.startsWith('/') ? src : '#'
    return `<img src="${safe}" alt="${alt}" loading="lazy" style="max-width:100%;border-radius:6px" />`
  })

  // Links [label](url)
  out = out.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_m, label: string, url: string) => {
    const safe = /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(url) ? url : '#'
    const external = /^https?:\/\//i.test(safe)
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : ''
    return `<a href="${safe}"${attrs}>${label}</a>`
  })

  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')

  return out
}

/**
 * Render a markdown string to a sanitized HTML fragment. Output is safe to
 * drop into a help-center article page via dangerouslySetInnerHTML because
 * every non-whitelisted character is escaped before tags are reinjected.
 */
export function renderHelpMarkdown(markdown: string): string {
  const src = String(markdown ?? '').replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0

  type ListCtx = { kind: 'ul' | 'ol'; indent: number }
  const listStack: ListCtx[] = []

  function closeAllLists() {
    while (listStack.length) {
      const ctx = listStack.pop()!
      out.push(`</li></${ctx.kind}>`)
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code blocks ```lang
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      closeAllLists()
      const lang = fence[1] || ''
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1 // skip closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    // Blank line — closes lists, otherwise ignored.
    if (line.trim() === '') {
      closeAllLists()
      i += 1
      continue
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeAllLists()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      i += 1
      continue
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) {
      closeAllLists()
      out.push('<hr />')
      i += 1
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeAllLists()
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`)
      continue
    }

    // List items (unordered or ordered). Supports nested lists via indent.
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/)
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
    if (ulMatch || olMatch) {
      const indent = (ulMatch?.[1].length ?? olMatch?.[1].length ?? 0)
      const kind: 'ul' | 'ol' = ulMatch ? 'ul' : 'ol'
      const content = ulMatch ? ulMatch[2] : olMatch![3]

      // Close deeper lists or those of different kind at the same level.
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        const ctx = listStack.pop()!
        out.push(`</li></${ctx.kind}>`)
      }
      const top = listStack[listStack.length - 1]
      if (!top || top.indent < indent) {
        listStack.push({ kind, indent })
        out.push(`<${kind}><li>`)
      } else if (top.indent === indent && top.kind !== kind) {
        out.push(`</li></${top.kind}>`)
        listStack.pop()
        listStack.push({ kind, indent })
        out.push(`<${kind}><li>`)
      } else {
        out.push(`</li><li>`)
      }
      out.push(renderInline(content))
      i += 1
      continue
    } else {
      closeAllLists()
    }

    // Paragraph — greedy collect consecutive text lines.
    const paragraph: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*)[-*+]\s+/.test(lines[i]) &&
      !/^(\s*)\d+\.\s+/.test(lines[i]) &&
      !/^-{3,}\s*$/.test(lines[i]) &&
      !/^\*{3,}\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  closeAllLists()
  return out.join('\n')
}

/** Strip markdown to plain text. Used for summary extraction and AI context. */
export function stripHelpMarkdown(markdown: string): string {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~`-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Slugify a free-text title into a URL-safe fragment. */
export function slugifyHelpTitle(input: string): string {
  const base = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'untitled'
}
