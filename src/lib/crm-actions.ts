// GHL-parity action catalog.
// Single source of truth for every workflow step the CRM can take.
// The workflow UI renders its picker + settings panel from this.

export type ActionCategory =
  | 'communication'
  | 'contact'
  | 'ticket'
  | 'opportunity'
  | 'task'
  | 'pipeline'
  | 'flow'
  | 'calendar'
  | 'affiliate'
  | 'data'
  | 'contract'
  | 'external'

export type ActionFieldType =
  | 'text'
  | 'textarea'
  | 'rich_text'
  | 'number'
  | 'duration'           // amount + unit (min/hr/day)
  | 'select'
  | 'multi_select'
  | 'bool'
  | 'stage'              // pipeline stage dropdown
  | 'lifecycle'          // lifecycle stage dropdown
  | 'opportunity_stage'
  | 'tag'
  | 'list'               // CRM list picker
  | 'user'               // workspace user picker
  | 'workflow'           // another workflow picker
  | 'tracking_number'    // call tracking number picker (phone E.164)
  | 'field_ref'          // contact field reference
  | 'priority'
  | 'status'

export interface ActionField {
  key: string
  label: string
  type: ActionFieldType
  required?: boolean
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  helper?: string
  /** Show this field only when another field has a given value. */
  showWhen?: { key: string; equals: unknown }
}

export interface ActionDefinition {
  /** Must equal one of CrmWorkflowNode['type'] */
  id: string
  label: string
  description: string
  category: ActionCategory
  /** Fields rendered in the node settings panel (right rail). */
  fields: ActionField[]
  /** Which field to show as a one-line summary inside the spine node card.
   *  If omitted, a sensible fallback is picked from common keys. */
  summaryKey?: string
  /** True when the runner already handles this action end-to-end. */
  implemented: boolean
  requiresIntegration?: 'email' | 'sms' | 'telephony' | 'calendar' | 'payments' | 'facebook' | 'analytics'
}

export const ACTION_CATEGORIES: Record<ActionCategory, { label: string; description: string }> = {
  communication: { label: 'Communication', description: 'Email, SMS, calls, internal notifications.' },
  contact:       { label: 'Contact',       description: 'Tags, fields, notes, DND.' },
  ticket:        { label: 'Ticket',        description: 'Assign tickets, update status, and add help-desk tags.' },
  opportunity:   { label: 'Opportunity',   description: 'Create, update, assign, delete deals.' },
  task:          { label: 'Task',          description: 'Create, update, complete tasks.' },
  pipeline:      { label: 'Pipeline',      description: 'Move contacts between pipeline stages.' },
  flow:          { label: 'Flow control',  description: 'Wait, branch, end, chain workflows.' },
  calendar:      { label: 'Calendar',      description: 'Book, cancel, send booking links.' },
  affiliate:     { label: 'Affiliate',     description: 'Approve affiliates and settle payouts.' },
  data:          { label: 'Data',          description: 'Math on fields, update custom data.' },
  contract:      { label: 'Contract',      description: 'Generate and send e-signature contracts.' },
  external:      { label: 'External',      description: 'Webhooks, Facebook audiences, analytics.' },
}

const PRIORITY_OPTIONS = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const TASK_STATUS_OPTIONS = [
  { value: 'todo',        label: 'Todo' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'done',        label: 'Done' },
]

const OPP_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'won',  label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms',   label: 'SMS' },
  { value: 'call',  label: 'Calls' },
  { value: 'all',   label: 'All channels' },
]

