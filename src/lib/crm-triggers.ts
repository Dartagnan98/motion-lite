// GHL-parity trigger catalog.
// Every workflow trigger the CRM supports (or aspires to support) lives here.
// The UI renders from this; the runner dispatches from this; the DB CHECK
// constraint validates against this. One source of truth.

export type TriggerCategory =
  | 'contact'
  | 'appointment'
  | 'conversation'
  | 'ticket'
  | 'opportunity'
  | 'form'
  | 'payment'
  | 'affiliate'
  | 'social'
  | 'site'
  | 'contract'
  | 'integration'

export type TriggerFilterFieldType =
  | 'text'
  | 'select'
  | 'stage'
  | 'lifecycle'
  | 'opportunity_stage'
  | 'tag'
  | 'multi_text'
  | 'none'

export interface TriggerFilterField {
  key: string
  label: string
  type: TriggerFilterFieldType
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  helper?: string
}

export interface TriggerDefinition {
  id: string
  label: string
  description: string
  category: TriggerCategory
  /** Primary value field (e.g. tag name, stage id). If omitted, trigger has no
   *  top-level value and only uses filter fields. */
  primary?: TriggerFilterField
  /** Extra filter fields beyond the primary value. */
  filters?: TriggerFilterField[]
  /** If set, the trigger depends on an external integration not yet wired in.
   *  The UI will show a warning so users know firing requires that hookup. */
  requiresIntegration?: 'calendar' | 'email_tracking' | 'telephony' | 'forms' | 'payments' | 'facebook'
  /** True if the runner already knows how to fire this trigger. */
  implemented: boolean
}

export const TRIGGER_CATEGORIES: Record<TriggerCategory, { label: string; description: string }> = {
  contact:      { label: 'Contact',      description: 'Fires when a contact changes.' },
  appointment:  { label: 'Appointment',  description: 'Calendar and booking events.' },
  conversation: { label: 'Conversation', description: 'Inbound messages, emails, SMS, calls.' },
  ticket:       { label: 'Ticket',       description: 'Help-desk creation, assignment, status, and SLA events.' },
  opportunity:  { label: 'Opportunity',  description: 'Pipeline movement, deal status.' },
  form:         { label: 'Form',         description: 'Form, survey, and funnel submissions.' },
  payment:      { label: 'Payment',      description: 'Invoices, orders, subscriptions.' },
  affiliate:    { label: 'Affiliate',    description: 'Affiliate signups, conversions, and payouts.' },
  social:       { label: 'Social',       description: 'Facebook, Instagram, messenger events.' },
  site:         { label: 'Site',         description: 'Website content, pages, and publishing events.' },
  contract:     { label: 'Contract',     description: 'E-signature document lifecycle events.' },
  integration:  { label: 'Integration',  description: 'Inbound webhooks and external systems.' },
}

const APPOINTMENT_STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'showed',    label: 'Showed' },
  { value: 'no_show',   label: 'No show' },
  { value: 'rescheduled', label: 'Rescheduled' },
]

const OPPORTUNITY_STATUS_OPTIONS = [
  { value: 'open',       label: 'Open' },
  { value: 'won',        label: 'Won' },
  { value: 'lost',       label: 'Lost' },
  { value: 'abandoned',  label: 'Abandoned' },
]

const EMAIL_EVENT_OPTIONS = [
  { value: 'opened',      label: 'Opened' },
  { value: 'clicked',     label: 'Clicked' },
  { value: 'replied',     label: 'Replied' },
  { value: 'bounced',     label: 'Bounced' },
  { value: 'unsubscribed',label: 'Unsubscribed' },
  { value: 'complained',  label: 'Marked as spam' },
]

const CALL_STATUS_OPTIONS = [
  { value: 'answered',  label: 'Answered' },
  { value: 'missed',    label: 'Missed' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'busy',      label: 'Busy' },
  { value: 'no_answer', label: 'No answer' },
]

