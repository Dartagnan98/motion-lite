/**
 * Convert doc block JSON to clean markdown.
 * Reverses the markdownInlineToHtml() in BlockEditor.tsx.
 */

interface Block {
  id: string
  type: string
  content: string
  checked?: boolean
  rows?: string[][]
  url?: string
  docId?: number
  taskId?: number
  taskStatus?: string
  language?: string
}

/** Strip HTML inline tags back to markdown */
function htmlToMarkdownInline(html: string): string {
  if (!html) return ''
  return html
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<s>(.*?)<\/s>/g, '~~$1~~')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '') // strip any remaining tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Convert JSON blocks string to markdown */
export function blocksToMarkdown(contentJson: string): string {
  if (!contentJson) return ''
  let blocks: Block[]
  try {
    blocks = JSON.parse(contentJson)
    if (!Array.isArray(blocks)) return contentJson
  } catch {
    return contentJson // plain text fallback
  }

  const lines: string[] = []
  let prevType = ''

  for (const block of blocks) {
    const text = htmlToMarkdownInline(block.content)

    // Add blank line between different block types (except consecutive list items)
    const isListType = ['bulleted_list', 'numbered_list', 'check_list'].includes(block.type)
    const prevWasList = ['bulleted_list', 'numbered_list', 'check_list'].includes(prevType)
    if (lines.length > 0 && !(isListType && prevWasList && block.type === prevType)) {
      lines.push('')
    }

    switch (block.type) {
      case 'heading1':
        lines.push(`# ${text}`)
        break
      case 'heading2':
        lines.push(`## ${text}`)
        break
      case 'heading3':
        lines.push(`### ${text}`)
        break
      case 'bulleted_list':
        lines.push(`- ${text}`)
        break
      case 'numbered_list':
        lines.push(`1. ${text}`)
        break
      case 'check_list':
        lines.push(`- [${block.checked ? 'x' : ' '}] ${text}`)
        break
      case 'code':
        lines.push(`\`\`\`${block.language || ''}`)
        lines.push(text)
        lines.push('```')
        break
      case 'blockquote':
        lines.push(`> ${text}`)
        break
      case 'divider':
        lines.push('---')
        break
      case 'table':
        if (block.rows && block.rows.length > 0) {
          const header = block.rows[0]
          lines.push(`| ${header.join(' | ')} |`)
          lines.push(`| ${header.map(() => '---').join(' | ')} |`)
          for (let i = 1; i < block.rows.length; i++) {
            lines.push(`| ${block.rows[i].join(' | ')} |`)
          }
        }
        break
      case 'link':
        if (block.url) {
          lines.push(text ? `[${text}](${block.url})` : block.url)
        } else {
          lines.push(text)
        }
        break
      case 'page-link':
        lines.push(`[[${text}]]`)
        break
      case 'youtube':
        lines.push(block.url || text)
        break
      case 'task_ref':
        lines.push(`- [${block.taskStatus === 'done' ? 'x' : ' '}] ${text}`)
        break
      case 'paragraph':
      default:
        lines.push(text)
        break
    }

    prevType = block.type
  }

  return lines.join('\n').trim()
}