export const ACTION_CATALOG: ActionDefinition[] = [
  // ── Communication ──────────────────────────────────────────────────────────
  {
    id: 'send_email',
    label: 'Send email',
    description: 'Send an email to the contact.',
    category: 'communication',
    implemented: true,
    summaryKey: 'subject',
    fields: [
      { key: 'to', label: 'To (leave blank = contact email)', type: 'text', placeholder: 'Contact email' },
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'body_html', label: 'Body', type: 'rich_text', required: true, placeholder: 'Write your email…' },
    ],
  },
  {
    id: 'ai_draft_email',
    label: 'AI draft email',
    description: 'Generate an email draft and save it into a CRM template.',
    category: 'communication',
    implemented: true,
    summaryKey: 'goal',
    fields: [
      { key: 'goal', label: 'Goal', type: 'textarea', required: true, placeholder: 'Follow up after the estimate call and ask for a reply by Friday.' },
      { key: 'offer', label: 'Offer or angle', type: 'text', placeholder: 'Free audit, quote reminder, next step' },
      { key: 'cta', label: 'CTA', type: 'text', placeholder: 'Reply to book a call' },
      { key: 'context_text', label: 'Extra context', type: 'textarea', placeholder: 'Anything the model should keep in mind' },
      { key: 'prompt_id', label: 'Prompt id', type: 'number', helper: 'Optional saved AI prompt id. Leave blank to use the default email prompt.' },
      { key: 'save_to_template_id', label: 'Save to template id', type: 'number', helper: 'Optional existing email template id to overwrite. Leave blank to create a fresh draft template.' },
    ],
  },
  {
    id: 'send_sms',
    label: 'Send SMS',
    description: 'Text the contact from your workspace number.',
    category: 'communication',
    implemented: true,
    summaryKey: 'message',
    requiresIntegration: 'sms',
    fields: [
      { key: 'to', label: 'To (leave blank = contact phone)', type: 'text' },
      { key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Hi {{contact.first_name}}, …' },
    ],
  },
  {
    id: 'send_internal_notification',
    label: 'Notify a teammate',
    description: 'Send an internal email or SMS to a user in the workspace.',
    category: 'communication',
    implemented: true,
    fields: [
      { key: 'user_id', label: 'Teammate', type: 'user', required: true },
      {
        key: 'channel', label: 'Channel', type: 'select', required: true,
        options: [
          { value: 'email', label: 'Email' },
          { value: 'sms',   label: 'SMS' },
          { value: 'app',   label: 'In-app notification' },
        ],
      },
      { key: 'subject', label: 'Subject (email only)', type: 'text', showWhen: { key: 'channel', equals: 'email' } },
      { key: 'message', label: 'Message', type: 'textarea', required: true },
    ],
  },
  {
    id: 'voicemail_drop',
    label: 'Drop a voicemail',
    description: 'Leave a pre-recorded voicemail on the contact’s phone.',
    category: 'communication',
    implemented: true,
    requiresIntegration: 'telephony',
    fields: [
      { key: 'recording_url', label: 'Recording URL', type: 'text', required: true, placeholder: 'https://…/voicemail.mp3' },
      { key: 'from_number', label: 'From number', type: 'tracking_number', required: true, helper: 'Pick one of your tracking numbers. Outbound voicemail drops dial from this.' },
    ],
  },
  {
    id: 'manual_call_task',
    label: 'Create manual call task',
    description: 'Queue a call-back task for a teammate with a script and due date.',
    category: 'communication',
    implemented: true,
    fields: [
      { key: 'user_id', label: 'Assign to', type: 'user', required: true },
      { key: 'script', label: 'Call script / notes', type: 'textarea', placeholder: 'Hey {{contact.first_name}}, following up on...' },
      { key: 'due_date', label: 'Due date', type: 'text', placeholder: 'YYYY-MM-DD' },
    ],
  },
  {
    id: 'send_survey',
    label: 'Send survey',
    description: 'Send an NPS, CSAT, CES, or custom survey link via SMS or email. Use {{survey_link}} to drop the unique per-contact URL.',
    category: 'communication',
    implemented: true,
    summaryKey: 'channel',
    fields: [
      { key: 'survey_id', label: 'Survey public id', type: 'text', required: true, placeholder: 'xxxxxxxxxxxx' },
      {
        key: 'channel', label: 'Channel', type: 'select', required: true,
        options: [
          { value: 'sms',   label: 'SMS' },
          { value: 'email', label: 'Email' },
        ],
      },
      { key: 'subject', label: 'Email subject (email only)', type: 'text', showWhen: { key: 'channel', equals: 'email' } },
      { key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Hey {{contact.first_name}} — two-minute survey: {{survey_link}}' },
    ],
  },
  {
    id: 'webhook',
    label: 'Send webhook',
    description: 'POST the contact payload to an external URL.',
    category: 'external',
    implemented: true,
    summaryKey: 'url',
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/hook' },
      {
        key: 'method', label: 'Method', type: 'select',
        options: [{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }, { value: 'PUT', label: 'PUT' }],
      },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization":"Bearer …"}' },
      { key: 'body', label: 'Body (JSON)', type: 'textarea' },
    ],
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  {
    id: 'add_tag',
    label: 'Add tag',
    description: 'Apply a tag to the contact.',
    category: 'contact',
    implemented: true,
    summaryKey: 'value',
    fields: [
      { key: 'value', label: 'Tag', type: 'tag', required: true, placeholder: 'vip_lead' },
    ],
  },
  {
    id: 'remove_tag',
    label: 'Remove tag',
    description: 'Remove a tag from the contact.',
    category: 'contact',
    implemented: true,
    summaryKey: 'value',
    fields: [
      { key: 'value', label: 'Tag', type: 'tag', required: true },
    ],
  },
  {
    id: 'add_to_list',
    label: 'Add to list',
    description: 'Add the contact to a named CRM list.',
    category: 'contact',
    implemented: true,
    summaryKey: 'list_id',
    fields: [
      { key: 'list_id', label: 'List', type: 'list', required: true },
    ],
  },
  {
    id: 'remove_from_list',
    label: 'Remove from list',
    description: 'Remove the contact from a CRM list.',
    category: 'contact',
    implemented: true,
    summaryKey: 'list_id',
    fields: [
      { key: 'list_id', label: 'List', type: 'list', required: true },
    ],
  },
  {
    id: 'set_lifecycle_stage',
    label: 'Set lifecycle stage',
    description: 'Move the contact to a new lifecycle stage.',
    category: 'contact',
    implemented: true,
    summaryKey: 'value',
    fields: [
      { key: 'value', label: 'Lifecycle stage', type: 'lifecycle', required: true },
    ],
  },
  {
    id: 'update_custom_field',
    label: 'Update custom field',
    description: 'Write a value to one of the contact’s custom fields.',
    category: 'contact',
    implemented: true,
    fields: [
      { key: 'field_key', label: 'Field key', type: 'text', required: true, placeholder: 'preferred_location' },
      { key: 'value', label: 'New value', type: 'text', required: true, placeholder: '{{contact.city}}' },
    ],
  },
  {
    id: 'update_contact_field',
    label: 'Update contact field',
    description: 'Update a standard field like name, email, phone, company.',
    category: 'contact',
    implemented: true,
    fields: [
      {
        key: 'field', label: 'Field', type: 'select', required: true,
        options: [
          { value: 'name',     label: 'Name' },
          { value: 'email',    label: 'Email' },
          { value: 'phone',    label: 'Phone' },
          { value: 'company',  label: 'Company' },
          { value: 'job_title',label: 'Job title' },
          { value: 'website',  label: 'Website' },
          { value: 'source',   label: 'Source' },
        ],
      },
      { key: 'value', label: 'New value', type: 'text', required: true },
    ],
  },
  {
    id: 'toggle_dnd',
    label: 'Toggle DND',
    description: 'Turn do-not-disturb on or off for a channel.',
    category: 'contact',
    implemented: true,
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', required: true, options: CHANNEL_OPTIONS },
      {
        key: 'state', label: 'State', type: 'select', required: true,
        options: [
          { value: 'on',  label: 'Turn DND on (stop sending)' },
          { value: 'off', label: 'Turn DND off (resume sending)' },
        ],
      },
    ],
  },
  {
    id: 'add_note',
    label: 'Add note',
    description: 'Append a note to the contact record.',
    category: 'contact',
    implemented: true,
    summaryKey: 'body',
    fields: [
      { key: 'body', label: 'Note body', type: 'textarea', required: true, placeholder: 'Entered workflow X on {{now}}' },
    ],
  },

  // ── Ticket ────────────────────────────────────────────────────────────────
  {
    id: 'assign_ticket',
    label: 'Assign ticket',
    description: 'Assign the most recent open ticket on this contact to a teammate.',
    category: 'ticket',
    implemented: true,
    fields: [
      { key: 'user_id', label: 'Assign to', type: 'user', required: true },
    ],
  },
  {
    id: 'set_ticket_status',
    label: 'Set ticket status',
    description: 'Update the most recent open ticket on this contact.',
    category: 'ticket',
    implemented: true,
    summaryKey: 'status',
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'status',
        required: true,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'pending', label: 'Pending' },
          { value: 'on_hold', label: 'On hold' },
          { value: 'solved', label: 'Solved' },
          { value: 'closed', label: 'Closed' },
        ],
      },
    ],
  },
  {
    id: 'add_ticket_tag',
    label: 'Add ticket tag',
    description: 'Apply a tag to the most recent open ticket on this contact.',
    category: 'ticket',
    implemented: true,
    summaryKey: 'tag',
    fields: [
      { key: 'tag', label: 'Tag', type: 'tag', required: true, placeholder: 'billing' },
    ],
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────
  {
    id: 'set_pipeline_stage',
    label: 'Set pipeline stage',
    description: 'Move the contact to a pipeline stage.',
    category: 'pipeline',
    implemented: true,
    summaryKey: 'value',
    fields: [
      { key: 'value', label: 'Pipeline stage', type: 'stage', required: true },
    ],
  },

  // ── Opportunity ───────────────────────────────────────────────────────────
  {
    id: 'create_opportunity',
    label: 'Create opportunity',
    description: 'Create a new deal linked to this contact.',
    category: 'opportunity',
    implemented: true,
    summaryKey: 'name',
    fields: [
      { key: 'name', label: 'Opportunity name', type: 'text', required: true, placeholder: 'Deal for {{contact.name}}' },
      { key: 'stage', label: 'Starting stage', type: 'opportunity_stage', required: true },
      { key: 'value_amount', label: 'Value', type: 'number', placeholder: '0.00' },
      { key: 'probability', label: 'Probability (%)', type: 'number', placeholder: '20' },
      { key: 'status', label: 'Status', type: 'select', options: OPP_STATUS_OPTIONS },
      { key: 'close_date', label: 'Close date', type: 'text', placeholder: 'YYYY-MM-DD' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    id: 'update_opportunity_stage',
    label: 'Update opportunity stage',
    description: 'Move an existing opportunity to a different stage or status.',
    category: 'opportunity',
    implemented: true,
    summaryKey: 'stage',
    fields: [
      { key: 'stage', label: 'Target stage', type: 'opportunity_stage', required: true },
      { key: 'status', label: 'Status', type: 'select', options: OPP_STATUS_OPTIONS },
      { key: 'create_if_missing', label: 'Create opportunity if none exists', type: 'bool' },
      { key: 'create_name', label: 'Fallback opportunity name', type: 'text', showWhen: { key: 'create_if_missing', equals: true } },
    ],
  },
  {
    id: 'assign_opportunity',
    label: 'Assign opportunity',
    description: 'Set the opportunity owner.',
    category: 'opportunity',
    implemented: true,
    fields: [
      { key: 'user_id', label: 'Assign to', type: 'user', required: true },
    ],
  },
  {
    id: 'assign_contact',
    label: 'Assign conversation to teammate',
    description: 'Set the contact owner. The inbox and Today view route threads by this owner.',
    category: 'contact',
    implemented: true,
    fields: [
      { key: 'user_id', label: 'Assign to', type: 'user', required: true },
    ],
  },
  {
    id: 'delete_opportunity',
    label: 'Delete opportunity',
    description: 'Remove the most recent open opportunity for this contact.',
    category: 'opportunity',
    implemented: true,
    fields: [],
  },
  {
    id: 'mark_opportunity_abandoned',
    label: 'Mark opportunity abandoned',
    description: 'Flip the contact\'s most recent open opportunity to abandoned with an optional reason.',
    category: 'opportunity',
    implemented: true,
    fields: [
      { key: 'reason', label: 'Abandon reason (optional)', type: 'textarea' },
    ],
  },
  {
    id: 'add_opportunity_tag',
    label: 'Add tag to opportunity',
    description: 'Tag the contact\'s most recent open opportunity.',
    category: 'opportunity',
    implemented: true,
    fields: [
      { key: 'tag', label: 'Tag', type: 'text', required: true },
    ],
  },
  {
    id: 'add_opportunity_note',
    label: 'Add note to opportunity',
    description: 'Append a note to the contact\'s most recent open opportunity\'s timeline.',
    category: 'opportunity',
    implemented: true,
    fields: [
      { key: 'body', label: 'Note body', type: 'textarea', required: true },
    ],
  },

  // ── Task ──────────────────────────────────────────────────────────────────
  {
    id: 'create_task',
    label: 'Create task',
    description: 'Add a task linked to the contact.',
    category: 'task',
    implemented: true,
    summaryKey: 'title',
    fields: [
      { key: 'title', label: 'Task title', type: 'text', required: true, placeholder: 'Follow up with {{contact.name}}' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'priority', label: 'Priority', type: 'priority', options: PRIORITY_OPTIONS },
      { key: 'status', label: 'Status', type: 'select', options: TASK_STATUS_OPTIONS },
      { key: 'due_date', label: 'Due date', type: 'text', placeholder: 'YYYY-MM-DD' },
      { key: 'duration_minutes', label: 'Duration (min)', type: 'number', placeholder: '30' },
      { key: 'assignee', label: 'Assignee', type: 'text' },
    ],
  },
  {
    id: 'update_task',
    label: 'Update task',
    description: 'Update fields on a linked task.',
    category: 'task',
    implemented: true,
    fields: [
      { key: 'match_title', label: 'Match task by title contains', type: 'text', placeholder: 'Leave blank = most recent open task' },
      { key: 'priority', label: 'New priority', type: 'priority', options: PRIORITY_OPTIONS },
      { key: 'due_date', label: 'New due date', type: 'text', placeholder: 'YYYY-MM-DD' },
      { key: 'status', label: 'New status', type: 'select', options: TASK_STATUS_OPTIONS },
    ],
  },
  {
    id: 'complete_task',
    label: 'Complete task',
    description: 'Mark a linked task as done.',
    category: 'task',
    implemented: true,
    fields: [
      { key: 'match_title', label: 'Match task by title contains', type: 'text', placeholder: 'Leave blank = most recent open task' },
    ],
  },

  // ── Flow control ──────────────────────────────────────────────────────────
  {
    id: 'wait',
    label: 'Wait',
    description: 'Pause the workflow for a duration.',
    category: 'flow',
    implemented: true,
    summaryKey: 'amount',
    fields: [
      { key: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '10' },
      {
        key: 'unit', label: 'Unit', type: 'select', required: true,
        options: [
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours',   label: 'Hours' },
          { value: 'days',    label: 'Days' },
        ],
      },
    ],
  },
  {
    id: 'condition',
    label: 'If / else',
    description: 'Branch the workflow based on a contact field.',
    category: 'flow',
    implemented: true,
    // Condition renders its own specialized panel (true/false targets) — fields
    // here cover the basic predicate; branch targets live in the spine UI.
    fields: [
      { key: 'field', label: 'Field', type: 'text', required: true, placeholder: 'tags, pipeline_stage_id, source…' },
      {
        key: 'operator', label: 'Operator', type: 'select', required: true,
        options: [
          { value: 'includes',      label: 'Includes / contains' },
          { value: 'not_includes',  label: 'Does not include' },
          { value: 'equals',        label: 'Equals' },
          { value: 'not_equals',    label: 'Does not equal' },
          { value: 'is_empty',      label: 'Is empty' },
          { value: 'is_not_empty',  label: 'Is not empty' },
          { value: 'greater_than',  label: 'Greater than' },
          { value: 'less_than',     label: 'Less than' },
        ],
      },
      { key: 'value', label: 'Value', type: 'text' },
    ],
  },
  {
    id: 'ab_split',
    label: 'A / B split',
    description: 'Randomly route each contact down branch A or branch B. Use for split-testing subject lines, timing, or entire sub-flows.',
    category: 'flow',
    implemented: true,
    fields: [
      {
        key: 'weight_a',
        label: 'Weight for branch A (0-100)',
        type: 'number',
        required: true,
        placeholder: '50',
      },
      // weight_b is derived as 100 - weight_a; no second field needed
    ],
  },
  {
    id: 'goal_event',
    label: 'Goal event',
    description: 'Skip ahead to this step as soon as a condition is met elsewhere.',
    category: 'flow',
    implemented: true,
    fields: [
      { key: 'name', label: 'Goal name', type: 'text', required: true, placeholder: 'Booked a consult' },
      { key: 'field', label: 'Field to watch', type: 'text', required: true, placeholder: 'tags' },
      { key: 'operator', label: 'Operator', type: 'select', required: true, options: [
        { value: 'includes', label: 'Includes' }, { value: 'equals', label: 'Equals' },
      ]},
      { key: 'value', label: 'Value', type: 'text', required: true },
    ],
  },
  {
    id: 'add_to_workflow',
    label: 'Add to another workflow',
    description: 'Enroll the contact in a separate workflow.',
    category: 'flow',
    implemented: true,
    fields: [
      { key: 'workflow_id', label: 'Workflow', type: 'workflow', required: true },
    ],
  },
  {
    id: 'enroll_in_drip',
    label: 'Enroll in drip sequence',
    description: 'Drop the contact into a time-delayed email/SMS drip.',
    category: 'flow',
    implemented: true,
    summaryKey: 'sequence_id',
    fields: [
      { key: 'sequence_id', label: 'Sequence ID', type: 'number', required: true, helper: 'Paste the drip sequence id from /crm/drip-sequences.' },
    ],
  },
  {
    id: 'remove_from_workflow',
    label: 'Remove from workflow',
    description: 'Stop the contact’s run in another workflow.',
    category: 'flow',
    implemented: true,
    fields: [
      { key: 'workflow_id', label: 'Workflow', type: 'workflow', required: true },
      { key: 'stop_all', label: 'Or stop all their active workflows', type: 'bool' },
    ],
  },
  {
    id: 'end_workflow',
    label: 'End workflow',
    description: 'Stop this workflow run for this contact.',
    category: 'flow',
    implemented: true,
    fields: [
      { key: 'reason', label: 'Reason (optional)', type: 'text' },
    ],
  },

  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    id: 'book_appointment',
    label: 'Book appointment',
    description: 'Auto-book the contact into the next available slot on the selected calendar. Honors the calendar\'s booking mode (single, round-robin, collective) and host busy state.',
    category: 'calendar',
    implemented: true,
    fields: [
      { key: 'calendar_id', label: 'Calendar ID or public slug', type: 'text', required: true, placeholder: 'e.g. 12 or "consult-call"' },
    ],
  },
  {
    id: 'cancel_appointment',
    label: 'Cancel appointment',
    description: "Cancel the contact's next upcoming booking. Optionally scoped to one calendar.",
    category: 'calendar',
    implemented: true,
    fields: [
      { key: 'calendar_id', label: 'Calendar (optional)', type: 'text', placeholder: 'Leave blank to match any calendar' },
      { key: 'reason', label: 'Reason', type: 'text', placeholder: 'No-show, weather, etc.' },
    ],
  },
  {
    id: 'send_calendar_link',
    label: 'Send booking link',
    description: 'Send the contact a link to book a time themselves.',
    category: 'calendar',
    implemented: true,
    fields: [
      { key: 'calendar_id', label: 'Calendar', type: 'text', required: true, placeholder: 'e.g. 3' },
      {
        key: 'channel', label: 'Send via', type: 'select', required: true,
        options: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }],
      },
      { key: 'subject', label: 'Email subject', type: 'text', placeholder: 'Book a time with us' },
      { key: 'message', label: 'Message', type: 'textarea', placeholder: 'Hey {{contact_first_name}}, book a time: {{booking_link}}' },
    ],
  },

  // ── Affiliate ─────────────────────────────────────────────────────────────
  {
    id: 'approve_affiliate',
    label: 'Approve affiliate',
    description: 'Set the affiliate tied to this contact to active and stamp approved_at.',
    category: 'affiliate',
    implemented: true,
    fields: [],
  },
  {
    id: 'pay_affiliate_payout',
    label: 'Mark affiliate payout paid',
    description: 'Mark a pending payout for this affiliate as paid.',
    category: 'affiliate',
    implemented: true,
    fields: [
      { key: 'external_ref', label: 'External reference', type: 'text', placeholder: 'PayPal txn id, bank ref, note…' },
    ],
  },

  // ── Data / math ──────────────────────────────────────────────────────────
  {
    id: 'math_on_field',
    label: 'Math on contact field',
    description: 'Increment, decrement, or set a numeric custom field.',
    category: 'data',
    implemented: true,
    fields: [
      { key: 'field_key', label: 'Field key', type: 'text', required: true, placeholder: 'lead_score' },
      {
        key: 'operator', label: 'Operator', type: 'select', required: true,
        options: [
          { value: 'add',      label: 'Add' },
          { value: 'subtract', label: 'Subtract' },
          { value: 'multiply', label: 'Multiply' },
          { value: 'set',      label: 'Set to' },
        ],
      },
      { key: 'value', label: 'Value', type: 'number', required: true },
    ],
  },

  // ── Contract ──────────────────────────────────────────────────────────────
  {
    id: 'send_contract',
    label: 'Send contract',
    description: 'Create a contract from a template and email it to a contact for signature.',
    category: 'contract',
    implemented: true,
    fields: [
      { key: 'template_id', label: 'Template', type: 'text', required: true, placeholder: 'Template id' },
      { key: 'contact_id', label: 'Contact id (optional)', type: 'text', placeholder: 'Uses workflow contact if blank' },
      { key: 'title', label: 'Contract title (optional)', type: 'text', placeholder: 'Uses template name if blank' },
      { key: 'expires_in_days', label: 'Expires in days (optional)', type: 'number', placeholder: '30' },
    ],
  },

  // ── External ──────────────────────────────────────────────────────────────
  {
    id: 'facebook_audience_add',
    label: 'Add to Facebook audience',
    description: 'Push the contact into a Facebook custom audience. Requires the contact to have an email or phone number and Meta to be connected.',
    category: 'external',
    implemented: true,
    requiresIntegration: 'facebook',
    fields: [
      { key: 'audience_id', label: 'Audience ID', type: 'text', required: true, placeholder: 'e.g. 23850000000123456' },
    ],
  },
  {
    id: 'facebook_audience_remove',
    label: 'Remove from Facebook audience',
    description: 'Remove the contact from a Facebook custom audience. Requires the contact to have an email or phone number and Meta to be connected.',
    category: 'external',
    implemented: true,
    requiresIntegration: 'facebook',
    fields: [
      { key: 'audience_id', label: 'Audience ID', type: 'text', required: true, placeholder: 'e.g. 23850000000123456' },
    ],
  },
  {
    id: 'google_analytics_event',
    label: 'Google Analytics event',
    description: 'Fire a GA4 event on behalf of this contact.',
    category: 'external',
    implemented: true,
    requiresIntegration: 'analytics',
    fields: [
      { key: 'event_name', label: 'Event name', type: 'text', required: true, placeholder: 'workflow_conversion' },
      { key: 'value', label: 'Value (optional)', type: 'number' },
    ],
  },
  {
    id: 'facebook_pixel_event',
    label: 'Facebook Pixel event',
    description: 'Fire a Facebook / Meta Pixel event.',
    category: 'external',
    implemented: true,
    requiresIntegration: 'facebook',
    fields: [
      { key: 'event_name', label: 'Event name', type: 'text', required: true, placeholder: 'Lead' },
      { key: 'value', label: 'Value (optional)', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'text', placeholder: 'USD' },
    ],
  },
  {
    id: 'send_invoice',
    label: 'Send invoice',
    description: 'Create and email an invoice to the contact. Pick a product or enter a custom amount.',
    category: 'communication',
    implemented: true,
    summaryKey: 'product_id',
    fields: [
      { key: 'product_id', label: 'Product (optional)', type: 'text', placeholder: 'Leave blank to use amount' },
      { key: 'amount_cents', label: 'Amount override (cents)', type: 'number', placeholder: '12500' },
      { key: 'description', label: 'Line description', type: 'text', placeholder: 'Consulting retainer' },
      { key: 'due_days', label: 'Days until due', type: 'number', placeholder: '14' },
      { key: 'send_immediately', label: 'Send immediately', type: 'select', options: [{ value: 'true', label: 'Yes — email now' }, { value: 'false', label: 'No — save as draft' }] },
    ],
  },
  {
    id: 'create_invoice_from_products',
    label: 'Create invoice from products',
    description: 'Generate a draft invoice from one or more catalog products for the current contact.',
    category: 'data',
    implemented: true,
    summaryKey: 'product_ids',
    fields: [
      { key: 'product_ids', label: 'Product ids (comma-separated)', type: 'text', required: true, placeholder: '12,14,18' },
      { key: 'due_days', label: 'Days until due', type: 'number', placeholder: '14' },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Optional invoice note' },
    ],
  },
  {
    id: 'mark_invoice_paid',
    label: 'Mark invoice paid',
    description: 'Record the outstanding balance as paid on an existing invoice.',
    category: 'data',
    implemented: true,
    summaryKey: 'invoice_id',
    fields: [
      { key: 'invoice_id', label: 'Invoice id', type: 'text', required: true, placeholder: '1042' },
      { key: 'method', label: 'Method', type: 'select', options: [{ value: 'card', label: 'Card' }, { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'bank', label: 'Bank transfer' }, { value: 'other', label: 'Other' }] },
      { key: 'external_ref', label: 'External reference', type: 'text', placeholder: 'pi_stub_123' },
    ],
  },
  {
    id: 'charge_contact',
    label: 'Charge contact',
    description: 'Attempt a charge on the contact via the connected payment provider. Requires Stripe or Square to be connected.',
    category: 'external',
    implemented: false,
    requiresIntegration: 'payments',
    fields: [
      { key: 'amount_cents', label: 'Amount (cents)', type: 'number', required: true, placeholder: '9900' },
      { key: 'product_id', label: 'Product (optional)', type: 'text' },
      { key: 'description', label: 'Statement descriptor', type: 'text', placeholder: 'CTRL Retainer' },
    ],
  },

]