const DIRECTION_OPTIONS = [
  { value: 'inbound',  label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'any',      label: 'Any direction' },
]

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms',   label: 'SMS' },
  { value: 'call',  label: 'Call' },
  { value: 'any',   label: 'Any channel' },
]

export const TRIGGER_CATALOG: TriggerDefinition[] = [
  // ── Contact ────────────────────────────────────────────────────────────────
  {
    id: 'contact_created',
    label: 'Contact created',
    description: 'A new contact is added to the workspace.',
    category: 'contact',
    filters: [
      { key: 'source', label: 'Source contains', type: 'text', placeholder: 'website, facebook_lead, …' },
    ],
    implemented: true,
  },
  {
    id: 'contact_updated',
    label: 'Contact updated',
    description: 'Any field on a contact changes.',
    category: 'contact',
    filters: [
      { key: 'field', label: 'Specific field (optional)', type: 'text', placeholder: 'email, phone, company…' },
    ],
    implemented: true,
  },
  {
    id: 'tag_added',
    label: 'Tag added',
    description: 'A tag is applied to a contact.',
    category: 'contact',
    primary: { key: 'tag', label: 'Tag', type: 'tag', required: true, placeholder: 'vip_lead' },
    implemented: true,
  },
  {
    id: 'tag_removed',
    label: 'Tag removed',
    description: 'A tag is removed from a contact.',
    category: 'contact',
    primary: { key: 'tag', label: 'Tag', type: 'tag', required: true, placeholder: 'cold_lead' },
    implemented: true,
  },
  {
    id: 'lifecycle_stage_changed',
    label: 'Lifecycle stage changed',
    description: 'Contact moves from one lifecycle stage to another.',
    category: 'contact',
    primary: { key: 'to_stage', label: 'Moves to', type: 'lifecycle', required: true },
    filters: [
      { key: 'from_stage', label: 'From stage (optional)', type: 'lifecycle' },
    ],
    implemented: true,
  },
  {
    id: 'custom_field_changed',
    label: 'Custom field changed',
    description: 'A custom field on the contact is updated. Trigger value = the field key so the workflow can scope to one field.',
    category: 'contact',
    primary: { key: 'field_key', label: 'Field key', type: 'text', required: true, placeholder: 'preferred_location' },
    implemented: true,
  },
  {
    id: 'dnd_changed',
    label: 'Do-not-disturb toggled',
    description: 'Contact opts in or out of a communication channel.',
    category: 'contact',
    primary: {
      key: 'channel', label: 'Channel', type: 'select', required: true,
      options: [
        { value: 'email', label: 'Email' },
        { value: 'sms',   label: 'SMS' },
        { value: 'call',  label: 'Calls' },
        { value: 'all',   label: 'All channels' },
      ],
    },
    filters: [
      {
        key: 'direction', label: 'Went to', type: 'select',
        options: [
          { value: 'on',  label: 'DND on (opted out)' },
          { value: 'off', label: 'DND off (opted in)' },
        ],
      },
    ],
    implemented: true,
  },
  {
    id: 'birthday',
    label: 'Birthday',
    description: 'Runs every year on a contact’s birthday. Set days-before to fire early (e.g. 3 = three days ahead).',
    category: 'contact',
    primary: {
      key: 'days_before', label: 'Days before birthday', type: 'text',
      required: false, placeholder: '0',
      helper: 'Leave blank to fire on the birthday itself. Set to 3 to send a heads-up three days early.',
    },
    implemented: true,
  },
  {
    id: 'note_added',
    label: 'Note added',
    description: 'A human teammate adds a note to a contact. Auto-generated system notes (workflow runs, activity syncs) do not fire this.',
    category: 'contact',
    implemented: true,
  },
  {
    id: 'task_completed',
    label: 'Task completed',
    description: 'A task tied to the contact is marked done.',
    category: 'contact',
    primary: { key: 'task_type', label: 'Task type (optional)', type: 'text', required: false, placeholder: 'Any type' },
    implemented: true,
  },
  {
    id: 'contact_assigned',
    label: 'Contact assigned',
    description: 'A contact is assigned to a teammate (owner set or changed). Leave user id blank to fire on any assignment.',
    category: 'contact',
    primary: { key: 'user_id', label: 'Assigned to user id (blank = any)', type: 'text', required: false, placeholder: 'Any user' },
    implemented: true,
  },
  {
    id: 'contact_unassigned',
    label: 'Contact unassigned',
    description: 'A contact has its owner removed (owner set back to no one).',
    category: 'contact',
    implemented: true,
  },

  // ── Appointment ────────────────────────────────────────────────────────────
  {
    id: 'appointment_booked',
    label: 'Appointment booked',
    description: 'A contact books a slot on a calendar. Leave the primary field blank to fire on any calendar.',
    category: 'appointment',
    primary: { key: 'calendar_id', label: 'Calendar public id (blank = any)', type: 'text', required: false, placeholder: 'Any calendar' },
    implemented: true,
  },
  {
    id: 'appointment_status_changed',
    label: 'Appointment status changed',
    description: 'Status moves to confirmed, cancelled, showed, or no-show.',
    category: 'appointment',
    primary: { key: 'status', label: 'To status', type: 'select', required: true, options: APPOINTMENT_STATUS_OPTIONS },
    implemented: true,
  },
  {
    id: 'appointment_rescheduled',
    label: 'Appointment rescheduled',
    description: 'A booked appointment is moved to a different time. Leave calendar blank to fire on any.',
    category: 'appointment',
    primary: { key: 'calendar_id', label: 'Calendar id (blank = any)', type: 'text', required: false, placeholder: 'Any calendar' },
    implemented: true,
  },
  {
    id: 'appointment_cancelled',
    label: 'Appointment cancelled',
    description: 'A booked appointment is cancelled (by status change or the cancel workflow action). Leave calendar blank to fire on any.',
    category: 'appointment',
    primary: { key: 'calendar_id', label: 'Calendar id (blank = any)', type: 'text', required: false, placeholder: 'Any calendar' },
    implemented: true,
  },

  // ── Conversation ──────────────────────────────────────────────────────────
  {
    id: 'inbound_email',
    label: 'Inbound email',
    description: 'A contact sends you an email.',
    category: 'conversation',
    filters: [
      { key: 'subject_contains', label: 'Subject contains', type: 'text' },
    ],
    implemented: true,
  },
  {
    id: 'inbound_sms',
    label: 'Inbound SMS',
    description: 'A contact texts the workspace number.',
    category: 'conversation',
    filters: [
      { key: 'keyword', label: 'First word is', type: 'text', placeholder: 'BOOK, STOP, …' },
    ],
    implemented: true,
  },
  {
    id: 'keyword_matched',
    label: 'SMS keyword matched',
    description: 'An inbound SMS matches a configured keyword. Trigger value is the keyword (case-insensitive).',
    category: 'conversation',
    primary: { key: 'keyword', label: 'Keyword', type: 'text', required: true, placeholder: 'YES, BOOK, STOP…' },
    implemented: true,
  },
  {
    id: 'customer_replied',
    label: 'Customer replied',
    description: 'Any inbound message from a contact, regardless of channel.',
    category: 'conversation',
    filters: [
      { key: 'channel', label: 'On channel', type: 'select', options: CHANNEL_OPTIONS },
    ],
    implemented: true,
  },
  {
    id: 'email_event',
    label: 'Email event',
    description: 'An outbound email was opened, clicked, or replied to. Trigger value is the event name (opened / clicked / replied).',
    category: 'conversation',
    primary: { key: 'event', label: 'Event', type: 'select', required: true, options: EMAIL_EVENT_OPTIONS },
    implemented: true,
  },
  {
    id: 'call_received',
    label: 'Call received',
    description: 'Inbound call hit a tracking number. Trigger value = the source label so you can branch on campaign.',
    category: 'conversation',
    primary: { key: 'source_label', label: 'Source label (blank = any)', type: 'text', required: false, placeholder: 'Google Ads - Client A brand' },
    requiresIntegration: 'telephony',
    implemented: true,
  },
  {
    id: 'call_completed',
    label: 'Call completed',
    description: 'Inbound call ended. Trigger value = the source label. Use filters to branch on how it ended.',
    category: 'conversation',
    primary: { key: 'source_label', label: 'Source label (blank = any)', type: 'text', required: false, placeholder: 'Google Ads - Client A brand' },
    filters: [
      { key: 'status', label: 'Status', type: 'select', options: CALL_STATUS_OPTIONS },
    ],
    requiresIntegration: 'telephony',
    implemented: true,
  },
  {
    id: 'call_status_changed',
    label: 'Call status',
    description: 'Outcome of an inbound or outbound call.',
    category: 'conversation',
    primary: { key: 'status', label: 'Status', type: 'select', required: true, options: CALL_STATUS_OPTIONS },
    filters: [
      { key: 'direction', label: 'Direction', type: 'select', options: DIRECTION_OPTIONS },
    ],
    requiresIntegration: 'telephony',
    implemented: true,
  },
  {
    id: 'missed_call',
    label: 'Missed call',
    description: 'Inbound call the contact did not connect on.',
    category: 'conversation',
    requiresIntegration: 'telephony',
    implemented: true,
  },
  {
    id: 'ai_call_completed',
    label: 'AI voice call completed',
    description: 'An inbound call handled by the Vapi voice agent ended. Fires once the transcript and summary are in.',
    category: 'conversation',
    implemented: true,
  },
  {
    id: 'urgent_message',
    label: 'Urgent voicemail / message',
    description: 'The voice AI receptionist flagged a take-a-message interaction as urgent.',
    category: 'conversation',
    implemented: true,
  },
  {
    id: 'customer_requested_human',
    label: 'Customer requested a human',
    description: 'Conversation AI detected a handoff signal — the contact asked to speak with a person, or the model flagged the message as needing a human. Auto-reply stops for 24h on this contact.',
    category: 'conversation',
    implemented: true,
  },
  {
    id: 'whatsapp_message_received',
    label: 'WhatsApp message received',
    description: 'A contact sent you a WhatsApp message on the connected Business number. Fires alongside customer_replied (channel=whatsapp).',
    category: 'conversation',
    filters: [
      { key: 'body_contains', label: 'Body contains', type: 'text' },
    ],
    implemented: true,
  },
  {
    id: 'instagram_message_received',
    label: 'Instagram DM received',
    description: 'A contact sent you an Instagram DM on the connected IG Business account. Fires alongside customer_replied (channel=instagram).',
    category: 'conversation',
    filters: [
      { key: 'body_contains', label: 'Body contains', type: 'text' },
    ],
    implemented: true,
  },

  // ── Ticket ─────────────────────────────────────────────────────────────────
  {
    id: 'ticket_created',
    label: 'Ticket created',
    description: 'A new help-desk ticket is opened for the contact.',
    category: 'ticket',
    implemented: true,
  },
  {
    id: 'ticket_assigned',
    label: 'Ticket assigned',
    description: 'A ticket is assigned to a specific teammate. Trigger value = user id.',
    category: 'ticket',
    primary: { key: 'user_id', label: 'Assignee user id', type: 'text', required: true, placeholder: '42' },
    implemented: true,
  },
  {
    id: 'ticket_status_changed',
    label: 'Ticket status changed',
    description: 'A ticket moves to open, pending, on hold, solved, or closed.',
    category: 'ticket',
    primary: {
      key: 'status',
      label: 'To status',
      type: 'select',
      required: true,
      options: [
        { value: 'open', label: 'Open' },
        { value: 'pending', label: 'Pending' },
        { value: 'on_hold', label: 'On hold' },
        { value: 'solved', label: 'Solved' },
        { value: 'closed', label: 'Closed' },
      ],
    },
    implemented: true,
  },
  {
    id: 'ticket_sla_breached',
    label: 'Ticket SLA breached',
    description: 'The ticket passed its active SLA deadline without a first response or resolution.',
    category: 'ticket',
    implemented: true,
  },

  // ── Opportunity ───────────────────────────────────────────────────────────
  {
    id: 'opportunity_created',
    label: 'Opportunity created',
    description: 'A new opportunity is added to any pipeline.',
    category: 'opportunity',
    filters: [
      { key: 'pipeline', label: 'Pipeline (optional)', type: 'text' },
    ],
    implemented: true,
  },
  {
    id: 'pipeline_stage_changed',
    label: 'Pipeline stage changed',
    description: 'A contact moves between pipeline stages.',
    category: 'opportunity',
    primary: { key: 'to_stage', label: 'Moves to', type: 'stage', required: true },
    filters: [
      { key: 'from_stage', label: 'From stage (optional)', type: 'stage' },
    ],
    implemented: true,
  },
  {
    id: 'opportunity_stage_changed',
    label: 'Opportunity stage changed',
    description: 'A specific opportunity moves to a named stage.',
    category: 'opportunity',
    primary: { key: 'stage', label: 'Moves to stage', type: 'opportunity_stage', required: true },
    implemented: true,
  },
  {
    id: 'opportunity_status_changed',
    label: 'Opportunity status (won / lost / abandoned)',
    description: 'Status on the deal moves to a closed state.',
    category: 'opportunity',
    primary: { key: 'status', label: 'To status', type: 'select', required: true, options: OPPORTUNITY_STATUS_OPTIONS },
    implemented: true,
  },
  {
    id: 'opportunity_abandoned',
    label: 'Opportunity abandoned',
    description: 'A deal was marked abandoned (went stale or was actively abandoned).',
    category: 'opportunity',
    filters: [
      { key: 'pipeline', label: 'Pipeline (optional)', type: 'text' },
    ],
    implemented: true,
  },

  // ── Form / funnel ─────────────────────────────────────────────────────────
  {
    id: 'form_submitted',
    label: 'Form submitted',
    description: 'A contact submits one of your forms. Leave the primary field blank to fire on any form.',
    category: 'form',
    primary: { key: 'form_id', label: 'Form public id (blank = any)', type: 'text', required: false, placeholder: 'Any form = leave blank' },
    implemented: true,
  },
  {
    id: 'survey_submitted',
    label: 'Survey submitted (legacy alias)',
    description: 'Kept for backward compatibility. Prefer "Survey completed".',
    category: 'form',
    primary: { key: 'survey_id', label: 'Survey public id (blank = any)', type: 'text', required: false, placeholder: 'Any survey' },
    implemented: true,
  },
  {
    id: 'survey_started',
    label: 'Survey started',
    description: 'A contact opens a survey and answers at least one question. Trigger value = survey public id.',
    category: 'form',
    primary: { key: 'survey_id', label: 'Survey public id (blank = any)', type: 'text', required: false, placeholder: 'Any survey' },
    implemented: true,
  },
  {
    id: 'survey_completed',
    label: 'Survey completed',
    description: 'A contact finishes a survey. Trigger value = survey public id.',
    category: 'form',
    primary: { key: 'survey_id', label: 'Survey public id (blank = any)', type: 'text', required: false, placeholder: 'Any survey' },
    implemented: true,
  },
  {
    id: 'nps_detractor',
    label: 'NPS detractor (0-6)',
    description: 'A response comes back with an NPS score of 0-6. Trigger value = the NPS score.',
    category: 'form',
    implemented: true,
  },
  {
    id: 'nps_passive',
    label: 'NPS passive (7-8)',
    description: 'A response comes back with an NPS score of 7-8.',
    category: 'form',
    implemented: true,
  },
  {
    id: 'nps_promoter',
    label: 'NPS promoter (9-10)',
    description: 'A response comes back with an NPS score of 9-10.',
    category: 'form',
    implemented: true,
  },
  {
    id: 'csat_low',
    label: 'CSAT low',
    description: 'Customer satisfaction average lands in the bottom third (<= 60% of scale).',
    category: 'form',
    implemented: true,
  },

  // ── Payment ───────────────────────────────────────────────────────────────
  {
    id: 'invoice_created',
    label: 'Invoice created',
    description: 'A new invoice is issued (draft or sent).',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'invoice_sent',
    label: 'Invoice sent',
    description: 'An invoice is emailed to the contact with a public pay link.',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'invoice_viewed',
    label: 'Invoice viewed',
    description: 'The contact opens the public invoice page for the first time.',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'invoice_paid',
    label: 'Invoice paid',
    description: 'An invoice is fully paid.',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'invoice_overdue',
    label: 'Invoice overdue',
    description: 'An invoice passes its due date without being paid.',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'payment_received',
    label: 'Payment received',
    description: 'A one-off or recurring payment succeeds.',
    category: 'payment',
    filters: [
      { key: 'min_amount', label: 'Minimum amount (cents)', type: 'text', placeholder: '0' },
    ],
    implemented: true,
  },
  {
    id: 'payment_failed',
    label: 'Payment failed',
    description: 'A charge attempt fails.',
    category: 'payment',
    implemented: true,
  },
  {
    id: 'subscription_cancelled',
    label: 'Subscription cancelled',
    description: 'A recurring subscription is cancelled by the customer or system.',
    category: 'payment',
    implemented: true,
  },

  // ── Affiliate ─────────────────────────────────────────────────────────────
  {
    id: 'affiliate_joined',
    label: 'Affiliate joined',
    description: 'An affiliate record is created or approved for a contact-linked partner.',
    category: 'affiliate',
    implemented: true,
  },
  {
    id: 'affiliate_conversion',
    label: 'Affiliate conversion',
    description: 'A referred contact converts into revenue for the affiliate.',
    category: 'affiliate',
    implemented: true,
  },
  {
    id: 'affiliate_payout_paid',
    label: 'Affiliate payout paid',
    description: 'A payout batch is marked paid for an affiliate.',
    category: 'affiliate',
    implemented: true,
  },

  // ── Social ────────────────────────────────────────────────────────────────
  {
    id: 'facebook_lead_submitted',
    label: 'Facebook lead form',
    description: 'A lead submits one of your Facebook / Instagram lead forms. Trigger value = form name (or form id) so workflows can branch by form.',
    category: 'social',
    primary: { key: 'form_name', label: 'Form name or id (blank = any)', type: 'text', required: false, placeholder: 'Any form = leave blank' },
    implemented: true,
  },
  {
    id: 'google_lead_submitted',
    label: 'Google lead form',
    description: 'A lead submits one of your Google Ads Lead Form extensions. Trigger value = form id so workflows can branch by form.',
    category: 'social',
    primary: { key: 'form_id', label: 'Form id (blank = any)', type: 'text', required: false, placeholder: 'Any form = leave blank' },
    implemented: true,
  },

  // ── Contract ──────────────────────────────────────────────────────────────
  {
    id: 'contract_sent',
    label: 'Contract sent',
    description: 'A contract was sent to a contact for signature.',
    category: 'contract',
    implemented: true,
  },
  {
    id: 'contract_signed',
    label: 'Contract signed',
    description: 'The signer completed the contract.',
    category: 'contract',
    implemented: true,
  },
  {
    id: 'contract_declined',
    label: 'Contract declined',
    description: 'The signer declined the contract.',
    category: 'contract',
    implemented: true,
  },
  {
    id: 'contract_expired',
    label: 'Contract expired',
    description: 'The contract passed its expiry date before it was signed.',
    category: 'contract',
    implemented: true,
  },

  // ── Integration ───────────────────────────────────────────────────────────
  {
    id: 'site_visit',
    label: 'Site visit (pixel)',
    description: 'A bound contact viewed a page tracked by the Ctrl pixel. Trigger value is a URL or URL prefix to match (blank = any page).',
    category: 'integration',
    primary: { key: 'url', label: 'URL or prefix (blank = any)', type: 'text', required: false, placeholder: 'https://example.com/pricing' },
    implemented: true,
  },
  {
    id: 'paid_conversion',
    label: 'Paid conversion',
    description: 'A tracked conversion came from a paid UTM medium. Leave medium blank to fire on any paid medium.',
    category: 'integration',
    primary: {
      key: 'medium',
      label: 'UTM medium (blank = any paid)',
      type: 'select',
      required: false,
      options: [
        { value: 'cpc', label: 'CPC' },
        { value: 'paid_social', label: 'Paid social' },
        { value: 'paid_search', label: 'Paid search' },
      ],
    },
    implemented: true,
  },
  {
    id: 'webhook_received',
    label: 'Inbound webhook',
    description: 'External system POSTs to this workflow’s webhook URL.',
    category: 'integration',
    filters: [
      { key: 'contact_id_path', label: 'Contact ID JSON path', type: 'text', placeholder: 'contact.id', helper: 'Dot path in the payload to the contact id. Leave blank to use the top-level contact_id field.' },
    ],
    implemented: true,
  },
  {
    id: 'help_article_published',
    label: 'Help article published',
    description: 'An article in the knowledge base goes live. Trigger value = article slug (blank = any article).',
    category: 'integration',
    primary: { key: 'article_slug', label: 'Article slug (blank = any)', type: 'text', required: false, placeholder: 'getting-started' },
    implemented: true,
  },
  {
    id: 'help_search_no_result',
    label: 'Help search with no result',
    description: 'A visitor searches the help center and gets zero results. Trigger value carries the exact query string so workflows can branch on it.',
    category: 'integration',
    primary: { key: 'query', label: 'Exact query (blank = any)', type: 'text', required: false, placeholder: 'refund policy' },
    implemented: true,
  },
  {
    id: 'help_article_unhelpful',
    label: 'Help article marked unhelpful',
    description: 'A visitor records a thumbs-down on a help article. Trigger value = article slug (blank = any article).',
    category: 'integration',
    primary: { key: 'article_slug', label: 'Article slug (blank = any)', type: 'text', required: false, placeholder: 'billing-faq' },
    implemented: true,
  },
]

export const TRIGGER_IDS = TRIGGER_CATALOG.map((t) => t.id)

export function getTrigger(id: string): TriggerDefinition | undefined {
  return TRIGGER_CATALOG.find((t) => t.id === id)
}

export function groupedTriggers(): Array<{ category: TriggerCategory; label: string; description: string; triggers: TriggerDefinition[] }> {
  const buckets: Record<TriggerCategory, TriggerDefinition[]> = {
    contact: [], appointment: [], conversation: [], ticket: [], opportunity: [],
    form: [], payment: [], affiliate: [], social: [], site: [], contract: [], integration: [],
  }
  for (const trigger of TRIGGER_CATALOG) buckets[trigger.category].push(trigger)
  return (Object.keys(buckets) as TriggerCategory[])
    .filter((category) => buckets[category].length > 0)
    .map((category) => ({
      category,
      label: TRIGGER_CATEGORIES[category].label,
      description: TRIGGER_CATEGORIES[category].description,
      triggers: buckets[category],
    }))
}
