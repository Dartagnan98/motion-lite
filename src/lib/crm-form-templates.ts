// Curated form templates — a form's equivalent of the workflow-template
// library. Each template ships fields + a success message + an opinionated
// default success URL. Users clone with one click from /crm/forms and edit
// everything after.
//
// Templates can also carry multi-page layouts (pages) and conditional
// branching rules — the form builder will materialise them into pages_json +
// branching_rules_json on instantiate.

import type { CrmFormField, CrmFormPage, CrmFormBranchingRule } from './db'

export type FormTemplateCategory = 'lead_capture' | 'booking_flow' | 'post_purchase' | 'support' | 'survey' | 'event'

export interface FormTemplate {
  id: string
  name: string
  description: string
  blurb: string
  category: FormTemplateCategory
  success_message: string
  fields: CrmFormField[]
  pages?: CrmFormPage[]
  branching_rules?: CrmFormBranchingRule[]
}

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'contact_us',
    name: 'Contact us',
    description: 'Plain contact form — name, email, what they need.',
    blurb: 'The classic 3-field inbound lead form.',
    category: 'lead_capture',
    success_message: "Thanks — we'll reply within one business day.",
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'email',      label: 'Email',      type: 'email', required: true, maps_to: 'email' },
      { key: 'message',    label: 'What can we help with?', type: 'textarea', required: true },
    ],
  },
  {
    id: 'quote_request',
    name: 'Quote request',
    description: 'Full contact + project scope for service quotes.',
    blurb: 'Captures enough for you to send a real quote.',
    category: 'lead_capture',
    success_message: "Got it. You'll hear from us with a quote within 48 hours.",
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'last_name',  label: 'Last name',  type: 'text', required: false, maps_to: 'last_name' },
      { key: 'email',      label: 'Email',      type: 'email', required: true, maps_to: 'email' },
      { key: 'phone',      label: 'Phone',      type: 'phone', required: true, maps_to: 'phone' },
      { key: 'company',    label: 'Company',    type: 'text', required: false, maps_to: 'company' },
      { key: 'project_scope', label: 'What are you looking to get done?', type: 'textarea', required: true },
      {
        key: 'budget', label: 'Rough budget', type: 'select', required: false,
        options: ['Under $5k', '$5k–$15k', '$15k–$50k', '$50k+', 'Not sure yet'],
      },
    ],
  },
  {
    id: 'booking_inquiry',
    name: 'Booking inquiry',
    description: 'Lightweight intake before a booking page call.',
    blurb: 'Pair with a booking page for intake-then-schedule flows.',
    category: 'booking_flow',
    success_message: "Thanks! We'll text you a booking link shortly.",
    fields: [
      { key: 'first_name',     label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'email',          label: 'Email', type: 'email', required: true, maps_to: 'email' },
      { key: 'phone',          label: 'Phone', type: 'phone', required: true, maps_to: 'phone' },
      { key: 'service',        label: 'Which service?', type: 'select', required: true, options: ['Initial consultation', 'Follow-up', 'Other'] },
      { key: 'preferred_time', label: 'Preferred day / time',  type: 'text', required: false, placeholder: 'Tue afternoons, anytime Saturday…' },
    ],
  },
  {
    id: 'newsletter_signup',
    name: 'Newsletter signup',
    description: 'Email + name. Honours DND on the contact record.',
    blurb: 'Lowest-friction opt-in.',
    category: 'lead_capture',
    success_message: "Welcome — check your inbox for the first email.",
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'email',      label: 'Email',      type: 'email', required: true, maps_to: 'email' },
    ],
  },
  {
    id: 'post_purchase_feedback',
    name: 'Post-purchase feedback',
    description: 'Short survey after a visit or transaction.',
    blurb: 'Pairs well with a review request workflow afterwards.',
    category: 'post_purchase',
    success_message: "Thanks — your feedback goes straight to the team.",
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: false, maps_to: 'first_name' },
      { key: 'email',      label: 'Email',      type: 'email', required: true, maps_to: 'email' },
      {
        key: 'rating', label: 'How was it?', type: 'select', required: true,
        options: ['5 — perfect', '4 — great', '3 — fine', '2 — could be better', '1 — not great'],
      },
      { key: 'comment', label: 'Tell us more', type: 'textarea', required: false },
    ],
  },
  {
    id: 'consultation_request',
    name: 'Consultation request',
    description: 'Name, email, phone, and a free-text "what do you need help with?" box.',
    blurb: 'High-intent inbound consultation ask.',
    category: 'lead_capture',
    success_message: "Thanks — we'll reach out shortly to schedule your consult.",
    fields: [
      { key: 'first_name', label: 'First name',      type: 'text',     required: true,  maps_to: 'first_name' },
      { key: 'email',      label: 'Email',           type: 'email',    required: true,  maps_to: 'email' },
      { key: 'phone',      label: 'Phone',           type: 'phone',    required: true,  maps_to: 'phone' },
      { key: 'need',       label: 'What do you need help with?', type: 'textarea', required: true },
    ],
  },
  {
    id: 'nps_survey',
    name: 'NPS survey',
    description: '0-10 rating, follow-up text, email.',
    blurb: 'Classic Net Promoter Score survey.',
    category: 'survey',
    success_message: 'Thanks for the feedback — it goes straight to the team.',
    fields: [
      {
        key: 'score', label: 'How likely are you to recommend us (0-10)?', type: 'select', required: true,
        options: ['0','1','2','3','4','5','6','7','8','9','10'],
      },
      { key: 'reason', label: 'What drove your score?', type: 'textarea', required: false },
      { key: 'email',  label: 'Email (optional)',       type: 'email',    required: false, maps_to: 'email' },
    ],
  },
  {
    id: 'onboarding_intake',
    name: 'Onboarding intake',
    description: 'Three-page flow — contact info, goals, scheduling.',
    blurb: 'Paged new-client intake.',
    category: 'booking_flow',
    success_message: "Got everything — we'll reach out to lock in the kickoff.",
    fields: [
      { key: 'first_name',     label: 'First name', type: 'text',    required: true,  maps_to: 'first_name' },
      { key: 'last_name',      label: 'Last name',  type: 'text',    required: false, maps_to: 'last_name' },
      { key: 'email',          label: 'Email',      type: 'email',   required: true,  maps_to: 'email' },
      { key: 'phone',          label: 'Phone',      type: 'phone',   required: false, maps_to: 'phone' },
      { key: 'primary_goal',   label: 'Primary goal over the next 90 days', type: 'textarea', required: true },
      { key: 'biggest_block',  label: "What's the biggest thing in the way?", type: 'textarea', required: false },
      { key: 'ideal_start',    label: 'Ideal start week', type: 'text', required: false, placeholder: 'Week of…' },
      { key: 'preferred_time', label: 'Best time of day for calls', type: 'select', required: false, options: ['Mornings','Afternoons','Evenings','Flexible'] },
    ],
    pages: [
      { id: 'p1', title: 'Contact info', field_ids: ['first_name','last_name','email','phone'] },
      { id: 'p2', title: 'Goals',        field_ids: ['primary_goal','biggest_block'] },
      { id: 'p3', title: 'Scheduling',   field_ids: ['ideal_start','preferred_time'] },
    ],
  },
  {
    id: 'lead_qualification',
    name: 'Lead qualification',
    description: 'Budget-first qualifier — under $1k politely ends the flow, over $1k continues.',
    blurb: 'Branching qualifier so only real buyers reach the end.',
    category: 'lead_capture',
    success_message: "Thanks — we'll be in touch within one business day.",
    fields: [
      { key: 'budget', label: 'Rough budget', type: 'select', required: true, options: ['Under $1k','$1k – $5k','$5k – $25k','$25k+'] },
      { key: 'timeline', label: 'When are you looking to start?', type: 'select', required: true, options: ['Immediately','Within 30 days','This quarter','Just exploring'] },
      { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' },
    ],
    pages: [
      { id: 'p1', title: 'Budget',    field_ids: ['budget'] },
      { id: 'p2', title: 'Timeline',  field_ids: ['timeline'] },
      { id: 'p3', title: 'Your info', field_ids: ['first_name','email'] },
    ],
    branching_rules: [
      {
        id: 'rule_low_budget',
        if: { field_id: 'budget', op: 'eq', value: 'Under $1k' },
        then: { skip_to_end: true, message: "Appreciate you filling this out — we focus on engagements $1k+. We'll keep your note on file." },
      },
    ],
  },
  {
    id: 'event_rsvp',
    name: 'Event RSVP',
    description: 'Name, email, yes/no attending, dietary notes.',
    blurb: 'Lightweight RSVP + dietary capture.',
    category: 'event',
    success_message: "You're on the list — see you there.",
    fields: [
      { key: 'first_name',  label: 'First name',     type: 'text',     required: true,  maps_to: 'first_name' },
      { key: 'email',       label: 'Email',          type: 'email',    required: true,  maps_to: 'email' },
      { key: 'attending',   label: 'Will you be there?', type: 'select', required: true, options: ['Yes','No','Maybe'] },
      { key: 'dietary',     label: 'Dietary notes (optional)', type: 'textarea', required: false, placeholder: 'Allergies, vegetarian, halal…' },
    ],
  },
  {
    id: 'support_ticket',
    name: 'Support ticket',
    description: 'Customer reporting a problem — priority, category, details.',
    blurb: 'Use with a workflow that auto-assigns + sends the ack email.',
    category: 'support',
    success_message: "We've got it. You'll hear from the team shortly.",
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
      { key: 'email',      label: 'Email',      type: 'email', required: true, maps_to: 'email' },
      {
        key: 'urgency', label: 'How urgent?', type: 'select', required: true,
        options: ['Blocking — need help now', 'Important — today-ish', 'Minor — whenever'],
      },
      { key: 'subject',     label: 'One-line summary', type: 'text', required: true },
      { key: 'description', label: 'What happened?',    type: 'textarea', required: true },
    ],
  },
]

export function getFormTemplate(id: string): FormTemplate | undefined {
  return FORM_TEMPLATES.find((t) => t.id === id)
}