export const ACTION_IDS = ACTION_CATALOG.map((a) => a.id)

export function getAction(id: string): ActionDefinition | undefined {
  return ACTION_CATALOG.find((a) => a.id === id)
}

export function groupedActions(): Array<{ category: ActionCategory; label: string; description: string; actions: ActionDefinition[] }> {
  const buckets = {} as Record<ActionCategory, ActionDefinition[]>
  for (const c of Object.keys(ACTION_CATEGORIES) as ActionCategory[]) buckets[c] = []
  for (const action of ACTION_CATALOG) buckets[action.category].push(action)
  return (Object.keys(ACTION_CATEGORIES) as ActionCategory[])
    .filter((category) => buckets[category].length > 0)
    .map((category) => ({
      category,
      label: ACTION_CATEGORIES[category].label,
      description: ACTION_CATEGORIES[category].description,
      actions: buckets[category],
    }))
}

/** Summarize an action's config into a one-line caption. */
export function summarizeAction(id: string, config: Record<string, unknown>): string {
  const def = getAction(id)
  if (!def) return id
  const key = def.summaryKey
  if (key) {
    const v = config[key]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  // Generic fallback.
  const firstFilled = def.fields.find((f) => {
    const v = config[f.key]
    return v !== undefined && v !== null && v !== ''
  })
  if (firstFilled) return String(config[firstFilled.key])
  return def.label
}

export function actionIntegrationLabel(kind: NonNullable<ActionDefinition['requiresIntegration']>): string {
  switch (kind) {
    case 'email':     return 'Email provider'
    case 'sms':       return 'Twilio / SMS'
    case 'telephony': return 'Telephony / Twilio'
    case 'calendar':  return 'Calendar'
    case 'payments':  return 'Payments / Stripe'
    case 'facebook':  return 'Facebook / Meta'
    case 'analytics': return 'Google Analytics'
  }
}
