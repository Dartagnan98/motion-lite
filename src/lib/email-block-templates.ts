/**
 * Starter templates shown in the builder.
 * Each builder returns fresh IDs so operators can start quickly and edit
 * without cross-template key reuse.
 */
import type { EmailBlock } from './email-blocks'

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export interface EmailBlockTemplate {
  slug: string
  name: string
  description: string
  build: () => EmailBlock[]
}

export const EMAIL_BLOCK_TEMPLATES: EmailBlockTemplate[] = [
  {
    slug: 'product-launch',
    name: 'Product launch',
    description: 'Launch note with a product card, supporting copy, and one CTA.',
    build: () => [
      { id: id('h'), kind: 'heading', text: 'A new release is live', level: 1, align: 'left' },
      { id: id('t'), kind: 'text', markdown: 'Hey {{first_name}},\n\nWe just launched the next version and wanted to give you the short version first. This update is built for operators who want a faster path from idea to execution.' },
      {
        id: id('pc'),
        kind: 'product_card',
        eyebrow: 'Launch week',
        title: 'Operator plan',
        description: 'Clear on what changed, who it is for, and the one action you want next.',
        image_url: '',
        price_label: '$149 / month',
        cta_label: 'See what changed',
        cta_url: 'https://example.com',
      },
      { id: id('b'), kind: 'button', label: 'Open the release notes', url: 'https://example.com', align: 'left' },
    ],
  },
  {
    slug: 'webinar-reminder',
    name: 'Webinar reminder',
    description: 'Reminder with countdown, agenda copy, and quick watch CTA.',
    build: () => [
      { id: id('h'), kind: 'heading', text: 'Reminder: webinar starts tomorrow', level: 2, align: 'left' },
      { id: id('t'), kind: 'text', markdown: 'You\'re on the list for tomorrow\'s session. We\'ll cover the workflow, show the live build, and leave time for Q&A at the end.' },
      { id: id('co'), kind: 'countdown', target_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), fallback_label: 'Starts soon', align: 'left' },
      { id: id('vt'), kind: 'video_thumb', thumbnail_url: '', title: 'Save your seat and watch live', caption: 'Drop in a thumbnail or leave it blank until production has the image.', target_url: 'https://example.com' },
      { id: id('b'), kind: 'button', label: 'Join the webinar', url: 'https://example.com', align: 'left' },
    ],
  },
  {
    slug: 'nurture-follow-up',
    name: 'Nurture follow-up',
    description: 'Warm follow-up with dynamic copy and a low-friction reply CTA.',
    build: () => [
      { id: id('h'), kind: 'heading', text: 'Quick follow-up', level: 2, align: 'left' },
      {
        id: id('dt'),
        kind: 'dynamic_text',
        default_markdown: 'Wanted to circle back and see if this is still on your radar.',
        variants: [
          { id: id('dv'), mode: 'segment', value: 'Customer', markdown: 'Wanted to follow up now that you\'ve had time to use it. Curious what is landing and what still feels rough.' },
          { id: id('rv'), mode: 'region', value: 'California', markdown: 'Wanted to follow up before the California rollout window closes this week.' },
        ],
      },
      {
        id: id('cs'),
        kind: 'conditional_section',
        rule: { field: 'tag', operator: 'is', value: 'vip' },
        blocks: [
          { id: id('t'), kind: 'text', markdown: 'Because you\'re on the VIP list, you can reply directly and we\'ll route this to the owner first.' },
        ],
      },
      { id: id('b'), kind: 'button', label: 'Reply or book time', url: 'https://example.com', align: 'left' },
    ],
  },
]

export function getEmailBlockTemplate(slug: string): EmailBlockTemplate | null {
  return EMAIL_BLOCK_TEMPLATES.find((template) => template.slug === slug) || null
}
