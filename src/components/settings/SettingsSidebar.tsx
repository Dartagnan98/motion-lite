'use client'

const SECTION_GROUPS = [
  {
    label: 'General',
    items: [
      { id: 'workspace', label: 'Workspace', icon: 'M8 1L1 5.5l7 4.5 7-4.5L8 1zM1 8l7 4.5L15 8M1 10.5l7 4.5 7-4.5' },
      { id: 'profile', label: 'Profile', icon: 'M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5' },
      { id: 'team', label: 'Team', icon: 'M5 7a2 2 0 100-4 2 2 0 000 4zM11 7a2 2 0 100-4 2 2 0 000 4zM1 13c0-2 2-4 4-4s4 2 4 4M8 13c0-2 2-4 4-4s4 2 4 4' },
      { id: 'theme', label: 'Theme', icon: 'M8 2a6 6 0 100 12A6 6 0 008 2z' },
      { id: 'display', label: 'Display', icon: 'M2 4h12v8H2zM5 14h6M8 12v2' },
      { id: 'timezone', label: 'Timezone', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zM8 1v14M1 8h14' },
      { id: 'notifications', label: 'Notifications', icon: 'M4 11a4 4 0 018 0M8 2v2M12.5 4.5l-1 1M3.5 4.5l1 1M6 14h4' },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { id: 'calendars', label: 'Calendars', icon: 'M2 3h12v11H2zM2 7h12M5 1v4M11 1v4' },
      { id: 'auto-scheduling', label: 'Auto-scheduling', icon: 'M3 12l3 3 7-9' },
      { id: 'smart-scheduling', label: 'Smart Scheduling', icon: 'M8 2a6 6 0 100 12 6 6 0 000-12zM8 5v3l2 2' },
      { id: 'schedules', label: 'Schedules', icon: 'M3 3h10v10H3zM3 6h10M6 3v10' },
      { id: 'conference', label: 'Conference', icon: 'M2 4h12v8H2zM5 12v2M11 12v2M1 14h14' },
      { id: 'booking', label: 'Booking', icon: 'M2 3h12v11H2zM2 7h12M7 10h2' },
    ],
  },
  {
    label: 'Tasks',
    items: [
      { id: 'task-defaults', label: 'Task defaults', icon: 'M4 4h8M4 8h6M4 12h4' },
      { id: 'task-templates', label: 'Task templates', icon: 'M3 3h10v2H3zM3 7h7v2H3zM3 11h5v2H3zM12 8l2 2-2 2M11 12h3' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'meta-ads', label: 'Meta Ads', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zM5 5l6 6M11 5l-6 6' },
      { id: 'google-ads', label: 'Google Ads', icon: 'M2 8h4l2-6 2 12 2-6h4' },
      { id: 'email-ingest', label: 'Email Ingest', icon: 'M2 4l6 4 6-4M2 4v8l6 4 6-4V4' },
      { id: 'integrations', label: 'Integrations', icon: 'M6 3L3 8l3 5M10 3l3 5-3 5' },
      { id: 'api', label: 'API', icon: 'M2 8h4l2-4 2 8 2-4h4' },
    ],
  },
  {
    label: 'AI',
    items: [
      { id: 'ai', label: 'AI Dispatch', icon: 'M3 5l5-3 5 3M3 5v6l5 3 5-3V5M8 8v6' },
      { id: 'meeting-ai', label: 'Meeting AI', icon: 'M12 1a3 3 0 00-3 3v4a3 3 0 006 0V4a3 3 0 00-3-3zM7 8v1a5 5 0 0010 0V8M12 13v2' },
      { id: 'env-vault', label: 'Environment Keys', icon: 'M4 7V5a4 4 0 018 0v2M3 7h10v7H3z' },
      { id: 'ai-knowledge', label: 'AI Knowledge', icon: 'M8 2L2 6l6 4 6-4zM2 10l6 4 6-4' },
    ],
  },
  {
    label: 'Clients',
    items: [
      { id: 'client-portals', label: 'Client Portals', icon: 'M2 3h12v11H2zM9 3v11M2 8h7' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { id: 'crm-workspace', label: 'CRM Workspace', icon: 'M8 1L1 5.5l7 4.5 7-4.5L8 1zM1 8l7 4.5L15 8M1 10.5l7 4.5 7-4.5' },
      { id: 'crm-email', label: 'Email Accounts', icon: 'M2 4l6 4 6-4M2 4v8l6 4 6-4V4' },
      { id: 'crm-pipeline', label: 'Pipeline Stages', icon: 'M3 8h10M3 4h10M3 12h6' },
      { id: 'crm-fields', label: 'Custom Fields', icon: 'M4 4h8M4 8h6M4 12h4' },
      { id: 'crm-automations', label: 'Automations', icon: 'M3 12l3 3 7-9' },
      { id: 'crm-conversation-ai', label: 'Conversation AI', icon: 'M3 5l5-3 5 3M3 5v6l5 3 5-3V5M8 8v6' },
      { id: 'crm-voice-ai', label: 'Voice AI', icon: 'M12 1a3 3 0 00-3 3v4a3 3 0 006 0V4a3 3 0 00-3-3zM7 8v1a5 5 0 0010 0V8M12 13v2' },
      { id: 'crm-webchat', label: 'Webchat', icon: 'M2 4h12v8H2zM5 14h6' },
      { id: 'crm-phone', label: 'Phone', icon: 'M3 3h4l1 3-2 1c1 2 3 4 5 5l1-2 3 1v4h-3C7 14 2 9 2 3z' },
      { id: 'crm-sms-keywords', label: 'SMS Keywords', icon: 'M2 3h12v9H2zM5 6h8M5 9h5' },
      { id: 'crm-tracking-pixel', label: 'Tracking Pixel', icon: 'M8 2a6 6 0 100 12A6 6 0 008 2zM8 5v3l2 2' },
      { id: 'crm-lead-ads', label: 'Lead Ads', icon: 'M2 8h4l2-6 2 12 2-6h4' },
      { id: 'crm-workflow-integrations', label: 'Workflow Integrations', icon: 'M6 3L3 8l3 5M10 3l3 5-3 5' },
      { id: 'crm-sms', label: 'Twilio / SMS', icon: 'M2 3h12v9H2zM5 14h6M8 12v2' },
    ],
  },
]

// Flat list for external use
const SECTIONS = SECTION_GROUPS.flatMap(g => g.items)

export function SettingsSidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="w-[190px] shrink-0 border-r border-border overflow-y-auto py-2 px-2" style={{ background: 'var(--bg-chrome)' }}>
      {SECTION_GROUPS.map((group, gi) => (
        <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>
          <div className="settings-sidebar-group-label">
            {group.label}
          </div>
          {group.items.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`settings-sidebar-item flex items-center gap-2.5 w-full px-3 py-1.5 rounded-[4px] transition-all duration-150 ${
                active === s.id
                  ? 'active'
                  : 'hover:bg-hover hover:!text-text'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-70">
                <path d={s.icon} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {s.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

export { SECTIONS }
