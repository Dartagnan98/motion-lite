// Curated workflow templates — the equivalent of GHL's template library.
// Every template here uses triggers from crm-triggers.ts and actions from
// crm-actions.ts. Keep the library tight: two to three high-quality
// templates per funnel stage, all production-ready on clone.

import type { CrmWorkflowGraph } from './db'

export type WorkflowTemplateCategory =
  | 'lead_capture'
  | 'qualification'
  | 'appointment'
  | 'nurture'
  | 'sales'
  | 'retention'
  | 'call_handling'
  | 'reengagement'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  /** Short plain-language explanation of what it does in a sentence. */
  blurb: string
  category: WorkflowTemplateCategory
  trigger_type: string
  trigger_value: string
  graph: CrmWorkflowGraph
}

type Branch = 'default' | 'true' | 'false' | 'a' | 'b'

function n(id: string, type: string, config: Record<string, unknown> = {}): CrmWorkflowGraph['nodes'][number] {
  return { id, type, config }
}

function edge(source: string, target: string, branch: Branch = 'default'): CrmWorkflowGraph['edges'][number] {
  return {
    id: `${source}->${target}${branch === 'default' ? '' : `:${branch}`}`,
    source,
    target,
    branch,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ─── Lead capture ───────────────────────────────────────────────────────
  {
    id: 'lead_capture_form_welcome',
    name: 'New form lead — welcome + route',
    description: 'Greets a brand new form lead with an email, follows with SMS if we have a phone number, assigns them an owner, and tags them for reporting.',
    blurb: 'Email, SMS if phone, assign owner, tag new-lead.',
    category: 'lead_capture',
    trigger_type: 'form_submitted',
    trigger_value: '',
    graph: {
      nodes: [
        n('welcome_email', 'send_email', {
          subject: 'Thanks for reaching out, {{contact.first_name}}',
          body_html: '<p>Hey {{contact.first_name}},</p><p>Thanks for getting in touch. We reply within 1 business hour during the day and first thing in the morning if it lands overnight.</p><p>While you wait — anything specific we should know before the call?</p>',
        }),
        n('has_phone', 'condition', {
          field: 'phone',
          operator: 'is_not_empty',
          value: '',
        }),
        n('welcome_sms', 'send_sms', {
          message: 'Hey {{contact.first_name}} — just saw your form. What’s the best time to call you today?',
        }),
        n('assign_owner', 'assign_contact', { user_id: '' }),
        n('tag_new_lead', 'add_tag', { value: 'new-lead' }),
      ],
      edges: [
        edge('welcome_email', 'has_phone'),
        edge('has_phone', 'welcome_sms', 'true'),
        edge('has_phone', 'assign_owner', 'false'),
        edge('welcome_sms', 'assign_owner'),
        edge('assign_owner', 'tag_new_lead'),
      ],
    },
  },
  {
    id: 'lead_capture_pricing_page_visit',
    name: 'Pricing-page visitor — instant SMS',
    description: 'Fires when a known contact views the pricing page. Waits 2 minutes so it feels considered, then sends a light-touch SMS asking what questions they have.',
    blurb: 'Pricing visit → wait 2m → SMS check-in.',
    category: 'lead_capture',
    trigger_type: 'site_visit',
    trigger_value: '/pricing',
    graph: {
      nodes: [
        n('wait_2m', 'wait', { amount: 2, unit: 'minutes' }),
        n('check_sms_dnd', 'condition', {
          field: 'sms_opted_out',
          operator: 'equals',
          value: 'false',
        }),
        n('nudge_sms', 'send_sms', {
          message: 'Hey {{contact.first_name}} — saw you checking out pricing. Happy to answer anything. What’s the main thing you’re trying to figure out?',
        }),
        n('tag_pricing', 'add_tag', { value: 'viewed-pricing' }),
        n('end', 'end_workflow', { reason: 'Contact is SMS-opted-out' }),
      ],
      edges: [
        edge('wait_2m', 'check_sms_dnd'),
        edge('check_sms_dnd', 'nudge_sms', 'true'),
        edge('check_sms_dnd', 'end', 'false'),
        edge('nudge_sms', 'tag_pricing'),
      ],
    },
  },
  {
    id: 'lead_capture_inbound_email_autoreply',
    name: 'Inbound email — auto-reply + notify',
    description: 'Sends an instant auto-reply with hours and expected response time, then pings the assigned teammate so they know a real human is waiting.',
    blurb: 'Auto-reply with hours, notify owner.',
    category: 'lead_capture',
    trigger_type: 'inbound_email',
    trigger_value: '',
    graph: {
      nodes: [
        n('autoreply', 'send_email', {
          subject: 'Got your email — we’ll reply shortly',
          body_html: '<p>Hey {{contact.first_name}},</p><p>Thanks for reaching out. We’re open Mon–Fri, 9am–6pm Pacific, and normally reply within 1 business hour during those times.</p><p>If this is urgent, text us and we’ll jump on it.</p>',
        }),
        n('tag_inbound', 'add_tag', { value: 'inbound-email' }),
        n('notify_owner', 'send_internal_notification', {
          user_id: '',
          channel: 'app',
          subject: 'New inbound email',
          message: '{{contact.name}} just emailed. Reply in the inbox.',
        }),
      ],
      edges: [
        edge('autoreply', 'tag_inbound'),
        edge('tag_inbound', 'notify_owner'),
      ],
    },
  },

  // ─── Qualification ──────────────────────────────────────────────────────
  {
    id: 'qualification_hot_lead_router',
    name: 'Hot lead router — source + stage',
    description: 'When a new-lead tag is added, check lifecycle and source: Google Ads prospects get assigned to a dedicated owner, added to the Hot leads list, and the team gets an internal note.',
    blurb: 'Prospect + Google Ads → assign, list, note.',
    category: 'qualification',
    trigger_type: 'tag_added',
    trigger_value: 'new-lead',
    graph: {
      nodes: [
        n('check_prospect', 'condition', {
          field: 'lifecycle_stage',
          operator: 'equals',
          value: 'prospect',
        }),
        n('check_source', 'condition', {
          field: 'source',
          operator: 'includes',
          value: 'Google Ads',
        }),
        n('assign_hot_owner', 'assign_contact', { user_id: '' }),
        n('add_hot_list', 'add_to_list', { list_id: '' }),
        n('note_hot', 'add_note', {
          body: 'Routed to Hot leads via qualification workflow — prospect + Google Ads source.',
        }),
        n('notify_team', 'send_internal_notification', {
          user_id: '',
          channel: 'app',
          message: 'Hot lead: {{contact.name}} — prospect from Google Ads. Action it now.',
        }),
        n('end_not_qualified', 'end_workflow', { reason: 'Not a Google Ads prospect' }),
      ],
      edges: [
        edge('check_prospect', 'check_source', 'true'),
        edge('check_prospect', 'end_not_qualified', 'false'),
        edge('check_source', 'assign_hot_owner', 'true'),
        edge('check_source', 'end_not_qualified', 'false'),
        edge('assign_hot_owner', 'add_hot_list'),
        edge('add_hot_list', 'note_hot'),
        edge('note_hot', 'notify_team'),
      ],
    },
  },
  {
    id: 'qualification_keyword_optin',
    name: 'Keyword opt-in — YES confirms',
    description: 'Double-opt-in pattern: the contact texts YES, we turn SMS DND off, send a confirmation, and tag them so other workflows can trust they opted in.',
    blurb: 'YES → opt-in, confirm SMS, tag opted-in.',
    category: 'qualification',
    trigger_type: 'keyword_matched',
    trigger_value: 'YES',
    graph: {
      nodes: [
        n('sms_optin', 'toggle_dnd', { channel: 'sms', state: 'off' }),
        n('confirm_sms', 'send_sms', {
          message: 'You’re in, {{contact.first_name}}. Reply STOP anytime to stop. Text BOOK and we’ll send you a booking link.',
        }),
        n('tag_opted_in', 'add_tag', { value: 'opted-in' }),
      ],
      edges: [
        edge('sms_optin', 'confirm_sms'),
        edge('confirm_sms', 'tag_opted_in'),
      ],
    },
  },
  {
    id: 'qualification_ab_nurture_split',
    name: 'Form lead A/B — long nurture vs booking link',
    description: 'New form lead gets split 50/50. Variant A sends a 3-email value nurture over a week. Variant B sends one email with a booking link — which flow books more calls?',
    blurb: 'Form lead → 50/50 split → nurture vs booking.',
    category: 'qualification',
    trigger_type: 'form_submitted',
    trigger_value: '',
    graph: {
      nodes: [
        n('split', 'ab_split', { weight_a: 50 }),
        // Variant A — 3-email nurture
        n('a_email_1', 'send_email', {
          subject: 'The 2-minute version',
          body_html: '<p>Hey {{contact.first_name}} — quick intro. Here’s what we do and who we do it for in under 2 minutes: [link].</p>',
        }),
        n('a_wait_1', 'wait', { amount: 2, unit: 'days' }),
        n('a_email_2', 'send_email', {
          subject: 'How clients use it',
          body_html: '<p>Three quick stories — the kind of outcomes people see after 30 days.</p>',
        }),
        n('a_wait_2', 'wait', { amount: 3, unit: 'days' }),
        n('a_email_3', 'send_email', {
          subject: 'Want to chat?',
          body_html: '<p>If this looks right, here’s a calendar. No pressure: [booking link].</p>',
        }),
        n('a_tag', 'add_tag', { value: 'nurture-variant-a' }),
        // Variant B — one email + booking link
        n('b_email', 'send_email', {
          subject: 'Want to hop on a quick call?',
          body_html: '<p>Hey {{contact.first_name}} — grab a time that works: [booking link]. 15 minutes, no pitch.</p>',
        }),
        n('b_tag', 'add_tag', { value: 'nurture-variant-b' }),
      ],
      edges: [
        edge('split', 'a_email_1', 'a'),
        edge('split', 'b_email', 'b'),
        edge('a_email_1', 'a_wait_1'),
        edge('a_wait_1', 'a_email_2'),
        edge('a_email_2', 'a_wait_2'),
        edge('a_wait_2', 'a_email_3'),
        edge('a_email_3', 'a_tag'),
        edge('b_email', 'b_tag'),
      ],
    },
  },

  // ─── Appointment booking ────────────────────────────────────────────────
  {
    id: 'appointment_booked_confirm',
    name: 'Booking confirmation + no-show check',
    description: 'Fires the moment an appointment books: SMS + email confirmation with add-to-calendar, a task for the owner, then checks 72 hours later whether they showed.',
    blurb: 'SMS + email confirm, then 72h no-show check.',
    category: 'appointment',
    trigger_type: 'appointment_booked',
    trigger_value: '',
    graph: {
      nodes: [
        n('sms_confirm', 'send_sms', {
          message: 'You’re booked, {{contact.first_name}} — {{appointment.time}}. Reply R to reschedule, C to cancel.',
        }),
        n('email_confirm', 'send_email', {
          subject: 'Booking confirmed — {{appointment.time}}',
          body_html: '<p>Hey {{contact.first_name}},</p><p>You’re booked for {{appointment.time}}. Add it to your calendar: {{appointment.ics_link}}</p><p>See you soon.</p>',
        }),
        n('task_prep', 'create_task', {
          title: 'Prep for {{contact.name}} — {{appointment.time}}',
          priority: 'medium',
          duration_minutes: 15,
        }),
        n('wait_72h', 'wait', { amount: 72, unit: 'hours' }),
        n('check_no_show', 'condition', {
          field: 'appointment_status',
          operator: 'equals',
          value: 'no_show',
        }),
        n('tag_no_show', 'add_tag', { value: 'no-show' }),
        n('end_ok', 'end_workflow', { reason: 'Appointment resolved' }),
      ],
      edges: [
        edge('sms_confirm', 'email_confirm'),
        edge('email_confirm', 'task_prep'),
        edge('task_prep', 'wait_72h'),
        edge('wait_72h', 'check_no_show'),
        edge('check_no_show', 'tag_no_show', 'true'),
        edge('check_no_show', 'end_ok', 'false'),
      ],
    },
  },
  {
    id: 'appointment_no_show_recovery',
    name: 'No-show recovery — rebook push',
    description: 'Apologetic SMS the same day, then two-step email sequence over the next 48 hours to pull them back onto the calendar.',
    blurb: 'Missed it? SMS + email pair to rebook.',
    category: 'appointment',
    trigger_type: 'appointment_status_changed',
    trigger_value: 'no_show',
    graph: {
      nodes: [
        n('tag_no_show', 'add_tag', { value: 'no-show' }),
        n('sms_miss', 'send_sms', {
          message: 'Hey {{contact.first_name}} — sorry we missed each other. Want to pick a new time? Reply YES and I’ll send slots.',
        }),
        n('wait_1d', 'wait', { amount: 1, unit: 'days' }),
        n('email_rebook', 'send_email', {
          subject: 'Let’s get you rebooked',
          body_html: '<p>Hey {{contact.first_name}},</p><p>No stress on missing the time — happens. Here’s my calendar if you want to grab another slot: [booking link].</p>',
        }),
        n('wait_2d', 'wait', { amount: 2, unit: 'days' }),
        n('task_owner', 'create_task', {
          title: 'Manually reach out to no-show {{contact.name}}',
          priority: 'medium',
        }),
      ],
      edges: [
        edge('tag_no_show', 'sms_miss'),
        edge('sms_miss', 'wait_1d'),
        edge('wait_1d', 'email_rebook'),
        edge('email_rebook', 'wait_2d'),
        edge('wait_2d', 'task_owner'),
      ],
    },
  },
  {
    id: 'appointment_demo_completed_followup',
    name: 'Demo completed — follow-up 24h',
    description: 'On a showed appointment, move the opportunity to "demo completed", wait a day, then drop a short follow-up email.',
    blurb: 'Showed → opp stage + 24h email.',
    category: 'appointment',
    trigger_type: 'appointment_status_changed',
    trigger_value: 'showed',
    graph: {
      nodes: [
        n('move_stage', 'update_opportunity_stage', {
          stage: 'demo_completed',
          create_if_missing: true,
          create_name: 'Demo with {{contact.name}}',
        }),
        n('wait_24h', 'wait', { amount: 24, unit: 'hours' }),
        n('followup_email', 'send_email', {
          subject: 'Thanks for the time, {{contact.first_name}}',
          body_html: '<p>Appreciated the chat yesterday. Short recap + next step:</p><ul><li>Recap: …</li><li>Next step: …</li></ul><p>Lmk how you want to move.</p>',
        }),
      ],
      edges: [
        edge('move_stage', 'wait_24h'),
        edge('wait_24h', 'followup_email'),
      ],
    },
  },

  // ─── Nurture ────────────────────────────────────────────────────────────
  {
    id: 'nurture_cold_lead_drip',
    name: 'Cold lead — 5-email drip',
    description: 'When a contact picks up the cold-lead tag, run a 14-day, 5-touch email drip with waits between each. Stays quiet if they unsubscribe.',
    blurb: 'cold-lead tag → 5 emails over 14 days.',
    category: 'nurture',
    trigger_type: 'tag_added',
    trigger_value: 'cold-lead',
    graph: {
      nodes: [
        n('e1', 'send_email', {
          subject: 'The thing most people miss',
          body_html: '<p>Hey {{contact.first_name}} — one quick idea to kick us off.</p>',
        }),
        n('w1', 'wait', { amount: 3, unit: 'days' }),
        n('e2', 'send_email', {
          subject: 'Case study: how a similar shop doubled',
          body_html: '<p>Short read — 4 minutes.</p>',
        }),
        n('w2', 'wait', { amount: 3, unit: 'days' }),
        n('e3', 'send_email', {
          subject: 'A framework you can steal',
          body_html: '<p>Free resource, no opt-in.</p>',
        }),
        n('w3', 'wait', { amount: 4, unit: 'days' }),
        n('e4', 'send_email', {
          subject: 'Where most people trip up',
          body_html: '<p>Common pitfall + the fix.</p>',
        }),
        n('w4', 'wait', { amount: 4, unit: 'days' }),
        n('e5', 'send_email', {
          subject: 'Still around?',
          body_html: '<p>Reply with a word if you want me to keep sending these. Otherwise I’ll ease off.</p>',
        }),
      ],
      edges: [
        edge('e1', 'w1'), edge('w1', 'e2'),
        edge('e2', 'w2'), edge('w2', 'e3'),
        edge('e3', 'w3'), edge('w3', 'e4'),
        edge('e4', 'w4'), edge('w4', 'e5'),
      ],
    },
  },
  {
    id: 'nurture_birthday',
    name: 'Birthday — email + SMS',
    description: 'On the contact’s birthday, send a warm email with a coupon and fall back to SMS if they have a phone number.',
    blurb: 'Happy birthday: email + SMS coupon.',
    category: 'nurture',
    trigger_type: 'birthday',
    trigger_value: '',
    graph: {
      nodes: [
        n('bday_email', 'send_email', {
          subject: 'Happy birthday, {{contact.first_name}}',
          body_html: '<p>Wishing you a good one. Treat’s on us — use code BDAY20 for 20% off this week.</p>',
        }),
        n('has_phone', 'condition', { field: 'phone', operator: 'is_not_empty', value: '' }),
        n('bday_sms', 'send_sms', {
          message: 'Happy birthday, {{contact.first_name}}! Code BDAY20 = 20% off, this week only.',
        }),
        n('tag_bday', 'add_tag', { value: 'birthday-sent' }),
      ],
      edges: [
        edge('bday_email', 'has_phone'),
        edge('has_phone', 'bday_sms', 'true'),
        edge('has_phone', 'tag_bday', 'false'),
        edge('bday_sms', 'tag_bday'),
      ],
    },
  },
  {
    id: 'nurture_winback_90d',
    name: 'Win-back — 90 days since purchase',
    description: 'Triggered by the last_purchase_days custom field crossing 90. Sends a soft check-in email, waits a week, follows up with a coupon if they haven’t replied.',
    blurb: '90d since purchase → check-in + coupon.',
    category: 'nurture',
    trigger_type: 'custom_field_changed',
    trigger_value: 'last_purchase_days',
    graph: {
      nodes: [
        n('check_90d', 'condition', {
          field: 'last_purchase_days',
          operator: 'greater_than',
          value: '89',
        }),
        n('checkin_email', 'send_email', {
          subject: 'Been a minute — all good?',
          body_html: '<p>Hey {{contact.first_name}} — noticed it’s been a while. Anything we can help with?</p>',
        }),
        n('wait_7d', 'wait', { amount: 7, unit: 'days' }),
        n('coupon_email', 'send_email', {
          subject: 'Here’s 15% off to come back',
          body_html: '<p>If the timing’s right, code WELCOMEBACK = 15% off anything this month.</p>',
        }),
        n('tag_winback', 'add_tag', { value: 'winback-sent' }),
        n('end_not_yet', 'end_workflow', { reason: 'Not at 90 days yet' }),
      ],
      edges: [
        edge('check_90d', 'checkin_email', 'true'),
        edge('check_90d', 'end_not_yet', 'false'),
        edge('checkin_email', 'wait_7d'),
        edge('wait_7d', 'coupon_email'),
        edge('coupon_email', 'tag_winback'),
      ],
    },
  },

  // ─── Pipeline / sales ───────────────────────────────────────────────────
  {
    id: 'sales_proposal_nudge',
    name: 'Proposal sent — 3-day nudge',
    description: 'When an opportunity moves to Proposal sent, wait 3 days. If still in the same stage, send a polite nudge email and create a call-back task for the owner.',
    blurb: '3 days stalled → nudge email + owner task.',
    category: 'sales',
    trigger_type: 'opportunity_stage_changed',
    trigger_value: 'proposal_sent',
    graph: {
      nodes: [
        n('wait_3d', 'wait', { amount: 3, unit: 'days' }),
        n('still_there', 'condition', {
          field: 'opportunity_stage',
          operator: 'equals',
          value: 'proposal_sent',
        }),
        n('nudge_email', 'send_email', {
          subject: 'Any questions on the proposal?',
          body_html: '<p>Hey {{contact.first_name}} — circling back. Anything unclear on the proposal? Happy to hop on a 10-minute call to walk through it.</p>',
        }),
        n('task_call', 'create_task', {
          title: 'Call {{contact.name}} re proposal',
          priority: 'high',
          duration_minutes: 15,
        }),
        n('end_done', 'end_workflow', { reason: 'Deal moved past proposal' }),
      ],
      edges: [
        edge('wait_3d', 'still_there'),
        edge('still_there', 'nudge_email', 'true'),
        edge('still_there', 'end_done', 'false'),
        edge('nudge_email', 'task_call'),
      ],
    },
  },
  {
    id: 'sales_won_onboarding',
    name: 'Opportunity won — onboard + review',
    description: 'Deal closes won: send a thank-you email, kick off onboarding, queue a review request 14 days out, and tag them as a customer.',
    blurb: 'Won → thanks, onboard, 14d review, tag customer.',
    category: 'sales',
    trigger_type: 'opportunity_status_changed',
    trigger_value: 'won',
    graph: {
      nodes: [
        n('thanks', 'send_email', {
          subject: 'Welcome aboard, {{contact.first_name}}',
          body_html: '<p>Stoked to be working together. Two things coming up next: onboarding link + the person you’ll be talking to.</p>',
        }),
        n('onboarding_email', 'send_email', {
          subject: 'Your onboarding kickoff',
          body_html: '<p>Here’s what happens in week one and what we need from you: [doc link].</p>',
        }),
        n('tag_customer', 'add_tag', { value: 'customer' }),
        n('wait_14d', 'wait', { amount: 14, unit: 'days' }),
        n('review_request', 'send_review_request', {
          channel: 'email',
          subject: 'Got 20 seconds? Quick favour',
          message: 'If we earned it, a review means the world: {{review_link}}',
        }),
      ],
      edges: [
        edge('thanks', 'onboarding_email'),
        edge('onboarding_email', 'tag_customer'),
        edge('tag_customer', 'wait_14d'),
        edge('wait_14d', 'review_request'),
      ],
    },
  },
  {
    id: 'sales_lost_winback',
    name: 'Opportunity lost — survey + 60d win-back',
    description: 'Deal closes lost: survey email to capture the reason, add to Lost leads list, wait 60 days, then kick off a win-back workflow.',
    blurb: 'Lost → reason survey, list, 60d win-back.',
    category: 'sales',
    trigger_type: 'opportunity_status_changed',
    trigger_value: 'lost',
    graph: {
      nodes: [
        n('tag_lost', 'add_tag', { value: 'lost-lead' }),
        n('survey_email', 'send_email', {
          subject: 'Mind sharing why?',
          body_html: '<p>Hey {{contact.first_name}} — quick 1-question survey. What pushed you the other way? It genuinely helps us get better.</p>',
        }),
        n('add_lost_list', 'add_to_list', { list_id: '' }),
        n('wait_60d', 'wait', { amount: 60, unit: 'days' }),
        n('winback_email', 'send_email', {
          subject: 'Things have changed since last time',
          body_html: '<p>Curious if timing is any better now. Happy to reopen the convo if it is.</p>',
        }),
      ],
      edges: [
        edge('tag_lost', 'survey_email'),
        edge('survey_email', 'add_lost_list'),
        edge('add_lost_list', 'wait_60d'),
        edge('wait_60d', 'winback_email'),
      ],
    },
  },

  // ─── Post-sale / retention ──────────────────────────────────────────────
  {
    id: 'retention_customer_onboarding_7d',
    name: 'Customer onboarding — 7 days',
    description: 'When a contact becomes a customer, run a week-long onboarding sequence: welcome, setup nudge, feature highlight, check-in.',
    blurb: 'Customer tag → 7-day onboarding sequence.',
    category: 'retention',
    trigger_type: 'tag_added',
    trigger_value: 'customer',
    graph: {
      nodes: [
        n('d0', 'send_email', {
          subject: 'Welcome in — here’s day one',
          body_html: '<p>Start here: 5-minute setup. Everything else builds on this.</p>',
        }),
        n('w1', 'wait', { amount: 2, unit: 'days' }),
        n('d2', 'send_email', {
          subject: 'The one feature most people miss',
          body_html: '<p>Short loom: [link].</p>',
        }),
        n('w2', 'wait', { amount: 2, unit: 'days' }),
        n('d4', 'send_email', {
          subject: 'A shortcut I wish I’d learned sooner',
          body_html: '<p>Takes 30 seconds and saves 10 minutes a day.</p>',
        }),
        n('w3', 'wait', { amount: 3, unit: 'days' }),
        n('d7', 'send_email', {
          subject: 'Week 1 check-in',
          body_html: '<p>Reply with a 1 if everything’s clicking, a 2 if you’re stuck somewhere. Either way I’ll follow up.</p>',
        }),
      ],
      edges: [
        edge('d0', 'w1'), edge('w1', 'd2'),
        edge('d2', 'w2'), edge('w2', 'd4'),
        edge('d4', 'w3'), edge('w3', 'd7'),
      ],
    },
  },
  {
    id: 'retention_review_triage',
    name: 'Review received — triage good vs bad',
    description: 'Fires on any inbound review. 4+ stars gets a public thank-you email. 3 or below pings the owner and creates a high-priority call task.',
    blurb: '4+ stars → thanks. 3 or below → owner alert.',
    category: 'retention',
    trigger_type: 'review_received',
    trigger_value: '',
    graph: {
      nodes: [
        n('check_rating', 'condition', {
          field: 'review_rating',
          operator: 'greater_than',
          value: '3',
        }),
        n('thanks_email', 'send_email', {
          subject: 'Thank you — this meant a lot',
          body_html: '<p>Seriously, appreciate the review. Means the world when someone takes the 30 seconds to do it.</p>',
        }),
        n('notify_owner', 'send_internal_notification', {
          user_id: '',
          channel: 'app',
          message: 'Low-rating review from {{contact.name}} — jump on this before it snowballs.',
        }),
        n('task_call', 'create_task', {
          title: 'Call {{contact.name}} — low rating',
          priority: 'critical',
        }),
      ],
      edges: [
        edge('check_rating', 'thanks_email', 'true'),
        edge('check_rating', 'notify_owner', 'false'),
        edge('notify_owner', 'task_call'),
      ],
    },
  },

  // ─── Inbound call handling ─────────────────────────────────────────────
  {
    id: 'call_handling_google_ads_inbound',
    name: 'Inbound call — Google Ads tracking',
    description: 'Call hits the Google Ads tracking number: create an opportunity tagged with the source and assign the on-call owner.',
    blurb: 'Google Ads call → opp + assign owner.',
    category: 'call_handling',
    trigger_type: 'call_received',
    trigger_value: 'Google Ads',
    graph: {
      nodes: [
        n('create_opp', 'create_opportunity', {
          name: 'Inbound call — Google Ads — {{contact.name}}',
          stage: 'new',
          status: 'open',
          notes: 'Created automatically from Google Ads tracking number.',
        }),
        n('assign_owner', 'assign_opportunity', { user_id: '' }),
        n('tag_call', 'add_tag', { value: 'inbound-call-google-ads' }),
      ],
      edges: [
        edge('create_opp', 'assign_owner'),
        edge('assign_owner', 'tag_call'),
      ],
    },
  },
  {
    id: 'call_handling_missed_call',
    name: 'Missed call — SMS booking link',
    description: 'Standard missed-call-text-back: the second a call goes missed, text the caller a booking link and queue a call-back task.',
    blurb: 'Missed → instant SMS + call-back task.',
    category: 'call_handling',
    trigger_type: 'missed_call',
    trigger_value: '',
    graph: {
      nodes: [
        n('sms_missed', 'send_sms', {
          message: 'Hey, sorry we missed you — this is the shop. Grab a time if you’d prefer: [booking link]. Or just text back what’s up.',
        }),
        n('task_callback', 'create_task', {
          title: 'Call back {{contact.name}} — missed call',
          priority: 'high',
          duration_minutes: 10,
        }),
        n('tag_missed', 'add_tag', { value: 'missed-call' }),
      ],
      edges: [
        edge('sms_missed', 'task_callback'),
        edge('task_callback', 'tag_missed'),
      ],
    },
  },
  {
    id: 'call_handling_ai_urgent',
    name: 'AI voice call — urgent escalation',
    description: 'When the voice AI receptionist flags a call as urgent, SMS the owner immediately and create a critical task so nothing slips.',
    blurb: 'AI urgent → owner SMS + critical task.',
    category: 'call_handling',
    trigger_type: 'urgent_message',
    trigger_value: '',
    graph: {
      nodes: [
        n('notify_owner', 'send_internal_notification', {
          user_id: '',
          channel: 'sms',
          message: 'URGENT: AI receptionist flagged {{contact.name}} — call them now.',
        }),
        n('task_urgent', 'create_task', {
          title: 'URGENT — call {{contact.name}} back',
          priority: 'critical',
        }),
        n('tag_urgent', 'add_tag', { value: 'urgent-callback' }),
      ],
      edges: [
        edge('notify_owner', 'task_urgent'),
        edge('task_urgent', 'tag_urgent'),
      ],
    },
  },

  // ─── Re-engagement ─────────────────────────────────────────────────────
  {
    id: 'reengagement_cold_30d',
    name: 'Cold lead — 30-day re-engagement',
    description: 'When someone picks up the cold-lead tag, wait 30 days and ping with a fresh angle. Tag them as re-engaged so other flows can react.',
    blurb: 'Cold tag → 30d wait → fresh email.',
    category: 'reengagement',
    trigger_type: 'tag_added',
    trigger_value: 'cold-lead',
    graph: {
      nodes: [
        n('wait_30d', 'wait', { amount: 30, unit: 'days' }),
        n('re_email', 'send_email', {
          subject: 'One more try, then I’ll stop',
          body_html: '<p>Hey {{contact.first_name}} — been a minute. New angle: [one-line hook]. Worth a 2-minute read?</p>',
        }),
        n('tag_reengage', 'add_tag', { value: 'reengagement-sent' }),
      ],
      edges: [
        edge('wait_30d', 're_email'),
        edge('re_email', 'tag_reengage'),
      ],
    },
  },
  {
    id: 'reengagement_unsubscribed_cleanup',
    name: 'Unsubscribed cleanup — manual template',
    description: 'Reference template showing how to handle a DND-on event. This flow is destructive (removes from lists), so clone it and wire the lists before activating.',
    blurb: 'Template: tag opted-out + remove from lists.',
    category: 'reengagement',
    trigger_type: 'dnd_changed',
    trigger_value: 'all',
    graph: {
      nodes: [
        n('tag_optout', 'add_tag', { value: 'opted-out' }),
        n('remove_list_1', 'remove_from_list', { list_id: '' }),
        n('remove_list_2', 'remove_from_list', { list_id: '' }),
        n('note_optout', 'add_note', {
          body: 'Contact opted out across all channels. Removed from active lists on {{now}}.',
        }),
      ],
      edges: [
        edge('tag_optout', 'remove_list_1'),
        edge('remove_list_1', 'remove_list_2'),
        edge('remove_list_2', 'note_optout'),
      ],
    },
  },
  {
    id: 'reengagement_old_sms_reply',
    name: 'Reply on old SMS thread — re-engage',
    description: 'Contact replies on any SMS thread: assign it to the owner, tag them re-engaged, and drop an internal note so the team notices.',
    blurb: 'SMS reply → assign, tag reengaged, note.',
    category: 'reengagement',
    trigger_type: 'customer_replied',
    trigger_value: 'sms',
    graph: {
      nodes: [
        n('assign_owner', 'assign_contact', { user_id: '' }),
        n('tag_reengaged', 'add_tag', { value: 'reengaged' }),
        n('note', 'add_note', {
          body: 'Contact replied on an existing SMS thread. Assigned to owner; follow up in the inbox.',
        }),
      ],
      edges: [
        edge('assign_owner', 'tag_reengaged'),
        edge('tag_reengaged', 'note'),
      ],
    },
  },
]

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id)
}

export const WORKFLOW_TEMPLATE_CATEGORIES: Array<{ id: WorkflowTemplateCategory; label: string; description: string }> = [
  { id: 'lead_capture',  label: 'Lead capture',   description: 'Instant response to new leads.' },
  { id: 'qualification', label: 'Qualification',  description: 'Triage, routing, opt-ins, A/B.' },
  { id: 'appointment',   label: 'Appointments',   description: 'Booking confirms, no-shows, demos.' },
  { id: 'nurture',       label: 'Nurture',        description: 'Drips, birthdays, win-backs.' },
  { id: 'sales',         label: 'Sales pipeline', description: 'Opportunity, proposal, won, lost.' },
  { id: 'retention',     label: 'Retention',      description: 'Onboarding, reviews, referrals.' },
  { id: 'call_handling', label: 'Inbound calls',  description: 'Tracking numbers, missed calls, AI.' },
  { id: 'reengagement',  label: 'Re-engagement',  description: 'Dormant contacts, replies, cleanup.' },
]
