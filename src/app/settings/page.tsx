'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { SettingsSidebar } from '@/components/settings/SettingsSidebar'
import { ScheduleEditor } from '@/components/settings/ScheduleEditor'
import { CrmEmailSection, CrmPipelineSection, CrmCustomFieldsSection, CrmSmsSection, CrmAutomationsSection, CrmWorkflowIntegrationsSection } from '@/components/settings/CrmSettingsSection'
import { CrmWorkspaceSection, CrmConversationAiSection, CrmTrackingPixelSection, CrmLeadAdsSection } from '@/components/settings/CrmWorkspaceSections'
import { CrmVoiceAiLinkSection, CrmWebchatLinkSection, CrmPhoneLinkSection, CrmSmsKeywordsLinkSection } from '@/components/settings/CrmFeatureLinkSections'
import { APP_COLORS } from '@/lib/colors'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { IconCheck, IconX, IconPlus, IconEdit, IconChevronDown } from '@/components/ui/Icons'
import { PRIORITY_LABELS } from '@/lib/task-constants'

interface GoogleAccount { id: number; email: string }
interface GoogleCalendar { id: string; account_id: number; name: string; color: string; visible: number; use_for_conflicts: number; is_primary: number; default_busy_status?: string }

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-text-dim text-sm">Loading...</div>}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  const searchParams = useSearchParams()
  const [section, setSection] = useState(searchParams.get('section') || 'calendars')
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings).catch(() => {})
    // Load Google accounts and calendars for the calendar section
    fetch('/api/google/accounts').then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => setAccounts([]))
    fetch('/api/google/calendars').then(r => r.json()).then(d => setCalendars(Array.isArray(d) ? d : [])).catch(() => setCalendars([]))
  }, [])

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    setSaving(true)
    setSaveError('')
    setSettings(prev => ({ ...prev, [key]: value }))
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      if (!res.ok) {
        setSaveError('Failed to save setting')
        setTimeout(() => setSaveError(''), 3000)
      }
    } catch {
      setSaveError('Network error -- setting not saved')
      setTimeout(() => setSaveError(''), 3000)
    }
    setSaving(false)
  }, [])

  return (
    <div className="flex h-full">
      <SettingsSidebar active={section} onSelect={setSection} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[640px]">
        <div className="flex items-center justify-between mb-6">
          <h1 className="settings-content-header capitalize">{section.replace(/-/g, ' ')}</h1>
          {saving && <span className="text-[13px] text-text-dim">Saving...</span>}
          {saveError && <span className="text-[13px] text-red">{saveError}</span>}
        </div>

        {section === 'workspace' && <WorkspaceSettingsSection />}
        {section === 'calendars' && (
          <CalendarsSection accounts={accounts} calendars={calendars} setAccounts={setAccounts} setCalendars={setCalendars} />
        )}
        {section === 'auto-scheduling' && (
          <AutoSchedulingSection settings={settings} update={updateSetting} onNavigate={setSection} />
        )}
        {section === 'smart-scheduling' && (
          <SmartSchedulingSection settings={settings} update={updateSetting} />
        )}
        {section === 'task-defaults' && (
          <TaskDefaultsSection settings={settings} update={updateSetting} />
        )}
        {section === 'task-templates' && (
          <TaskTemplatesSection />
        )}
        {section === 'theme' && (
          <ThemeSection settings={settings} update={updateSetting} />
        )}
        {section === 'display' && (
          <DisplaySection settings={settings} update={updateSetting} />
        )}
        {section === 'conference' && (
          <ConferenceSection settings={settings} update={updateSetting} />
        )}
        {section === 'timezone' && (
          <TimezoneSection settings={settings} update={updateSetting} />
        )}
        {section === 'notifications' && (
          <NotificationsSection settings={settings} update={updateSetting} />
        )}
        {section === 'schedules' && (
          <ScheduleEditor />
        )}
        {section === 'email-ingest' && <EmailIngestSection settings={settings} update={updateSetting} />}
        {section === 'meta-ads' && <MetaAdsSection />}
        {section === 'google-ads' && <GoogleAdsSection />}
        {section === 'integrations' && <IntegrationsSection />}
        {section === 'api' && <ApiSection />}
        {section === 'ai-knowledge' && <AiKnowledgeSection />}
        {section === 'client-portals' && <ClientPortalsSection />}
        {section === 'booking' && (
          <BookingSection settings={settings} update={updateSetting} />
        )}
        {section === 'ai' && <AiSettingsSection />}
        {section === 'meeting-ai' && <MeetingAiSection settings={settings} update={updateSetting} />}
        {section === 'env-vault' && <EnvVaultSection />}
        {section === 'profile' && <ProfileSection />}
        {section === 'team' && <TeamSection />}
        {section === 'crm-workspace' && <CrmWorkspaceSection />}
        {section === 'crm-email' && <CrmEmailSection />}
        {section === 'crm-pipeline' && <CrmPipelineSection />}
        {section === 'crm-fields' && <CrmCustomFieldsSection />}
        {section === 'crm-automations' && <CrmAutomationsSection />}
        {section === 'crm-conversation-ai' && <CrmConversationAiSection />}
        {section === 'crm-voice-ai' && <CrmVoiceAiLinkSection />}
        {section === 'crm-webchat' && <CrmWebchatLinkSection />}
        {section === 'crm-phone' && <CrmPhoneLinkSection />}
        {section === 'crm-sms-keywords' && <CrmSmsKeywordsLinkSection />}
        {section === 'crm-tracking-pixel' && <CrmTrackingPixelSection />}
        {section === 'crm-lead-ads' && <CrmLeadAdsSection />}
        {section === 'crm-workflow-integrations' && <CrmWorkflowIntegrationsSection />}
        {section === 'crm-sms' && <CrmSmsSection />}
        </div>
      </div>
    </div>
  )
}

// ─── Reusable ───

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between py-2.5 cursor-pointer group">
      <span className="text-[13px] text-text-secondary group-hover:text-text">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border-strong'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}


function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <input
      type="number"
      value={local}
      min={min}
      max={max}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { const n = Number(local); if (!isNaN(n)) onChange(n) }}
      className="w-20 bg-field border border-border rounded-md px-2 py-1 text-[13px] text-text outline-none focus:border-accent text-right"
    />
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local) }}
      className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
    />
  )
}

function SectionDivider() {
  return <div className="border-b border-border my-3" />
}

// ─── Section Components ───

function CalendarsSection({ accounts, calendars, setAccounts, setCalendars }: {
  accounts: GoogleAccount[]; calendars: GoogleCalendar[];
  setAccounts: (a: GoogleAccount[]) => void; setCalendars: (c: GoogleCalendar[]) => void
}) {
  const hasGoogle = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || accounts.length > 0

  async function disconnect(id: number) {
    await fetch('/api/google/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAccounts(accounts.filter(a => a.id !== id))
    setCalendars(calendars.filter(c => c.account_id !== id))
  }

  async function toggleVisibility(calId: string, visible: boolean) {
    setCalendars(calendars.map(c => c.id === calId ? { ...c, visible: visible ? 1 : 0 } : c))
    await fetch('/api/google/calendars/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: calId, visible }),
    })
  }

  async function toggleBusyStatus(calId: string, status: string) {
    const useForConflicts = status !== 'free'
    setCalendars(calendars.map(c => c.id === calId ? {
      ...c,
      default_busy_status: status,
      use_for_conflicts: useForConflicts ? 1 : 0,
    } : c))
    await fetch('/api/google/calendars/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: calId,
        default_busy_status: status,
        use_for_conflicts: useForConflicts,
      }),
    })
  }

  async function setPrimary(calId: string) {
    setCalendars(calendars.map(c => ({ ...c, is_primary: c.id === calId ? 1 : 0 })))
    await fetch('/api/google/calendars/primary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: calId }),
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-dim">Connect your Google Calendar to see events alongside tasks and enable auto-scheduling around your real schedule.</p>

      {accounts.length === 0 ? (
        <a
          href="/api/google/auth"
          className="settings-connect-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Connect Google Calendar
        </a>
      ) : (
        <div className="space-y-3">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue/20 text-blue text-xs font-bold">G</div>
                <div>
                  <div className="text-[13px] text-text">{a.email}</div>
                  <div className="text-[13px] text-text-dim">Connected</div>
                </div>
              </div>
              <button onClick={() => disconnect(a.id)} className="text-[13px] text-red hover:underline">Disconnect</button>
            </div>
          ))}
          <a href="/api/google/auth" className="text-[13px] text-accent-text hover:underline">+ Add another account</a>
        </div>
      )}

      {calendars.length > 0 && (
        <>
          <SectionDivider />
          <h3 className="text-[13px] font-medium text-text">Calendars</h3>
          <p className="text-[13px] text-text-dim mb-2">Toggle visibility and set a primary calendar for writing new events.</p>
          <div className="space-y-0.5">
            {calendars.map(c => {
              const isFree = c.use_for_conflicts === 0 || (c.default_busy_status || 'busy') === 'free'
              return (
                <div key={c.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-hover/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={c.visible === 1}
                    onChange={e => toggleVisibility(c.id, e.target.checked)}
                    className="accent-accent cursor-pointer shrink-0"
                  />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-[13px] text-text flex-1 truncate">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Busy/Free toggle pill */}
                    <button
                      onClick={() => toggleBusyStatus(c.id, isFree ? 'busy' : 'free')}
                      className="relative w-[72px] h-[26px] rounded-full border transition-colors"
                      style={{
                        background: isFree ? 'rgba(0, 230, 118, 0.12)' : 'rgba(255, 255, 255, 0.06)',
                        borderColor: isFree ? 'rgba(0, 230, 118, 0.25)' : 'var(--border)',
                      }}
                      title="Toggle whether events from this calendar block your schedule"
                    >
                      <span
                        className="absolute top-[3px] w-[20px] h-[20px] rounded-full transition-all duration-200"
                        style={{
                          left: isFree ? 'calc(100% - 23px)' : '3px',
                          background: isFree ? '#00e676' : 'var(--text-dim)',
                        }}
                      />
                      <span className={`absolute text-[9px] font-semibold uppercase tracking-wider ${isFree ? 'left-2' : 'right-2'} top-1/2 -translate-y-1/2`}
                        style={{ color: isFree ? '#00e676' : 'var(--text-dim)' }}
                      >
                        {isFree ? 'Free' : 'Busy'}
                      </span>
                    </button>
                    {c.is_primary === 1 ? (
                      <span className="text-[10px] text-accent-text bg-accent/10 border border-accent/20 px-2 py-0.5 rounded font-medium w-[60px] text-center">Primary</span>
                    ) : (
                      <button
                        onClick={() => setPrimary(c.id)}
                        className="text-[10px] text-text-dim hover:text-accent-text px-2 py-0.5 rounded border border-border hover:border-accent/30 transition-colors w-[60px] text-center"
                      >
                        Set primary
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function RadioOption({ selected, onSelect, label, disabled }: { selected: boolean; onSelect: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`flex items-center gap-3 py-2 text-left w-full ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-accent' : 'border-border-strong'}`}>
        {selected && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
      </span>
      <span className={`text-[13px] ${disabled ? 'text-text-dim' : 'text-text-secondary'}`}>{label}</span>
    </button>
  )
}

function AutoSchedulingSection({ settings, update, onNavigate }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void; onNavigate?: (section: string) => void }) {
  const showOnCalendar = (settings.showTasksOnCalendar as string) ?? 'show'
  const syncToGoogle = (settings.syncTasksToGoogle as string) ?? 'off'
  const breakEnabled = (settings.breakEnabled as boolean) ?? true
  const breakMin = (settings.breakMinutes as number) ?? 15
  const breakEvery = (settings.breakEveryHours as number) ?? 3

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-text-dim">
        Motion Lite checks for conflicts from your connected calendars. To modify which calendars are used, go to the{' '}
        <button onClick={() => onNavigate?.('calendars')} className="text-accent-text underline">Calendars</button> page in settings.
      </p>

      {/* Show tasks on CTRL Calendar */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text mb-2">Show tasks on CTRL Calendar?</h3>
        <RadioOption
          selected={showOnCalendar === 'show'}
          onSelect={() => update('showTasksOnCalendar', 'show')}
          label="Show tasks on CTRL Calendar"
        />
        <RadioOption
          selected={showOnCalendar === 'hide'}
          onSelect={() => update('showTasksOnCalendar', 'hide')}
          label="Don't show tasks on CTRL Calendar"
        />
      </div>

      {/* Show tasks on Google Calendar */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text mb-2">Show tasks on Google Calendar?</h3>
        <RadioOption
          selected={syncToGoogle === 'free'}
          onSelect={() => update('syncTasksToGoogle', 'free')}
          label="Show tasks on Google Calendar, but keep tasks as free"
        />
        <RadioOption
          selected={syncToGoogle === 'busy'}
          onSelect={() => update('syncTasksToGoogle', 'busy')}
          label="Show tasks on Google Calendar; tasks at risk of missing deadline are marked as busy"
        />
        <RadioOption
          selected={syncToGoogle === 'off'}
          onSelect={() => update('syncTasksToGoogle', 'off')}
          label="Don't show tasks on Google Calendar"
        />
      </div>

      {/* Break between tasks */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">Break between tasks</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => update('breakEnabled', !breakEnabled)}
            className={`relative w-10 h-5.5 rounded-full transition-colors ${breakEnabled ? 'bg-accent' : 'bg-border-strong'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${breakEnabled ? 'translate-x-5' : ''}`} />
          </button>
          <span className="text-[13px] text-text-secondary">Schedule a</span>
          <Dropdown
            value={String(breakMin)}
            onChange={(v) => update('breakMinutes', Number(v))}
            disabled={!breakEnabled}
            options={[5, 10, 15, 20, 25, 30, 45, 60].map(v => ({ value: String(v), label: String(v) }))}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={80}
          />
          <span className="text-[13px] text-text-secondary">min break every</span>
          <Dropdown
            value={String(breakEvery)}
            onChange={(v) => update('breakEveryHours', Number(v))}
            disabled={!breakEnabled}
            options={[1, 2, 3, 4, 5, 6].map(v => ({ value: String(v), label: String(v) }))}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={70}
          />
          <span className="text-[13px] text-text-secondary">hour(s)</span>
        </div>
      </div>

      {/* Meeting buffer times */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">Meeting buffer</h3>
        <p className="text-[13px] text-text-dim">Add buffer time before and after calendar events so tasks aren't scheduled back-to-back with meetings.</p>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-text-secondary w-16">Before:</span>
          <Dropdown
            value={String((settings.meetingBufferBefore as number) ?? 0)}
            onChange={(v) => update('meetingBufferBefore', Number(v))}
            options={[0, 5, 10, 15, 30].map(v => ({ value: String(v), label: v === 0 ? 'None' : `${v} min` }))}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={100}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-text-secondary w-16">After:</span>
          <Dropdown
            value={String((settings.meetingBufferAfter as number) ?? 0)}
            onChange={(v) => update('meetingBufferAfter', Number(v))}
            options={[0, 5, 10, 15, 30].map(v => ({ value: String(v), label: v === 0 ? 'None' : `${v} min` }))}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={100}
          />
        </div>
      </div>
    </div>
  )
}

function SmartSchedulingSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const deadlineUrgencyEnabled = (settings.deadlineUrgencyEnabled as boolean) ?? true
  const deadlineUrgencyDays = (settings.deadlineUrgencyDays as number) ?? 3
  const batchSimilarTasks = (settings.batchSimilarTasks as boolean) ?? true
  const deepWorkCapEnabled = (settings.deepWorkCapEnabled as boolean) ?? true
  const deepWorkCapMinutes = (settings.deepWorkCapMinutes as number) ?? 240
  const noDeepWorkAfterMeetings = (settings.noDeepWorkAfterMeetings as boolean) ?? true
  const deepWorkMeetingBufferMinutes = (settings.deepWorkMeetingBufferMinutes as number) ?? 30
  const eatTheFrogEnabled = (settings.eatTheFrogEnabled as boolean) ?? true

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  useEffect(() => {
    fetch('/api/api-keys').then(r => r.json()).then(d => setHasApiKey(!!d.configured)).catch(() => setHasApiKey(false))
  }, [])

  const toggleBtnClass = (on: boolean) =>
    `relative w-10 h-5.5 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-border-strong'}`
  const toggleKnobClass = (on: boolean) =>
    `absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`
  const dropdownTrigger = 'bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors'

  const AiGate = () => (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M8 1L2 4v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4L8 1z" stroke="#a855f7" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6 8l1.5 1.5L10 6" stroke="#a855f7" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <div>
        <p className="text-[13px] text-text-secondary">AI-powered feature. Add your API key in <a href="/settings?section=ai" className="text-[#a855f7] hover:underline font-medium">Settings &gt; AI</a> to enable.</p>
        <p className="text-[11px] text-text-dim/60 mt-0.5">AI automatically classifies task effort levels so the scheduler knows which tasks need deep focus.</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-text-dim">
        Research-backed scheduling intelligence. These features use productivity science to optimize when and how tasks are placed on your calendar.
      </p>

      {/* Deadline Urgency */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-text">Deadline Urgency Boost</h3>
          <button onClick={() => update('deadlineUrgencyEnabled', !deadlineUrgencyEnabled)} className={toggleBtnClass(deadlineUrgencyEnabled)}>
            <span className={toggleKnobClass(deadlineUrgencyEnabled)} />
          </button>
        </div>
        <p className="text-[13px] text-text-dim leading-relaxed">
          Tasks approaching their deadline get a dynamic priority boost, closing the gap between priority tiers. A medium-priority task due tomorrow will be scheduled before a high-priority task due next week.
        </p>
        <p className="text-[11px] text-text-dim/70 italic">
          Based on the Yerkes-Dodson Law: moderate time pressure improves focus and performance. Prevents last-minute scrambles by gradually escalating urgency.
        </p>
        {deadlineUrgencyEnabled && (
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[13px] text-text-secondary">Boost tasks within</span>
            <Dropdown
              value={String(deadlineUrgencyDays)}
              onChange={(v) => update('deadlineUrgencyDays', Number(v))}
              options={[1, 2, 3, 5, 7, 10, 14].map(v => ({ value: String(v), label: `${v} day${v > 1 ? 's' : ''}` }))}
              triggerClassName={dropdownTrigger}
              minWidth={100}
            />
            <span className="text-[13px] text-text-secondary">of their deadline</span>
          </div>
        )}
      </div>

      {/* Task Batching */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-text">Task Batching</h3>
          <button onClick={() => update('batchSimilarTasks', !batchSimilarTasks)} className={toggleBtnClass(batchSimilarTasks)}>
            <span className={toggleKnobClass(batchSimilarTasks)} />
          </button>
        </div>
        <p className="text-[13px] text-text-dim leading-relaxed">
          Groups tasks from the same project together in your schedule. Instead of constantly switching between projects, you'll work on related tasks back-to-back.
        </p>
        <p className="text-[11px] text-text-dim/70 italic">
          Context switching costs 20-40% of productive time (American Psychological Association). Batching similar work reduces the cognitive tax of task-switching.
        </p>
      </div>

      {/* ── AI-Powered Features ── */}
      <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-6">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.5 4.5H14l-3.7 2.7 1.4 4.3L8 9.8l-3.7 2.7 1.4-4.3L2 5.5h4.5L8 1z" fill="#a855f7" opacity="0.9"/></svg>
          <h3 className="text-[14px] font-semibold" style={{ color: '#a855f7' }}>AI-Powered Scheduling</h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
            {hasApiKey === null ? '...' : hasApiKey ? 'Active' : 'Requires API key'}
          </span>
        </div>
        <p className="text-[12px] text-text-dim/70 mb-6 -mt-3">
          These features use AI to automatically classify how much cognitive effort each task requires. No manual tagging needed.
        </p>

        {hasApiKey === false && <AiGate />}

        <div className={hasApiKey === false ? 'opacity-50 pointer-events-none mt-6' : ''}>
          <div className="space-y-8">
            {/* Eat the Frog */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-text">Eat the Frog</h3>
                <button onClick={() => update('eatTheFrogEnabled', !eatTheFrogEnabled)} className={toggleBtnClass(eatTheFrogEnabled)}>
                  <span className={toggleKnobClass(eatTheFrogEnabled)} />
                </button>
              </div>
              <p className="text-[13px] text-text-dim leading-relaxed">
                Your highest-effort task gets scheduled in the first work slot each day. Tackle the hardest thing first while your willpower and focus are at their peak.
              </p>
              <p className="text-[11px] text-text-dim/70 italic">
                Based on Brian Tracy's research: tackling your hardest task first prevents procrastination and builds momentum. Mark Twain: "Eat a live frog first thing in the morning and nothing worse will happen to you the rest of the day."
              </p>
            </div>

            {/* Deep Work Cap */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-text">Deep Work Daily Cap</h3>
                <button onClick={() => update('deepWorkCapEnabled', !deepWorkCapEnabled)} className={toggleBtnClass(deepWorkCapEnabled)}>
                  <span className={toggleKnobClass(deepWorkCapEnabled)} />
                </button>
              </div>
              <p className="text-[13px] text-text-dim leading-relaxed">
                Limits how many minutes of high-effort tasks are scheduled per day. AI automatically detects which tasks need deep focus so they won't be crammed into a single exhausting day.
              </p>
              <p className="text-[11px] text-text-dim/70 italic">
                Cal Newport's research shows most people can sustain 3-4 hours of deep work daily. Anders Ericsson found elite performers practice in focused blocks of ~4 hours max.
              </p>
              {deepWorkCapEnabled && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[13px] text-text-secondary">Max deep work per day:</span>
                  <Dropdown
                    value={String(deepWorkCapMinutes)}
                    onChange={(v) => update('deepWorkCapMinutes', Number(v))}
                    options={[120, 180, 240, 300, 360, 480].map(v => ({ value: String(v), label: `${v / 60}h (${v} min)` }))}
                    triggerClassName={dropdownTrigger}
                    minWidth={130}
                  />
                </div>
              )}
            </div>

            {/* No Deep Work After Meetings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-text">No Deep Work After Meetings</h3>
                <button onClick={() => update('noDeepWorkAfterMeetings', !noDeepWorkAfterMeetings)} className={toggleBtnClass(noDeepWorkAfterMeetings)}>
                  <span className={toggleKnobClass(noDeepWorkAfterMeetings)} />
                </button>
              </div>
              <p className="text-[13px] text-text-dim leading-relaxed">
                Prevents high-effort tasks from being scheduled immediately after calendar events. Gives your brain a buffer to decompress before diving into demanding work.
              </p>
              <p className="text-[11px] text-text-dim/70 italic">
                Research from Microsoft's Human Factors Lab shows back-to-back meetings cause stress accumulation and reduce focus. A transition buffer restores cognitive readiness.
              </p>
              {noDeepWorkAfterMeetings && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[13px] text-text-secondary">Buffer after meetings:</span>
                  <Dropdown
                    value={String(deepWorkMeetingBufferMinutes)}
                    onChange={(v) => update('deepWorkMeetingBufferMinutes', Number(v))}
                    options={[10, 15, 20, 30, 45, 60].map(v => ({ value: String(v), label: `${v} min` }))}
                    triggerClassName={dropdownTrigger}
                    minWidth={100}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskDefaultsSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-1">
      <SettingRow label="Default priority">
        <Dropdown
          value={settings.defaultPriority as string ?? 'medium'}
          options={[
            { value: 'urgent', label: 'ASAP' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
          onChange={v => update('defaultPriority', v)}
          triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
          minWidth={140}
        />
      </SettingRow>
      <SettingRow label="Default duration (minutes)">
        <NumberInput value={settings.defaultDuration as number ?? 30} onChange={v => update('defaultDuration', v)} min={5} max={480} />
      </SettingRow>
      <SettingRow label="Min chunk duration">
        <Dropdown
          value={String((settings.minChunkDuration as number) ?? 30)}
          onChange={(v) => update('minChunkDuration', Number(v))}
          options={[{ value: '0', label: 'None' }, ...([15, 30, 45, 60, 90].map(v => ({ value: String(v), label: `${v} min` })))]}
          triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
          minWidth={100}
        />
      </SettingRow>
      <div className="py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Max chunk duration</span>
          <Dropdown
            value={String((settings.maxChunkDuration as number) ?? 90)}
            onChange={(v) => update('maxChunkDuration', Number(v))}
            options={[{ value: '0', label: 'None' }, ...([30, 45, 60, 90, 120, 180].map(v => ({ value: String(v), label: `${v} min` })))]}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={100}
          />
        </div>
        <p className="text-[11px] text-text-dim mt-1">Ultradian rhythm: 90-min cycles of peak focus</p>
      </div>
      <div className="py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Buffer between tasks</span>
          <Dropdown
            value={String((settings.taskBufferMinutes as number) ?? 5)}
            onChange={(v) => update('taskBufferMinutes', Number(v))}
            options={[0, 5, 10, 15].map(v => ({ value: String(v), label: v === 0 ? 'None' : `${v} min` }))}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={100}
          />
        </div>
        <p className="text-[11px] text-text-dim mt-1">Context switching: 5+ min helps refocus between tasks</p>
      </div>
      <div className="py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-secondary">Daily capacity cap</span>
          <Dropdown
            value={String((settings.dailyCapPercent as number) ?? 85)}
            onChange={(v) => update('dailyCapPercent', Number(v))}
            options={[{ value: '100', label: '100% (fill all hours)' }, { value: '90', label: '90%' }, { value: '85', label: '85% (recommended)' }, { value: '80', label: '80%' }, { value: '75', label: '75%' }, { value: '70', label: '70%' }]}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={180}
          />
        </div>
        <p className="text-[11px] text-text-dim mt-1">Planning Fallacy: leave buffer for overruns and unplanned work</p>
      </div>
      <SectionDivider />
      <Toggle checked={settings.defaultAutoSchedule as boolean ?? true} onChange={v => update('defaultAutoSchedule', v)} label="Auto-schedule new tasks by default" />
      <Toggle checked={settings.defaultHardDeadline as boolean ?? false} onChange={v => update('defaultHardDeadline', v)} label="Hard deadline by default" />
    </div>
  )
}

function ThemeSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const theme = (settings.theme as string) ?? 'dark'
  return (
    <div className="space-y-6">
      {/* Appearance */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Appearance</h3>
        <p className="text-[13px] text-text-dim mb-3">Choose your preferred color theme.</p>
        <div className="flex gap-2">
          {(['dark', 'light', 'system'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => { update('theme', opt); document.documentElement.setAttribute('data-theme', opt === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : opt) }}
              className={`flex-1 py-2 rounded-md text-[13px] font-medium border transition-colors capitalize ${
                theme === opt
                  ? 'bg-accent-dim border-accent text-accent-text'
                  : 'bg-elevated border-border text-text-secondary hover:border-border-strong'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <SectionDivider />

      {/* Week start */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text">Week starts on</h3>
        <SettingRow label="First day of the week">
          <Dropdown
            value={settings.weekStartDay as string ?? 'sunday'}
            options={[
              { value: 'sunday', label: 'Sunday' },
              { value: 'monday', label: 'Monday' },
            ]}
            onChange={v => update('weekStartDay', v)}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={140}
          />
        </SettingRow>
      </div>
    </div>
  )
}

function DisplaySection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const density = (settings.displayDensity as string) ?? 'comfortable'
  const hideWeekends = (settings.hideWeekends as string) === 'true'
  const showTasks = (settings.showTasksOnCalendar as string) ?? 'show'

  return (
    <div className="space-y-6">
      {/* Density */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Row density</h3>
        <p className="text-[13px] text-text-dim mb-3">Controls the vertical spacing of rows across the app.</p>
        <div className="flex gap-2">
          <button
            onClick={() => update('displayDensity', 'compact')}
            className={`flex-1 py-2 rounded-md text-[13px] font-medium border transition-colors ${
              density === 'compact'
                ? 'bg-accent-dim border-accent text-accent-text'
                : 'bg-elevated border-border text-text-secondary hover:border-border-strong'
            }`}
          >
            Compact
          </button>
          <button
            onClick={() => update('displayDensity', 'comfortable')}
            className={`flex-1 py-2 rounded-md text-[13px] font-medium border transition-colors ${
              density === 'comfortable'
                ? 'bg-accent-dim border-accent text-accent-text'
                : 'bg-elevated border-border text-text-secondary hover:border-border-strong'
            }`}
          >
            Comfortable
          </button>
        </div>
      </div>

      <SectionDivider />

      {/* Hide weekends */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text">Calendar weekends</h3>
        <Toggle
          checked={hideWeekends}
          onChange={v => update('hideWeekends', v ? 'true' : 'false')}
          label="Hide weekends on calendar"
        />
      </div>

      <SectionDivider />

      {/* Week start day */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text">Week starts on</h3>
        <SettingRow label="First day of the week">
          <Dropdown
            value={(settings.weekStartDay as string) ?? 'sunday'}
            options={[
              { value: 'sunday', label: 'Sunday' },
              { value: 'monday', label: 'Monday' },
            ]}
            onChange={v => update('weekStartDay', v)}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
            minWidth={140}
          />
        </SettingRow>
      </div>

      <SectionDivider />

      {/* Show tasks on calendar */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text">Show tasks on calendar</h3>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => update('showTasksOnCalendar', 'show')}
            className={`flex-1 py-2 rounded-md text-[13px] font-medium border transition-colors ${
              showTasks === 'show'
                ? 'bg-accent-dim border-accent text-accent-text'
                : 'bg-elevated border-border text-text-secondary hover:border-border-strong'
            }`}
          >
            Show
          </button>
          <button
            onClick={() => update('showTasksOnCalendar', 'hide')}
            className={`flex-1 py-2 rounded-md text-[13px] font-medium border transition-colors ${
              showTasks === 'hide'
                ? 'bg-accent-dim border-accent text-accent-text'
                : 'bg-elevated border-border text-text-secondary hover:border-border-strong'
            }`}
          >
            Hide
          </button>
        </div>
      </div>

      <SectionDivider />

      {/* Task display mode (Free/Busy) */}
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold text-text">Task display on external calendars</h3>
        <p className="text-[13px] text-text-dim mb-3">Controls how scheduled tasks appear when synced to Google Calendar or viewed by others.</p>
        {([
          { value: 'motion_only', label: 'App only', desc: 'Tasks only visible in Motion Lite, not synced to external calendars' },
          { value: 'show_all_free', label: 'Show all as Free', desc: 'Tasks appear on external calendars but marked as "Free" so they don\'t block others' },
          { value: 'show_at_risk_busy', label: 'Show at-risk as Busy', desc: 'On-time tasks show as Free, at-risk/overdue tasks show as Busy' },
        ] as const).map(opt => {
          const current = (settings.taskDisplayMode as string) ?? 'motion_only'
          return (
            <button key={opt.value} onClick={() => update('taskDisplayMode', opt.value)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${current === opt.value ? 'bg-accent-dim border-accent' : 'border-border hover:border-border-strong'}`}>
              <div className="text-[13px] font-medium text-text">{opt.label}</div>
              <div className="text-[13px] text-text-dim mt-0.5">{opt.desc}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConferenceSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const [zoomStatus, setZoomStatus] = useState<{ connected: boolean; email?: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/zoom/status').then(r => r.json()).then(setZoomStatus).catch(() => setZoomStatus({ connected: false }))
  }, [])

  return (
    <div className="space-y-4">
      {/* Zoom connection */}
      <div className="rounded-lg border border-border glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2D8CFF]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M4.5 7.5A1.5 1.5 0 016 6h8.25a1.5 1.5 0 011.5 1.5v5.25a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5V7.5zm12 1.5l3 -2.25v6.75l-3-2.25V9z"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">Zoom</p>
              {zoomStatus?.connected ? (
                <p className="text-[13px] text-accent-text">{zoomStatus.email}</p>
              ) : (
                <p className="text-[13px] text-text-dim">Connect to create meetings automatically</p>
              )}
            </div>
          </div>
          {zoomStatus?.connected ? (
            <button
              onClick={async () => {
                await fetch('/api/auth/zoom/disconnect', { method: 'POST' })
                setZoomStatus({ connected: false })
              }}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text-dim hover:bg-hover"
            >
              Disconnect
            </button>
          ) : (
            <a
              href="/api/auth/zoom?connect=1"
              className="rounded-md bg-[#2D8CFF] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#2D8CFF]/80"
            >
              Connect Zoom
            </a>
          )}
        </div>
      </div>

      <SettingRow label="Default conferencing">
        <Dropdown
          value={settings.defaultConferencing as string ?? 'none'}
          options={[
            { value: 'none', label: 'None' },
            { value: 'google_meet', label: 'Google Meet' },
            { value: 'zoom', label: 'Zoom' },
            { value: 'custom', label: 'Custom URL' },
          ]}
          onChange={v => update('defaultConferencing', v)}
          triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
          minWidth={160}
        />
      </SettingRow>
      {(settings.defaultConferencing as string) === 'custom' && (
        <div className="space-y-2">
          <label className="text-[13px] text-text-dim">Custom conferencing URL</label>
          <TextInput value={settings.defaultConferencingUrl as string ?? ''} onChange={v => update('defaultConferencingUrl', v)} placeholder="https://your-meeting-link.com/room" />
        </div>
      )}
      <div className="space-y-2">
        <label className="text-[13px] text-text-dim">Phone number</label>
        <TextInput value={settings.phoneNumber as string ?? ''} onChange={v => update('phoneNumber', v)} placeholder="+1 (555) 000-0000" />
      </div>
      <div className="space-y-2">
        <label className="text-[13px] text-text-dim">Custom location</label>
        <TextInput value={settings.customLocation as string ?? ''} onChange={v => update('customLocation', v)} placeholder="Office, coffee shop, etc." />
      </div>
    </div>
  )
}

interface FbAdAccount { id: string; name: string; account_id: string; account_status: number; currency: string; business_name: string; selected: boolean; client_slug: string | null }
interface FbPage { id: string; name: string; category: string; access_token: string; picture_url: string; fan_count: number; instagram_account_id: string | null; selected: boolean }

function MetaAdsSection() {
  const [fbStatus, setFbStatus] = useState<{ connected: boolean; email?: string; expired?: boolean } | null>(null)
  const [accounts, setAccounts] = useState<FbAdAccount[]>([])
  const [pages, setPages] = useState<FbPage[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set())
  const [slugMap, setSlugMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/auth/facebook/status').then(r => r.json()).then(data => {
      setFbStatus(data)
      if (data.connected && !data.expired) {
        loadAccountsAndPages()
      }
    }).catch(() => setFbStatus({ connected: false }))
  }, [])

  async function loadAccountsAndPages() {
    setLoading(true)
    try {
      const [accRes, pageRes] = await Promise.all([
        fetch('/api/meta/accounts').then(r => r.json()),
        fetch('/api/meta/pages').then(r => r.json()),
      ])
      if (accRes.available) {
        setAccounts(accRes.available)
        setSelectedAccounts(new Set(accRes.available.filter((a: FbAdAccount) => a.selected).map((a: FbAdAccount) => a.id)))
        const slugs: Record<string, string> = {}
        for (const a of accRes.available) {
          if (a.client_slug) slugs[a.id] = a.client_slug
        }
        setSlugMap(slugs)
      }
      if (pageRes.available) {
        setPages(pageRes.available)
        setSelectedPages(new Set(pageRes.available.filter((p: FbPage) => p.selected).map((p: FbPage) => p.id)))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function saveAccounts() {
    setSaving(true)
    const selected = accounts.filter(a => selectedAccounts.has(a.id))
    await fetch('/api/meta/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: selected.map(a => ({
        account_id: a.id,
        account_name: a.name,
        client_slug: slugMap[a.id] || null,
        currency: a.currency,
        business_name: a.business_name,
      })) }),
    })
    setSaving(false)
    setMessage('Ad accounts saved')
    setTimeout(() => setMessage(''), 3000)
  }

  async function savePages() {
    setSaving(true)
    const selected = pages.filter(p => selectedPages.has(p.id))
    await fetch('/api/meta/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selected.map(p => ({
        page_id: p.id,
        page_name: p.name,
        page_access_token: p.access_token,
        instagram_account_id: p.instagram_account_id,
        category: p.category,
        picture_url: p.picture_url,
        fan_count: p.fan_count,
      })) }),
    })
    setSaving(false)
    setMessage('Pages saved')
    setTimeout(() => setMessage(''), 3000)
  }

  async function syncNow() {
    setSyncing(true)
    const res = await fetch('/api/ads/refresh?days=3&wait=1')
    const data = await res.json()
    setSyncing(false)
    setMessage(data.ok ? `Synced ${data.rows || 0} rows` : (data.message || 'Sync failed'))
    setTimeout(() => setMessage(''), 5000)
  }

  return (
    <div className="space-y-4">
      {/* Facebook connection */}
      <div className="rounded-lg border border-border glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: '#1877F2' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">Facebook / Meta</p>
              {fbStatus?.connected ? (
                <p className="text-[13px] text-accent-text">{fbStatus.email}{fbStatus.expired ? ' (token expired)' : ''}</p>
              ) : (
                <p className="text-[13px] text-text-dim">Connect to sync ad accounts and pages</p>
              )}
            </div>
          </div>
          {fbStatus?.connected ? (
            <button
              onClick={async () => {
                await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
                setFbStatus({ connected: false })
                setAccounts([])
                setPages([])
                setSelectedAccounts(new Set())
                setSelectedPages(new Set())
              }}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text-dim hover:bg-hover"
            >
              Disconnect
            </button>
          ) : (
            <a
              href="/api/auth/facebook?connect=1"
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              style={{ background: '#1877F2' }}
            >
              Connect Facebook
            </a>
          )}
        </div>
      </div>

      {fbStatus?.connected && !fbStatus.expired && (
        <>
          {/* Ad Accounts */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-text">Ad Accounts</h3>
              <button onClick={saveAccounts} disabled={saving} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/80 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Selection'}
              </button>
            </div>
            {loading ? (
              <p className="text-[13px] text-text-dim">Loading accounts...</p>
            ) : accounts.length === 0 ? (
              <p className="text-[13px] text-text-dim">No ad accounts found. Make sure you have admin access to ad accounts in Meta Business Manager.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {accounts.map(acc => (
                  <label key={acc.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-hover/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.has(acc.id)}
                      onChange={e => {
                        const next = new Set(selectedAccounts)
                        e.target.checked ? next.add(acc.id) : next.delete(acc.id)
                        setSelectedAccounts(next)
                      }}
                      className="mt-0.5 accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text truncate">{acc.name}</p>
                      <p className="text-[13px] text-text-dim">{acc.business_name || acc.id} · {acc.currency} · {acc.account_status === 1 ? 'Active' : 'Inactive'}</p>
                      {selectedAccounts.has(acc.id) && (
                        <input
                          type="text"
                          placeholder="Client slug (e.g. eco-spa)"
                          value={slugMap[acc.id] || ''}
                          onChange={e => setSlugMap({ ...slugMap, [acc.id]: e.target.value })}
                          onClick={e => e.stopPropagation()}
                          className="mt-1 w-full rounded border border-border bg-elevated px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
                        />
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Pages */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-text">Facebook / Instagram Pages</h3>
              <button onClick={savePages} disabled={saving} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/80 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Selection'}
              </button>
            </div>
            {loading ? (
              <p className="text-[13px] text-text-dim">Loading pages...</p>
            ) : pages.length === 0 ? (
              <p className="text-[13px] text-text-dim">No pages found. Make sure you manage Facebook pages.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {pages.map(page => (
                  <label key={page.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-hover/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPages.has(page.id)}
                      onChange={e => {
                        const next = new Set(selectedPages)
                        e.target.checked ? next.add(page.id) : next.delete(page.id)
                        setSelectedPages(next)
                      }}
                      className="accent-accent"
                    />
                    {page.picture_url && (
                      <img src={page.picture_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text truncate">{page.name}</p>
                      <p className="text-[13px] text-text-dim">
                        {page.category}{page.fan_count > 0 ? ` · ${page.fan_count.toLocaleString()} followers` : ''}
                        {page.instagram_account_id ? ' · IG linked' : ''}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Sync controls */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-medium text-text">Data Sync</h3>
                <p className="text-[13px] text-text-dim">Auto-syncs every 4 hours</p>
              </div>
              <button onClick={syncNow} disabled={syncing} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text hover:bg-hover disabled:opacity-50">
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          </div>
        </>
      )}

      {message && (
        <p className="text-[13px] text-accent-text">{message}</p>
      )}
    </div>
  )
}

interface GadsAccount {
  customer_id: string
  descriptive_name: string
  currency_code: string
  manager: boolean
  status: string
  selected: boolean
  client_slug: string | null
}

function GoogleAdsSection() {
  const [status, setStatus] = useState<{ connected: boolean; email?: string; expired?: boolean } | null>(null)
  const [config, setConfig] = useState<{ hasDevToken: boolean; hasMccId: boolean } | null>(null)
  const [accounts, setAccounts] = useState<GadsAccount[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set())
  const [slugMap, setSlugMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/google-ads/status').then(r => r.json()),
      fetch('/api/google-ads/config').then(r => r.json()),
    ]).then(([statusData, configData]) => {
      setStatus(statusData)
      setConfig(configData)
      if (statusData.connected && !statusData.expired && configData.hasDevToken) {
        loadAccounts()
      }
    }).catch(() => setStatus({ connected: false }))
  }, [])

  async function loadAccounts() {
    setLoading(true)
    try {
      const res = await fetch('/api/google-ads/accounts')
      const data = await res.json()
      if (data.available) {
        setAccounts(data.available)
        setSelectedAccounts(new Set(data.available.filter((a: GadsAccount) => a.selected).map((a: GadsAccount) => a.customer_id)))
        const slugs: Record<string, string> = {}
        for (const a of data.available) {
          if (a.client_slug) slugs[a.customer_id] = a.client_slug
        }
        setSlugMap(slugs)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function saveAccountSelection() {
    setSaving(true)
    const selected = accounts.filter(a => selectedAccounts.has(a.customer_id))
    await fetch('/api/google-ads/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: selected.map(a => ({
        customer_id: a.customer_id,
        account_name: a.descriptive_name,
        client_slug: slugMap[a.customer_id] || null,
        currency: a.currency_code,
        manager: a.manager,
      })) }),
    })
    setSaving(false)
    setMessage('Google Ads accounts saved')
    setTimeout(() => setMessage(''), 3000)
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/google-ads/refresh?days=3&wait=1')
      const data = await res.json()
      setMessage(data.ok ? `Synced ${data.rows || 0} rows` : (data.error || 'Sync failed'))
    } catch {
      setMessage('Sync failed')
    }
    setSyncing(false)
    setTimeout(() => setMessage(''), 5000)
  }

  return (
    <div className="space-y-4">
      {/* Google Ads connection */}
      <div className="rounded-lg border border-border glass p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: '#4285F4' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.1a6.94 6.94 0 010-4.2V7.06H2.18A11.96 11.96 0 001 12c0 1.94.46 3.77 1.18 5.06l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">Google Ads</p>
              {status?.connected ? (
                <p className="text-[13px] text-accent-text">{status.email}{status.expired ? ' (token expired)' : ''}</p>
              ) : (
                <p className="text-[13px] text-text-dim">Connect to sync Google Ads campaigns</p>
              )}
            </div>
          </div>
          {status?.connected ? (
            <button
              onClick={async () => {
                await fetch('/api/auth/google-ads/disconnect', { method: 'POST' })
                setStatus({ connected: false })
                setAccounts([])
                setSelectedAccounts(new Set())
              }}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text-dim hover:bg-hover"
            >
              Disconnect
            </button>
          ) : (
            <a
              href="/api/auth/google-ads?connect=1"
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              style={{ background: '#4285F4' }}
            >
              Connect Google Ads
            </a>
          )}
        </div>
      </div>

      {/* Developer token warning */}
      {config && !config.hasDevToken && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-900/10 p-3">
          <p className="text-[13px] text-yellow-400">Developer Token not configured. Set GOOGLE_ADS_DEVELOPER_TOKEN in your environment to enable Google Ads API access.</p>
        </div>
      )}

      {status?.connected && !status.expired && config?.hasDevToken && (
        <>
          {/* Ad Accounts */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-text">Google Ads Accounts</h3>
              <button onClick={saveAccountSelection} disabled={saving} className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/80 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Selection'}
              </button>
            </div>
            {loading ? (
              <p className="text-[13px] text-text-dim">Loading accounts...</p>
            ) : accounts.length === 0 ? (
              <p className="text-[13px] text-text-dim">No Google Ads accounts found. Make sure your Google account has access to Google Ads accounts.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {accounts.map(acc => (
                  <label key={acc.customer_id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-hover/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.has(acc.customer_id)}
                      onChange={e => {
                        const next = new Set(selectedAccounts)
                        e.target.checked ? next.add(acc.customer_id) : next.delete(acc.customer_id)
                        setSelectedAccounts(next)
                      }}
                      className="mt-0.5 accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-text truncate">
                        {acc.descriptive_name}
                        {acc.manager && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">MCC</span>}
                      </p>
                      <p className="text-[13px] text-text-dim">{acc.customer_id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')} · {acc.currency_code} · {acc.status}</p>
                      {selectedAccounts.has(acc.customer_id) && (
                        <input
                          type="text"
                          placeholder="Client slug (e.g. eco-spa)"
                          value={slugMap[acc.customer_id] || ''}
                          onChange={e => setSlugMap({ ...slugMap, [acc.customer_id]: e.target.value })}
                          onClick={e => e.stopPropagation()}
                          className="mt-1 w-full rounded border border-border bg-elevated px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
                        />
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Sync controls */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-medium text-text">Data Sync</h3>
                <p className="text-[13px] text-text-dim">Auto-syncs every 4 hours</p>
              </div>
              <button onClick={syncNow} disabled={syncing} className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text hover:bg-hover disabled:opacity-50">
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          </div>
        </>
      )}

      {message && (
        <p className="text-[13px] text-accent-text">{message}</p>
      )}
    </div>
  )
}

function TimezoneSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const tzOptions = [
    'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
    'America/Phoenix', 'Pacific/Honolulu', 'America/Anchorage',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland',
  ].map(tz => ({ value: tz, label: tz.replace(/_/g, ' ') }))

  return (
    <div className="space-y-3">
      <SettingRow label="Primary timezone">
        <Dropdown value={settings.timezone as string ?? 'America/Los_Angeles'} options={tzOptions} onChange={v => update('timezone', v)} searchable triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={220} />
      </SettingRow>
      <SettingRow label="Secondary timezone">
        <Dropdown value={settings.secondaryTimezone as string ?? ''} options={[{ value: '', label: 'None' }, ...tzOptions]} onChange={v => update('secondaryTimezone', v)} searchable triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={220} />
      </SettingRow>
    </div>
  )
}

function NotificationsSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-1">
      <Toggle checked={settings.notifyEventCreated as boolean ?? true} onChange={v => update('notifyEventCreated', v)} label="Event created" />
      <Toggle checked={settings.notifyEventUpdated as boolean ?? true} onChange={v => update('notifyEventUpdated', v)} label="Event updated" />
      <Toggle checked={settings.notifyEventReminder as boolean ?? true} onChange={v => update('notifyEventReminder', v)} label="Event reminders" />
      <Toggle checked={settings.notifyTaskDue as boolean ?? true} onChange={v => update('notifyTaskDue', v)} label="Task due soon" />
    </div>
  )
}

function MeetingAiSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const [scope, setScope] = useState((settings.meetingTaskScope as string) || 'Marketing & Meta Ads, Funnels & Landing Pages, Technology & Automation, Content Creation & Videography, Client Management & Communication')
  const [scopeDirty, setScopeDirty] = useState(false)
  const [clients, setClients] = useState<{ id: number; name: string; avatar_color: string }[]>([])
  const [clientBusinesses, setClientBusinesses] = useState<Record<number, { id: number; name: string; avatar_color: string }[]>>({})
  const [keywords, setKeywords] = useState<Record<string, string>>({})
  const [keywordsDirty, setKeywordsDirty] = useState<Set<string>>(new Set())
  const [bizKeywords, setBizKeywords] = useState<Record<string, string>>({})
  const [bizKeywordsDirty, setBizKeywordsDirty] = useState<Set<string>>(new Set())

  // Load client profiles + their businesses
  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(data => {
      const list = data?.profiles || (Array.isArray(data) ? data : [])
      setClients(list)
      // Fetch businesses for each client
      fetch('/api/businesses').then(r => r.json()).then(bd => {
        const allBiz = bd?.businesses || []
        const grouped: Record<number, { id: number; name: string; avatar_color: string }[]> = {}
        for (const biz of allBiz) {
          if (biz.client_id) {
            if (!grouped[biz.client_id]) grouped[biz.client_id] = []
            grouped[biz.client_id].push({ id: biz.id, name: biz.name, avatar_color: biz.avatar_color })
          }
        }
        setClientBusinesses(grouped)
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  // Sync settings
  useEffect(() => {
    if (settings.meetingTaskScope !== undefined) {
      setScope(settings.meetingTaskScope as string)
      setScopeDirty(false)
    }
  }, [settings.meetingTaskScope])

  useEffect(() => {
    if (settings.meetingClientKeywords && typeof settings.meetingClientKeywords === 'object') {
      setKeywords(settings.meetingClientKeywords as Record<string, string>)
    }
  }, [settings.meetingClientKeywords])

  useEffect(() => {
    if (settings.meetingBusinessKeywords && typeof settings.meetingBusinessKeywords === 'object') {
      setBizKeywords(settings.meetingBusinessKeywords as Record<string, string>)
    }
  }, [settings.meetingBusinessKeywords])

  function saveKeywords(name: string, value: string) {
    const next = { ...keywords, [name]: value }
    setKeywords(next)
    update('meetingClientKeywords', next)
    setKeywordsDirty(prev => { const n = new Set(prev); n.delete(name); return n })
  }

  function saveBizKeywords(clientName: string, bizName: string, value: string) {
    const key = `${clientName}::${bizName}`
    const next = { ...bizKeywords, [key]: value }
    setBizKeywords(next)
    update('meetingBusinessKeywords', next)
    setBizKeywordsDirty(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-text-dim">
        Controls how Plaud meeting transcripts are automatically processed. When a recording arrives, AI cleans the transcript, identifies the client, and creates tasks.
      </p>

      <div className="space-y-1">
        <Toggle
          checked={(settings.meetingAutoProcess as boolean) ?? true}
          onChange={v => update('meetingAutoProcess', v)}
          label="Auto-process new recordings"
        />
        <p className="text-[12px] text-text-dim pl-0.5">Automatically run AI on every new Plaud transcript</p>
      </div>

      <div className="space-y-1">
        <Toggle
          checked={(settings.meetingAutoCreateTasks as boolean) ?? true}
          onChange={v => update('meetingAutoCreateTasks', v)}
          label="Auto-create tasks from action items"
        />
        <p className="text-[12px] text-text-dim pl-0.5">Extracted action items become tasks in your workspace</p>
      </div>

      <div className="space-y-1">
        <Toggle
          checked={(settings.meetingAutoDispatch as boolean) ?? true}
          onChange={v => update('meetingAutoDispatch', v)}
          label="Auto-dispatch pointer to Jimmy (Mac)"
        />
        <p className="text-[12px] text-text-dim pl-0.5">After processing, send a short pointer to Jimmy via Tailscale so he can follow up on Telegram</p>
      </div>

      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary">Minimum dispatch urgency</label>
        <p className="text-[12px] text-text-dim">Triage decides urgency per meeting. Anything below this threshold is archived on the app but not pushed to Jimmy.</p>
        <select
          value={(settings.meetingDispatchMinUrgency as string) || 'medium'}
          onChange={e => update('meetingDispatchMinUrgency', e.target.value)}
          className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent appearance-none cursor-pointer"
        >
          <option value="low">Low -- push everything triage approves</option>
          <option value="medium">Medium -- push normal+urgent items (recommended)</option>
          <option value="high">High -- only push fire-level issues</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary">Model</label>
        <p className="text-[12px] text-text-dim">Which AI model processes your meeting transcripts.</p>
        <select
          value={(settings.meetingModel as string) || 'anthropic/claude-sonnet-4-6'}
          onChange={e => update('meetingModel', e.target.value)}
          className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent appearance-none cursor-pointer"
        >
          <optgroup label="Anthropic">
            <option value="anthropic/claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5 (faster, cheaper)</option>
            <option value="anthropic/claude-opus-4-6">Claude Opus 4.6 (most capable)</option>
          </optgroup>
          <optgroup label="OpenAI">
            <option value="openai/gpt-4.1">GPT-4.1</option>
            <option value="openai/gpt-4.1-mini">GPT-4.1 Mini</option>
          </optgroup>
          <optgroup label="Google">
            <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (fast, cheap)</option>
            <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
          </optgroup>
          <optgroup label="Other">
            <option value="deepseek/deepseek-v3.2">DeepSeek V3.2</option>
          </optgroup>
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary">Task Scope</label>
        <p className="text-[12px] text-text-dim">Comma-separated categories. AI will only extract tasks that fall within these areas.</p>
        <textarea
          value={scope}
          onChange={e => { setScope(e.target.value); setScopeDirty(true) }}
          onBlur={() => { if (scopeDirty) { update('meetingTaskScope', scope); setScopeDirty(false) } }}
          rows={3}
          className="w-full rounded-md border border-border bg-elevated px-3 py-2 text-[13px] text-text placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          placeholder="Marketing & Meta Ads, Funnels, Technology & Automation..."
        />
        {scopeDirty && <span className="text-[11px] text-text-dim">Unsaved -- click outside to save</span>}
      </div>

      <div className="space-y-3 pt-2 border-t border-border">
        <div>
          <label className="text-[13px] font-medium text-text-secondary">Client Matching</label>
          <p className="text-[12px] text-text-dim mt-0.5">Add keywords per client to help the AI identify who a meeting is about. Clients sync from your Clients page -- add a new client there and it appears here automatically.</p>
        </div>

        {/* Personal section */}
        <div className="rounded-lg border border-border bg-elevated p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-[#7a6b55]">
              P
            </div>
            <span className="text-[13px] font-medium text-text">Personal</span>
            <span className="text-[10px] text-text-dim ml-auto">default if no client match</span>
          </div>
          <input
            type="text"
            value={keywords['Personal'] || ''}
            onChange={e => {
              setKeywords(prev => ({ ...prev, Personal: e.target.value }))
              setKeywordsDirty(prev => new Set(prev).add('Personal'))
            }}
            onBlur={() => { if (keywordsDirty.has('Personal')) saveKeywords('Personal', keywords['Personal'] || '') }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            placeholder="internal, team, personal, strategy, planning..."
            className="w-full rounded border border-border/60 bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-text placeholder-text-dim/50 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {clients.length === 0 && (
          <p className="text-[12px] text-text-dim italic py-2">No clients yet. Add clients from the sidebar to configure matching keywords.</p>
        )}

        <div className="space-y-2">
          {clients.sort((a, b) => a.name.localeCompare(b.name)).map(client => {
            const value = keywords[client.name] || ''
            const isDirty = keywordsDirty.has(client.name)

            return (
              <div key={client.id} className="rounded-lg border border-border bg-elevated p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ background: client.avatar_color || '#555' }}
                    >
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-[13px] font-medium text-text">{client.name}</span>
                  </div>
                  {isDirty && <span className="text-[10px] text-text-dim">unsaved</span>}
                </div>
                <input
                  type="text"
                  value={value}
                  onChange={e => {
                    setKeywords(prev => ({ ...prev, [client.name]: e.target.value }))
                    setKeywordsDirty(prev => new Set(prev).add(client.name))
                  }}
                  onBlur={() => { if (isDirty) saveKeywords(client.name, value) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                  placeholder="Names, topics, business names..."
                  className="w-full rounded border border-border/60 bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-text placeholder-text-dim/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />

                {/* Nested businesses */}
                {(clientBusinesses[client.id] || []).map(biz => {
                  const bizKey = `${client.name}::${biz.name}`
                  const bizValue = bizKeywords[bizKey] || ''
                  const bizDirty = bizKeywordsDirty.has(bizKey)
                  return (
                    <div key={biz.id} className="ml-5 rounded-md border border-border/40 bg-[var(--bg)] p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                          style={{ background: biz.avatar_color || '#555' }}
                        >
                          {biz.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[12px] font-medium text-text-secondary">{biz.name}</span>
                        {bizDirty && <span className="text-[9px] text-text-dim ml-auto">unsaved</span>}
                      </div>
                      <input
                        type="text"
                        value={bizValue}
                        onChange={e => {
                          setBizKeywords(prev => ({ ...prev, [bizKey]: e.target.value }))
                          setBizKeywordsDirty(prev => new Set(prev).add(bizKey))
                        }}
                        onBlur={() => { if (bizDirty) saveBizKeywords(client.name, biz.name, bizValue) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        placeholder={`Keywords for ${biz.name}...`}
                        className="w-full rounded border border-border/40 bg-transparent px-2 py-1 text-[11px] text-text placeholder-text-dim/50 focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EmailIngestSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const [apiKey, setApiKey] = useState('')
  const [justGenerated, setJustGenerated] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const hasKey = !!(settings.emailIngestApiKey as string)
  const webhookUrl = 'https://app.example.com/api/email-ingest'

  async function generateKey() {
    const newKey = `ctrlei_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`
    setApiKey(newKey)
    setJustGenerated(true)
    await update('emailIngestApiKey', newKey)
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-text-dim">Forward emails to create tasks automatically. Send a POST request with email data and tasks appear in your board.</p>

      {/* Webhook URL */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Webhook URL</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={webhookUrl}
            readOnly
            className="flex-1 bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text font-mono"
          />
          <button
            onClick={() => copyToClipboard(webhookUrl, 'url')}
            className="px-3 py-1.5 bg-hover text-text text-[13px] font-medium rounded-md hover:bg-border shrink-0"
          >
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <SectionDivider />

      {/* API Key */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">API Key</h3>
        <p className="text-[13px] text-text-dim">Required for authentication. Send as <code className="text-accent-text">Authorization: Bearer &lt;key&gt;</code></p>
        {justGenerated ? (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiKey}
                readOnly
                className="flex-1 bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text font-mono"
              />
              <button
                onClick={() => copyToClipboard(apiKey, 'key')}
                className="px-3 py-1.5 bg-hover text-text text-[13px] font-medium rounded-md hover:bg-border shrink-0"
              >
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[13px] text-orange-400">Copy this key now. It won&apos;t be shown again.</p>
          </>
        ) : hasKey ? (
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-text-secondary">Key configured</span>
            <span className="font-mono text-[13px] text-text-dim">ctrlei_****...****</span>
            <button
              onClick={generateKey}
              className="px-3 py-1.5 bg-red-500/20 text-red-400 text-[13px] font-medium rounded-md hover:bg-red-500/30"
            >
              Regenerate
            </button>
          </div>
        ) : (
          <button
            onClick={generateKey}
            className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
          >
            Generate API Key
          </button>
        )}
      </div>

      <SectionDivider />

      {/* Payload format */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Payload Format</h3>
        <pre className="bg-field border border-border rounded-md p-3 text-[13px] text-text-secondary font-mono overflow-x-auto whitespace-pre">{`POST ${webhookUrl}
Authorization: Bearer <your-key>
Content-Type: application/json

{
  "from": "sender@example.com",
  "subject": "[ProjectName] Task title here",
  "body": "Email body text...",
  "html": "<p>Optional HTML body</p>"
}`}</pre>
        <ul className="text-[13px] text-text-dim space-y-1 mt-2">
          <li>Subject becomes the task title. Use <code className="text-accent-text">[ProjectName]</code> prefix to tag a project.</li>
          <li>Body is trimmed to 500 chars for the task description.</li>
          <li>Tasks are created with status &quot;todo&quot; and priority &quot;medium&quot;.</li>
        </ul>
      </div>
    </div>
  )
}

function IntegrationsSection() {
  const [copied, setCopied] = useState<string | null>(null)
  const [webhooks, setWebhooks] = useState<Array<{ id: number; name: string; url: string; events: string[]; enabled: number; last_triggered: number | null; last_status: number | null; failure_count: number }>>([])
  const [tokens, setTokens] = useState<Array<{ id: number; name: string; token: string; scopes: string[]; last_used: number | null; created_at: number }>>([])
  const [availableEvents, setAvailableEvents] = useState<string[]>([])
  const [availableScopes, setAvailableScopes] = useState<string[]>([])
  const [newWebhook, setNewWebhook] = useState({ name: '', url: '', events: ['*'] as string[], secret: '' })
  const [newToken, setNewToken] = useState({ name: '', scopes: ['*'] as string[] })
  const [showNewWebhook, setShowNewWebhook] = useState(false)
  const [showNewToken, setShowNewToken] = useState(false)
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null)
  const [tab, setTab] = useState<'zapier' | 'webhooks' | 'feeds'>('zapier')

  useEffect(() => {
    loadData()
  }, [])

  function loadData() {
    fetch('/api/webhooks').then(r => r.json()).then(d => {
      setWebhooks(d.webhooks || [])
      setAvailableEvents(d.availableEvents || [])
      setAvailableScopes(d.availableScopes || [])
    }).catch(() => {})
    fetch('/api/webhooks?type=tokens').then(r => r.json()).then(d => {
      setTokens(d.tokens || [])
    }).catch(() => {})
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function createWebhookHandler() {
    if (!newWebhook.name || !newWebhook.url) return
    await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newWebhook),
    })
    setNewWebhook({ name: '', url: '', events: ['*'], secret: '' })
    setShowNewWebhook(false)
    loadData()
  }

  async function createTokenHandler() {
    if (!newToken.name) return
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'token', ...newToken }),
    })
    const data = await res.json()
    setJustCreatedToken(data.token)
    setNewToken({ name: '', scopes: ['*'] })
    setShowNewToken(false)
    loadData()
  }

  async function toggleWebhook(id: number, enabled: boolean) {
    await fetch('/api/webhooks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: enabled ? 1 : 0 }),
    })
    loadData()
  }

  async function deleteItem(id: number, type: 'webhook' | 'token') {
    await fetch(`/api/webhooks?id=${id}&type=${type}`, { method: 'DELETE' })
    loadData()
  }

  function toggleScope(scope: string) {
    setNewToken(prev => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter(s => s !== scope)
        : [...prev.scopes.filter(s => s !== '*'), scope],
    }))
  }

  function toggleEvent(event: string) {
    setNewWebhook(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events.filter(e => e !== '*'), event],
    }))
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-text-dim">Connect Zapier, webhooks, and external services to Motion Lite.</p>

      {/* Tabs */}
      <div className="flex gap-1 bg-hover rounded-lg p-0.5">
        {(['zapier', 'webhooks', 'feeds'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-[13px] py-1.5 rounded-md transition-colors capitalize ${tab === t ? 'bg-elevated text-text font-medium' : 'text-text-dim hover:text-text'}`}
          >
            {t === 'zapier' ? 'Zapier / API Tokens' : t === 'feeds' ? 'Feeds & Links' : 'Webhooks'}
          </button>
        ))}
      </div>

      {tab === 'zapier' && (
        <div className="space-y-4">
          {/* Zapier setup guide */}
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
            <h3 className="text-[13px] font-medium text-text">Zapier Connection</h3>
            <p className="text-[13px] text-text-dim leading-relaxed">
              Use API tokens to connect Motion Lite to Zapier. Create one token for tasks/docs/projects access,
              and another for importing Plaud transcriptions or meeting notes.
            </p>
            <div className="space-y-1.5">
              <p className="text-[13px] text-text-secondary font-medium">API Endpoints:</p>
              <div className="space-y-1 font-mono text-[10px]">
                <div className="flex gap-2 items-center">
                  <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">GET/POST/PATCH/DEL</span>
                  <span className="text-text-dim">{baseUrl}/api/external/tasks</span>
                  <button onClick={() => copyToClipboard(`${baseUrl}/api/external/tasks`, 'tasks-url')} className="text-accent hover:underline text-[10px]">
                    {copied === 'tasks-url' ? 'copied' : 'copy'}
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">GET/POST/PATCH</span>
                  <span className="text-text-dim">{baseUrl}/api/external/docs</span>
                  <button onClick={() => copyToClipboard(`${baseUrl}/api/external/docs`, 'docs-url')} className="text-accent hover:underline text-[10px]">
                    {copied === 'docs-url' ? 'copied' : 'copy'}
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">GET</span>
                  <span className="text-text-dim">{baseUrl}/api/external/projects</span>
                  <button onClick={() => copyToClipboard(`${baseUrl}/api/external/projects`, 'proj-url')} className="text-accent hover:underline text-[10px]">
                    {copied === 'proj-url' ? 'copied' : 'copy'}
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded text-[9px]">GET/POST/PATCH/DEL</span>
                  <span className="text-text-dim">{baseUrl}/api/external/meetings</span>
                  <button onClick={() => copyToClipboard(`${baseUrl}/api/external/meetings`, 'meet-url')} className="text-accent hover:underline text-[10px]">
                    {copied === 'meet-url' ? 'copied' : 'copy'}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-text-dim mt-2">
                Auth: <code className="bg-hover px-1 py-0.5 rounded">Authorization: Bearer ctrl_...</code>
              </p>
            </div>
          </div>

          {/* Created token banner */}
          {justCreatedToken && (
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 space-y-2">
              <p className="text-[13px] text-orange-400 font-medium">Token created - copy it now, it won&apos;t be shown again:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={justCreatedToken}
                  className="flex-1 bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text font-mono outline-none"
                />
                <button
                  onClick={() => { copyToClipboard(justCreatedToken, 'new-token'); }}
                  className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
                >
                  {copied === 'new-token' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={() => setJustCreatedToken(null)} className="text-[13px] text-text-dim hover:text-text">Dismiss</button>
            </div>
          )}

          {/* Tokens list */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-medium text-text">API Tokens</h3>
                <p className="text-[13px] text-text-dim">Bearer tokens for Zapier and external integrations</p>
              </div>
              <button
                onClick={() => setShowNewToken(true)}
                className="px-2.5 py-1 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
              >
                + New Token
              </button>
            </div>

            {showNewToken && (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-elevated">
                <input
                  type="text"
                  placeholder="Token name (e.g. Zapier Tasks, Plaud Import)"
                  value={newToken.name}
                  onChange={e => setNewToken(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                />
                <div>
                  <p className="text-[13px] text-text-secondary mb-1.5">Scopes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableScopes.map(scope => (
                      <button
                        key={scope}
                        onClick={() => toggleScope(scope)}
                        className={`text-[13px] px-2 py-1 rounded-md border transition-colors ${
                          newToken.scopes.includes(scope)
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border text-text-dim hover:text-text'
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createTokenHandler} className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80">Create</button>
                  <button onClick={() => setShowNewToken(false)} className="px-3 py-1.5 text-text-dim text-[13px] hover:text-text">Cancel</button>
                </div>
              </div>
            )}

            {tokens.length === 0 && !showNewToken && (
              <p className="text-[13px] text-text-dim py-2">No tokens yet. Create one to connect Zapier.</p>
            )}

            {tokens.map(t => (
              <div key={t.id} className="flex items-center justify-between border border-border rounded-lg p-3">
                <div>
                  <div className="text-[13px] text-text font-medium">{t.name}</div>
                  <div className="text-[10px] text-text-dim font-mono">{t.token}</div>
                  <div className="flex gap-2 mt-1">
                    {(t.scopes || []).map((s: string) => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 bg-hover rounded text-text-dim">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {t.last_used && <span className="text-[10px] text-text-dim">Used {new Date(t.last_used * 1000).toLocaleDateString()}</span>}
                  <button onClick={() => deleteItem(t.id, 'token')} className="text-[13px] text-red-400 hover:text-red-300">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'webhooks' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-medium text-text">Outbound Webhooks</h3>
                <p className="text-[13px] text-text-dim">POST notifications when events happen in Motion Lite</p>
              </div>
              <button
                onClick={() => setShowNewWebhook(true)}
                className="px-2.5 py-1 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
              >
                + New Webhook
              </button>
            </div>

            {showNewWebhook && (
              <div className="border border-border rounded-lg p-3 space-y-3 bg-elevated">
                <input
                  type="text"
                  placeholder="Webhook name"
                  value={newWebhook.name}
                  onChange={e => setNewWebhook(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                />
                <input
                  type="url"
                  placeholder="https://hooks.zapier.com/..."
                  value={newWebhook.url}
                  onChange={e => setNewWebhook(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                />
                <input
                  type="text"
                  placeholder="Signing secret (optional)"
                  value={newWebhook.secret}
                  onChange={e => setNewWebhook(prev => ({ ...prev, secret: e.target.value }))}
                  className="w-full bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                />
                <div>
                  <p className="text-[13px] text-text-secondary mb-1.5">Events:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableEvents.map(event => (
                      <button
                        key={event}
                        onClick={() => toggleEvent(event)}
                        className={`text-[13px] px-2 py-1 rounded-md border transition-colors ${
                          newWebhook.events.includes(event)
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border text-text-dim hover:text-text'
                        }`}
                      >
                        {event}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createWebhookHandler} className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80">Create</button>
                  <button onClick={() => setShowNewWebhook(false)} className="px-3 py-1.5 text-text-dim text-[13px] hover:text-text">Cancel</button>
                </div>
              </div>
            )}

            {webhooks.length === 0 && !showNewWebhook && (
              <p className="text-[13px] text-text-dim py-2">No webhooks configured.</p>
            )}

            {webhooks.map(w => (
              <div key={w.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${w.enabled ? (w.failure_count > 5 ? 'bg-orange-400' : 'bg-green-400') : 'bg-zinc-500'}`} />
                    <span className="text-[13px] text-text font-medium">{w.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleWebhook(w.id, !w.enabled)}
                      className={`text-[13px] px-2 py-0.5 rounded border ${w.enabled ? 'border-green-500/30 text-green-400' : 'border-border text-text-dim'}`}
                    >
                      {w.enabled ? 'Active' : 'Disabled'}
                    </button>
                    <button onClick={() => deleteItem(w.id, 'webhook')} className="text-[13px] text-red-400 hover:text-red-300">Delete</button>
                  </div>
                </div>
                <div className="text-[10px] text-text-dim font-mono truncate">{w.url}</div>
                <div className="flex gap-1.5 flex-wrap">
                  {(w.events || []).map((e: string) => (
                    <span key={e} className="text-[9px] px-1.5 py-0.5 bg-hover rounded text-text-dim">{e}</span>
                  ))}
                </div>
                {w.last_triggered && (
                  <div className="text-[10px] text-text-dim">
                    Last fired: {new Date(w.last_triggered * 1000).toLocaleString()}
                    {w.last_status ? ` (${w.last_status})` : ''}
                    {w.failure_count > 0 && <span className="text-orange-400 ml-1">{w.failure_count} failures</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border/50 p-3">
            <p className="text-[13px] text-text-dim leading-relaxed">
              Webhooks send POST requests with <code className="bg-hover px-1 py-0.5 rounded text-[10px] font-mono">{'{ event, timestamp, data }'}</code>.
              If a signing secret is set, requests include <code className="bg-hover px-1 py-0.5 rounded text-[10px] font-mono">X-Webhook-Signature</code> (HMAC-SHA256).
              Auto-disabled after 10 consecutive failures.
            </p>
          </div>
        </div>
      )}

      {tab === 'feeds' && (
        <div className="space-y-4">
          {/* iCal Feed */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div>
              <h3 className="text-[13px] font-medium text-text">iCal Feed</h3>
              <p className="text-[13px] text-text-dim">Subscribe to your scheduled tasks in any calendar app.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${baseUrl}/api/calendar/ical`}
                className="flex-1 bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text-dim font-mono outline-none"
              />
              <button
                onClick={() => copyToClipboard(`${baseUrl}/api/calendar/ical`, 'ical')}
                className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
              >
                {copied === 'ical' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Booking Page */}
          <div className="rounded-lg border border-border glass p-4 space-y-3">
            <div>
              <h3 className="text-[13px] font-medium text-text">Booking Page</h3>
              <p className="text-[13px] text-text-dim">Share this link so visitors can book meetings based on your availability.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={`${baseUrl}/booking`}
                className="flex-1 bg-hover border border-border rounded-md px-3 py-1.5 text-[13px] text-text-dim font-mono outline-none"
              />
              <button
                onClick={() => copyToClipboard(`${baseUrl}/booking`, 'booking')}
                className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
              >
                {copied === 'booking' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApiSection() {
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [justGenerated, setJustGenerated] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      if (s.apiKey) setHasKey(true)
    }).catch(() => {})
  }, [])

  async function generateKey() {
    const newKey = `ctrlm_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`
    setKey(newKey)
    setJustGenerated(true)
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setHasKey(true)
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-dim">API key for external integrations.</p>
      {justGenerated ? (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={key}
              readOnly
              className="flex-1 bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text font-mono"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(key) }}
              className="px-3 py-1.5 bg-hover text-text text-[13px] font-medium rounded-md hover:bg-border"
            >
              Copy
            </button>
          </div>
          <p className="text-[13px] text-orange-400">Copy this key now. It won&apos;t be shown again.</p>
        </>
      ) : hasKey ? (
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-text-secondary">API key exists</span>
          <span className="font-mono text-[13px] text-text-dim">ctrlm_****...****</span>
          <button
            onClick={generateKey}
            className="px-3 py-1.5 bg-red-500/20 text-red-400 text-[13px] font-medium rounded-md hover:bg-red-500/30"
          >
            Regenerate
          </button>
        </div>
      ) : (
        <button
          onClick={generateKey}
          className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
        >
          Generate API Key
        </button>
      )}
    </div>
  )
}

interface KnowledgeEntry {
  id: number
  type: 'text' | 'url'
  title: string
  content: string | null
  url: string | null
  workspace_id: number | null
  private: number
  created_at: number
}

function AiKnowledgeSection() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<'text' | 'url'>('text')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formPrivate, setFormPrivate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/knowledge')
      .then(r => r.json())
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function resetForm() {
    setFormTitle('')
    setFormContent('')
    setFormUrl('')
    setFormType('text')
    setFormPrivate(false)
    setShowForm(false)
  }

  async function handleSave() {
    if (!formTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          title: formTitle.trim(),
          content: formType === 'text' ? formContent.trim() : null,
          url: formType === 'url' ? formUrl.trim() : null,
          private: formPrivate,
        }),
      })
      const entry = await res.json()
      setEntries(prev => [entry, ...prev])
      resetForm()
    } catch { /* */ }
    setSaving(false)
  }

  async function handleDelete(id: number) {
    setDeleting(id)
    try {
      await fetch('/api/knowledge', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch { /* */ }
    setDeleting(null)
  }

  function formatDate(ts: number): string {
    const d = new Date(ts * 1000)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  }

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-text-dim">
        Add knowledge entries that the AI assistant can reference when answering questions, scheduling, and creating tasks. These get included as context in every AI chat.
      </p>

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80 transition-colors"
        >
          + Add Knowledge
        </button>
      )}

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg border border-border p-4 space-y-4 glass">
          {/* Type toggle */}
          <div className="flex gap-1 bg-bg rounded-md p-0.5 w-fit">
            <button
              onClick={() => setFormType('text')}
              className={`px-3 py-1.5 text-[13px] font-medium rounded transition-colors ${
                formType === 'text' ? 'bg-card text-text' : 'text-text-dim hover:text-text'
              }`}
            >
              Text
            </button>
            <button
              onClick={() => setFormType('url')}
              className={`px-3 py-1.5 text-[13px] font-medium rounded transition-colors ${
                formType === 'url' ? 'bg-card text-text' : 'text-text-dim hover:text-text'
              }`}
            >
              URL
            </button>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Title</label>
            <input
              type="text"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="e.g. Client scheduling rules"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
            />
          </div>

          {/* Content or URL */}
          {formType === 'url' ? (
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">URL</label>
              <input
                type="url"
                value={formUrl}
                onChange={e => setFormUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Content</label>
              <textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                placeholder="Enter knowledge content..."
                rows={4}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim resize-y"
              />
            </div>
          )}

          {/* Private toggle */}
          <Toggle checked={formPrivate} onChange={setFormPrivate} label="Private (not shared with team)" />

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !formTitle.trim()}
              className="px-4 py-2 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 text-[13px] text-text-dim hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Entries list */}
      {loading ? (
        <p className="text-[13px] text-text-dim">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-text-dim">No knowledge entries yet. Add information the AI can reference during chats.</p>
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className="flex items-start justify-between rounded-lg border border-border p-3 gap-3 group hover:border-border-strong transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-medium text-text truncate">{e.title}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    e.type === 'url'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-accent text-white font-bold'
                  }`}>
                    {e.type === 'url' ? 'URL' : 'TEXT'}
                  </span>
                  {e.private === 1 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400 flex-shrink-0">
                      PRIVATE
                    </span>
                  )}
                </div>
                {e.type === 'url' && e.url && (
                  <p className="text-[13px] text-text-dim truncate">{e.url}</p>
                )}
                {e.type === 'text' && e.content && (
                  <p className="text-[13px] text-text-dim line-clamp-2">{e.content}</p>
                )}
                <p className="text-[10px] text-text-dim mt-1.5">{formatDate(e.created_at)}</p>
              </div>
              <button
                onClick={() => handleDelete(e.id)}
                disabled={deleting === e.id}
                className="text-[13px] text-text-dim hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 pt-0.5"
              >
                {deleting === e.id ? '...' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface BookingLinkData {
  id: number
  name: string
  slug: string
  durations: string
  custom_hours: string | null
  daily_limit: number
  start_delay_days: number
  one_time: number
  buffer_before: number
  buffer_after: number
  active: number
  created_at: number
  questions: string | null
}

function BookingSection({ settings, update }: { settings: Record<string, unknown>; update: (k: string, v: unknown) => void }) {
  const [links, setLinks] = useState<BookingLinkData[]>([])
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    durations: '30',
    daily_limit: 0,
    start_delay_days: 0,
    one_time: false,
    buffer_before: 0,
    buffer_after: 0,
    questions: '',
  })
  const [formError, setFormError] = useState('')

  useEffect(() => {
    fetch('/api/booking/links').then(r => r.json()).then(d => setLinks(Array.isArray(d) ? d : [])).catch(() => setLinks([]))
  }, [])

  function generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Name and slug are required')
      return
    }
    setFormError('')
    const durations = form.durations.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
    if (durations.length === 0) {
      setFormError('At least one valid duration required')
      return
    }
    const res = await fetch('/api/booking/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        slug: form.slug.trim(),
        durations,
        daily_limit: form.daily_limit,
        start_delay_days: form.start_delay_days,
        one_time: form.one_time,
        buffer_before: form.buffer_before,
        buffer_after: form.buffer_after,
        questions: form.questions.trim() ? JSON.stringify(form.questions.trim().split('\n').filter(Boolean).map(l => ({ label: l.trim(), type: 'text' }))) : undefined,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setLinks([data, ...links])
      setCreating(false)
      setForm({ name: '', slug: '', durations: '30', daily_limit: 0, start_delay_days: 0, one_time: false, buffer_before: 0, buffer_after: 0, questions: '' })
    } else {
      setFormError(data.error || 'Failed to create')
    }
  }

  async function toggleActive(link: BookingLinkData) {
    const newActive = link.active ? 0 : 1
    const res = await fetch('/api/booking/links', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: link.id, active: newActive }),
    })
    if (res.ok) {
      setLinks(links.map(l => l.id === link.id ? { ...l, active: newActive } : l))
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this booking link?')) return
    await fetch('/api/booking/links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setLinks(links.filter(l => l.id !== id))
  }

  function copyUrl(link: BookingLinkData) {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://app.example.com'
    navigator.clipboard.writeText(`${base}/booking/${link.slug}`)
    setCopied(link.id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-text-dim">Create shareable booking links with custom durations, availability, and limits. Replaces external tools like Calendly.</p>

      {/* Existing links */}
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map(link => {
            const durations: number[] = (() => { try { return JSON.parse(link.durations) } catch { return [30] } })()
            return (
              <div key={link.id} className="flex items-center gap-3 rounded-lg border border-border p-3 group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text truncate">{link.name}</span>
                    {link.one_time === 1 && (
                      <span className="text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">One-time</span>
                    )}
                    {!link.active && (
                      <span className="text-[10px] text-red bg-red/10 border border-red/20 px-1.5 py-0.5 rounded">Inactive</span>
                    )}
                  </div>
                  <div className="text-[13px] text-text-dim mt-0.5">
                    /booking/{link.slug} -- {durations.map(d => `${d}min`).join(', ')}
                    {link.daily_limit > 0 && ` -- max ${link.daily_limit}/day`}
                    {link.buffer_before > 0 && ` -- ${link.buffer_before}min buffer before`}
                    {link.buffer_after > 0 && ` -- ${link.buffer_after}min buffer after`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => copyUrl(link)}
                    className="px-2 py-1 text-[13px] rounded border border-border text-text-secondary hover:bg-hover transition-colors"
                  >
                    {copied === link.id ? 'Copied!' : 'Copy URL'}
                  </button>
                  <button
                    onClick={() => toggleActive(link)}
                    className={`relative w-8 h-4.5 rounded-full transition-colors ${link.active ? 'bg-accent' : 'bg-border-strong'}`}
                    title={link.active ? 'Deactivate' : 'Activate'}
                  >
                    <span className={`absolute top-[2px] left-[2px] w-3.5 h-3.5 rounded-full bg-white transition-transform ${link.active ? 'translate-x-3.5' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(link.id)}
                    className="px-1.5 py-1 text-[13px] text-red hover:bg-red/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {links.length === 0 && !creating && (
        <div className="text-center py-6 border border-dashed border-border rounded-lg">
          <p className="text-[13px] text-text-dim mb-2">No booking links yet</p>
          <p className="text-[13px] text-text-dim">Create one to start accepting bookings</p>
        </div>
      )}

      {/* Create form */}
      {creating ? (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <h3 className="text-[13px] font-medium text-text">New Booking Link</h3>
          <div className="space-y-2">
            <label className="text-[13px] text-text-dim">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => {
                const name = e.target.value
                setForm(f => ({ ...f, name, slug: f.slug === generateSlug(f.name) ? generateSlug(name) : f.slug }))
              }}
              placeholder="e.g. Discovery Call"
              className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[13px] text-text-dim">Slug (URL path)</label>
            <div className="flex items-center gap-1">
              <span className="text-[13px] text-text-dim">/booking/</span>
              <input
                type="text"
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder="discovery-call"
                className="flex-1 bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[13px] text-text-dim">Durations (comma-separated minutes)</label>
            <input
              type="text"
              value={form.durations}
              onChange={e => setForm(f => ({ ...f, durations: e.target.value }))}
              placeholder="15, 30, 60"
              className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[13px] text-text-dim">Daily limit (0 = unlimited)</label>
              <input
                type="number"
                min={0}
                value={form.daily_limit}
                onChange={e => setForm(f => ({ ...f, daily_limit: parseInt(e.target.value) || 0 }))}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[13px] text-text-dim">Start delay (days)</label>
              <input
                type="number"
                min={0}
                value={form.start_delay_days}
                onChange={e => setForm(f => ({ ...f, start_delay_days: parseInt(e.target.value) || 0 }))}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[13px] text-text-dim">Buffer before (min)</label>
              <input
                type="number"
                min={0}
                value={form.buffer_before}
                onChange={e => setForm(f => ({ ...f, buffer_before: parseInt(e.target.value) || 0 }))}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[13px] text-text-dim">Buffer after (min)</label>
              <input
                type="number"
                min={0}
                value={form.buffer_after}
                onChange={e => setForm(f => ({ ...f, buffer_after: parseInt(e.target.value) || 0 }))}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={form.one_time}
              onChange={e => setForm(f => ({ ...f, one_time: e.target.checked }))}
              className="accent-accent"
            />
            <span className="text-[13px] text-text-secondary">One-time use (expires after first booking)</span>
          </label>

          <div>
            <label className="text-[13px] text-text-dim block mb-1">Invitee questions (one per line, optional)</label>
            <textarea
              value={form.questions}
              onChange={e => setForm(f => ({ ...f, questions: e.target.value }))}
              rows={3}
              placeholder="What would you like to discuss?\nHow did you hear about us?"
              className="w-full glass-input rounded-md px-3 py-2 text-[13px] text-text resize-none"
            />
            <p className="text-[10px] text-text-dim mt-1">Each line becomes a text question on the booking form.</p>
          </div>

          {formError && <p className="text-[13px] text-red">{formError}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleCreate}
              className="px-4 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/90 transition-colors"
            >
              Create Link
            </button>
            <button
              onClick={() => { setCreating(false); setFormError('') }}
              className="px-4 py-1.5 border border-border text-text-secondary text-[13px] rounded-md hover:bg-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/90 transition-colors"
        >
          + New Booking Link
        </button>
      )}

      <SectionDivider />

      {/* Legacy settings */}
      <h3 className="text-[13px] font-medium text-text">Message Template</h3>
      <div className="space-y-2">
        <label className="text-[13px] text-text-dim">Availability message template</label>
        <textarea
          value={settings.bookingMessage as string ?? ''}
          onChange={e => update('bookingMessage', e.target.value)}
          rows={5}
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim font-mono resize-y"
        />
        <p className="text-[13px] text-text-dim">Variables: $Meeting times$, $Booking link$, $Timezone$, $Duration$</p>
      </div>
    </div>
  )
}

function ProfileSection() {
  const [profile, setProfile] = useState<{
    name: string; email: string; avatar_url: string | null; banner_url: string | null;
    bio: string | null; pronouns: string | null; display_role: string | null;
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const avatarInputRef = { current: null as HTMLInputElement | null }
  const bannerInputRef = { current: null as HTMLInputElement | null }

  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(setProfile).catch(() => {})
  }, [])

  async function uploadImage(file: File, type: 'avatar' | 'banner') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('type', type)
    const res = await fetch('/api/profile/upload', { method: 'POST', body: fd })
    if (res.ok) {
      const data = await res.json()
      setProfile(prev => prev ? { ...prev, [type === 'avatar' ? 'avatar_url' : 'banner_url']: data.url } : prev)
    }
  }

  async function saveProfile() {
    if (!profile) return
    setSaving(true)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profile.name,
        bio: profile.bio || '',
        pronouns: profile.pronouns || '',
        display_role: profile.display_role || '',
      }),
    })
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    setSaving(false)
  }

  async function handleDeleteAll() {
    if (!window.confirm('Are you sure you want to delete ALL tasks, chunks, and activity data? This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch('/api/settings/data', { method: 'DELETE' })
    if (res.ok) { setDeleted(true); setTimeout(() => setDeleted(false), 3000) }
    setDeleting(false)
  }

  if (!profile) return <div className="text-text-dim text-sm">Loading profile...</div>

  const initials = profile.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Banner</h3>
        <div
          onClick={() => bannerInputRef.current?.click()}
          className="relative w-full h-[120px] rounded-xl overflow-hidden cursor-pointer group border border-border"
          style={{ background: profile.banner_url ? `url(${profile.banner_url}) center/cover` : 'linear-gradient(135deg, var(--accent) 0%, #1a3a2a 100%)' }}
        >
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <span className="text-white text-[14px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              Change banner
            </span>
          </div>
        </div>
        <input ref={el => { bannerInputRef.current = el }} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, 'banner') }} />
      </div>

      {/* Avatar */}
      <div className="space-y-2">
        <h3 className="text-[16px] font-semibold text-text">Profile picture</h3>
        <div className="flex items-center gap-4">
          <div
            onClick={() => avatarInputRef.current?.click()}
            className="relative w-20 h-20 rounded-full overflow-hidden cursor-pointer group border-2 border-border"
            style={{ background: profile.avatar_url ? `url(${profile.avatar_url}) center/cover` : 'var(--accent)' }}
          >
            {!profile.avatar_url && (
              <div className="flex items-center justify-center w-full h-full">
                <span className="text-[24px] font-bold text-white">{initials}</span>
              </div>
            )}
            {profile.avatar_url && <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
          </div>
          <div className="text-[13px] text-text-dim">Click to upload a profile picture</div>
        </div>
        <input ref={el => { avatarInputRef.current = el }} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, 'avatar') }} />
      </div>

      <SectionDivider />

      {/* Name */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary block">Display name</label>
        <input
          type="text" value={profile.name}
          onChange={e => setProfile({ ...profile, name: e.target.value })}
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
        />
      </div>

      {/* Email (read-only) */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary block">Email</label>
        <input
          type="text" value={profile.email} readOnly
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text-dim outline-none cursor-not-allowed"
        />
      </div>

      {/* Role */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary block">Role / Title</label>
        <input
          type="text" value={profile.display_role || ''} placeholder="e.g. Founder, Marketing Director"
          onChange={e => setProfile({ ...profile, display_role: e.target.value })}
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim/40"
        />
      </div>

      {/* Pronouns */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary block">Pronouns</label>
        <input
          type="text" value={profile.pronouns || ''} placeholder="e.g. he/him, she/her, they/them"
          onChange={e => setProfile({ ...profile, pronouns: e.target.value })}
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim/40"
        />
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-text-secondary block">Bio</label>
        <textarea
          value={profile.bio || ''} placeholder="Write a short bio..."
          onChange={e => setProfile({ ...profile, bio: e.target.value })}
          rows={3}
          className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim/40 resize-none"
        />
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveProfile} disabled={saving}
          className="px-4 py-2 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save profile'}
        </button>
        {saved && <span className="text-[13px] text-accent-text">Saved</span>}
      </div>

      <SectionDivider />

      {/* Data export */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">Data</h3>
        <p className="text-[13px] text-text-dim">Export or delete your workspace data.</p>
        <a href="/api/settings/data" download
          className="inline-block px-3 py-1.5 border border-border text-text-secondary text-[13px] rounded-md hover:bg-hover transition-colors">
          Export all data (JSON)
        </a>
      </div>

      <SectionDivider />

      {/* Danger zone */}
      <div className="space-y-3">
        <h3 className="text-[14px] font-medium text-red">Danger zone</h3>
        <p className="text-[13px] text-text-dim">Irreversible actions. Proceed with caution.</p>
        <button onClick={handleDeleteAll} disabled={deleting}
          className="px-3 py-1.5 border border-red/30 text-red text-[13px] rounded-md hover:bg-red/10 transition-colors disabled:opacity-50">
          {deleting ? 'Deleting...' : 'Delete all data'}
        </button>
        {deleted && <p className="text-[13px] text-accent-text">All task data deleted.</p>}
      </div>
    </div>
  )
}

interface TaskTemplateData {
  id: number
  name: string
  description: string | null
  default_title: string | null
  default_priority: string
  default_duration_minutes: number
  default_status: string
  subtasks: string | null
  workspace_id: number | null
  created_at: number
}

function TaskTemplatesSection() {
  const [templates, setTemplates] = useState<TaskTemplateData[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    default_title: '',
    default_priority: 'medium',
    default_duration_minutes: 30,
    default_status: 'todo',
    subtasks: [] as { title: string; duration_minutes: number; priority: string }[],
  })
  const [subtaskDraft, setSubtaskDraft] = useState('')

  useEffect(() => {
    fetch('/api/templates/tasks').then(r => r.json()).then(d => setTemplates(Array.isArray(d) ? d : [])).catch(() => setTemplates([]))
  }, [])

  async function handleCreate() {
    if (!form.name.trim()) return
    const res = await fetch('/api/templates/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        description: form.description || undefined,
        default_title: form.default_title || undefined,
        default_priority: form.default_priority,
        default_duration_minutes: form.default_duration_minutes,
        default_status: form.default_status,
        subtasks: form.subtasks.length > 0 ? form.subtasks : undefined,
      }),
    })
    const tmpl = await res.json()
    setTemplates(prev => [...prev, tmpl])
    setForm({ name: '', description: '', default_title: '', default_priority: 'medium', default_duration_minutes: 30, default_status: 'todo', subtasks: [] })
    setCreating(false)
  }

  async function handleDelete(id: number) {
    await fetch('/api/templates/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  function addSubtask() {
    if (!subtaskDraft.trim()) return
    setForm(prev => ({
      ...prev,
      subtasks: [...prev.subtasks, { title: subtaskDraft.trim(), duration_minutes: 30, priority: 'medium' }],
    }))
    setSubtaskDraft('')
  }

  function removeSubtask(index: number) {
    setForm(prev => ({ ...prev, subtasks: prev.subtasks.filter((_, i) => i !== index) }))
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-text-dim">Create reusable task templates with pre-filled fields and optional subtasks.</p>

      {templates.length === 0 && !creating && (
        <p className="text-[13px] text-text-dim">No task templates yet.</p>
      )}

      {templates.map(t => {
        const subs = t.subtasks ? JSON.parse(t.subtasks) as { title: string; duration_minutes: number; priority: string }[] : []
        return (
          <div key={t.id} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-text">{t.name}</div>
                {t.description && <div className="text-[13px] text-text-dim">{t.description}</div>}
              </div>
              <button onClick={() => handleDelete(t.id)} className="text-[13px] text-red hover:underline">Delete</button>
            </div>
            <div className="flex items-center gap-3 text-[13px] text-text-dim">
              {t.default_title && <span>Title: {t.default_title}</span>}
              <span>{PRIORITY_LABELS[t.default_priority] || t.default_priority}</span>
              <span>{t.default_duration_minutes}m</span>
              <span>{t.default_status}</span>
            </div>
            {subs.length > 0 && (
              <div className="pl-3 border-l border-border/50 space-y-0.5">
                {subs.map((s, i) => (
                  <div key={i} className="text-[13px] text-text-secondary flex items-center gap-2">
                    <span className="text-text-dim">-</span>
                    <span>{s.title}</span>
                    <span className="text-text-dim">{s.duration_minutes}m</span>
                    <span className="text-text-dim">{PRIORITY_LABELS[s.priority] || s.priority}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80"
        >
          Create Template
        </button>
      ) : (
        <div className="rounded-lg border border-accent/30 bg-elevated p-4 space-y-3">
          <div className="text-[13px] font-medium text-text-dim uppercase tracking-wide">New Task Template</div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-text-dim">Template name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Client Onboarding Call"
              className="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-text-dim">Description</label>
            <input
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="What is this template for?"
              className="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] text-text-dim">Default task title</label>
            <input
              value={form.default_title}
              onChange={e => setForm(prev => ({ ...prev, default_title: e.target.value }))}
              placeholder="Leave blank to use template name"
              className="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="space-y-1.5 flex-1">
              <label className="text-[13px] text-text-dim">Priority</label>
              <Dropdown
                value={form.default_priority}
                onChange={(v) => setForm(prev => ({ ...prev, default_priority: v }))}
                options={[
                  { value: 'urgent', label: 'ASAP' },
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' },
                ]}
                triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                minWidth={140}
              />
            </div>
            <div className="space-y-1.5 w-24">
              <label className="text-[13px] text-text-dim">Duration (min)</label>
              <input
                type="number"
                value={form.default_duration_minutes}
                onChange={e => setForm(prev => ({ ...prev, default_duration_minutes: Number(e.target.value) }))}
                min={5}
                max={480}
                className="w-full bg-hover border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent/50 text-right"
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <label className="text-[13px] text-text-dim">Status</label>
              <Dropdown
                value={form.default_status}
                onChange={(v) => setForm(prev => ({ ...prev, default_status: v }))}
                options={[
                  { value: 'backlog', label: 'Backlog' },
                  { value: 'todo', label: 'To Do' },
                  { value: 'in_progress', label: 'In Progress' },
                ]}
                triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                minWidth={140}
              />
            </div>
          </div>

          {/* Subtasks */}
          <div className="space-y-2">
            <label className="text-[13px] text-text-dim">Subtasks</label>
            {form.subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <span className="text-text-dim">-</span>
                <span className="text-text-secondary flex-1">{s.title}</span>
                <span className="text-text-dim">{s.duration_minutes}m</span>
                <button onClick={() => removeSubtask(i)} className="text-[10px] text-red hover:underline">x</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={subtaskDraft}
                onChange={e => setSubtaskDraft(e.target.value)}
                placeholder="Add subtask..."
                className="flex-1 bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
                onKeyDown={e => { if (e.key === 'Enter') addSubtask() }}
              />
              <button onClick={addSubtask} className="text-[13px] text-accent-text hover:underline">Add</button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => setCreating(false)} className="px-3 py-1 rounded-md text-[13px] text-text-dim hover:bg-hover">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!form.name.trim()}
              className="px-3 py-1 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/80 disabled:opacity-50"
            >
              Save Template
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Workspace Settings (Statuses + Labels) ───

interface WsStatus { id: number; workspace_id: number; name: string; color: string; sort_order: number; auto_schedule_disabled?: number }
interface WsLabel { id: number; workspace_id: number; name: string; color: string; sort_order: number }
interface WsOption { id: number; name: string; color?: string; description?: string; is_private?: number; slug?: string }
interface WsCustomField { id: number; workspace_id: number; name: string; field_type: string; options: string | null; sort_order: number }

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'url', label: 'URL' },
  { value: 'date', label: 'Date' },
  { value: 'person', label: 'Person' },
  { value: 'multi_person', label: 'Multi-Person' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-Select' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'related_to', label: 'Related To' },
]

const COLOR_PRESETS = APP_COLORS.map(c => c.value)

function WorkspaceSettingsSection() {
  const [workspaces, setWorkspaces] = useState<WsOption[]>([])
  const [selectedWs, setSelectedWs] = useState<number | null>(null)
  const [statuses, setStatuses] = useState<WsStatus[]>([])
  const [labels, setLabels] = useState<WsLabel[]>([])
  const [customFields, setCustomFields] = useState<WsCustomField[]>([])
  const [newStatusName, setNewStatusName] = useState('')
  const [newStatusColor, setNewStatusColor] = useState('#4285f4')
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState('#7a6b55')
  const [editingStatus, setEditingStatus] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [wsTab, setWsTab] = useState<'overview' | 'members' | 'statuses' | 'labels' | 'custom-fields'>('overview')

  // Members state
  const [members, setMembers] = useState<Array<{ id: number; email: string; name: string; avatar_url: string | null; role: string; joined_at: number; member_type?: string }>>([])
  const [agents, setAgents] = useState<Array<{ id: number; name: string; role: string; member_type: string; color: string; avatar: string | null }>>([])
  const [invitations, setInvitations] = useState<Array<{ id: number; email: string; name: string | null; role: string; status: string; created_at: number; expires_at: number }>>([])
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)

  // Overview editing
  const [wsName, setWsName] = useState('')
  const [wsColor, setWsColor] = useState('')
  const [wsDesc, setWsDesc] = useState('')
  const [wsSaving, setWsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Custom fields
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('text')

  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then((ws: WsOption[]) => {
      setWorkspaces(ws)
      // Auto-select workspace from URL param (e.g. /settings?section=workspace&ws=abc123 or ws=202)
      const urlWs = new URLSearchParams(window.location.search).get('ws')
      if (urlWs) {
        const match = ws.find((w: any) => w.public_id === urlWs || w.id === Number(urlWs))
        if (match) setSelectedWs(match.id)
      } else if (ws.length > 0) {
        setSelectedWs(ws[0].id)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedWs) return
    fetch(`/api/workspaces/statuses?workspaceId=${selectedWs}`).then(r => r.json()).then(d => setStatuses(Array.isArray(d) ? d : [])).catch(() => setStatuses([]))
    fetch(`/api/workspaces/labels?workspaceId=${selectedWs}`).then(r => r.json()).then(d => setLabels(Array.isArray(d) ? d : [])).catch(() => setLabels([]))
    fetch(`/api/workspaces/custom-fields?workspaceId=${selectedWs}`).then(r => r.json()).then((d: WsCustomField[]) => setCustomFields(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`/api/workspaces/${selectedWs}/invite`).then(r => r.json()).then(d => {
      if (d?.users) { setMembers(d.users); setAgents(d.agents || []) }
      else if (Array.isArray(d)) { setMembers(d); setAgents([]) }
      else { setMembers([]); setAgents([]) }
    }).catch(() => { setMembers([]); setAgents([]) })
    fetch(`/api/invitations?workspaceId=${selectedWs}`).then(r => r.json()).then(d => setInvitations(Array.isArray(d) ? d : [])).catch(() => setInvitations([]))
    // Load workspace details for overview
    const ws = workspaces.find(w => w.id === selectedWs)
    if (ws) {
      setWsName(ws.name || '')
      setWsColor(ws.color || '#7a6b55')
      setWsDesc(ws.description || '')
    }
  }, [selectedWs, workspaces])

  // ─── Status CRUD ───
  async function addStatus() {
    if (!newStatusName.trim() || !selectedWs) return
    const res = await fetch('/api/workspaces/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: selectedWs, name: newStatusName.trim(), color: newStatusColor }),
    })
    const s = await res.json()
    setStatuses(prev => [...prev, s])
    setNewStatusName('')
  }

  async function saveStatusEdit(id: number) {
    await fetch('/api/workspaces/statuses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: editName, color: editColor }),
    })
    setStatuses(prev => prev.map(s => s.id === id ? { ...s, name: editName, color: editColor } : s))
    setEditingStatus(null)
  }

  async function removeStatus(id: number) {
    await fetch('/api/workspaces/statuses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setStatuses(prev => prev.filter(s => s.id !== id))
  }

  async function moveStatus(id: number, direction: 'up' | 'down') {
    const idx = statuses.findIndex(s => s.id === id)
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === statuses.length - 1)) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const a = statuses[idx]
    const b = statuses[swapIdx]
    await Promise.all([
      fetch('/api/workspaces/statuses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, sort_order: b.sort_order }) }),
      fetch('/api/workspaces/statuses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, sort_order: a.sort_order }) }),
    ])
    const next = [...statuses]
    next[idx] = { ...b, sort_order: a.sort_order }
    next[swapIdx] = { ...a, sort_order: b.sort_order }
    next.sort((x, y) => x.sort_order - y.sort_order)
    setStatuses(next)
  }

  // ─── Label CRUD ───
  async function addLabel() {
    if (!newLabelName.trim() || !selectedWs) return
    const res = await fetch('/api/workspaces/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: selectedWs, name: newLabelName.trim(), color: newLabelColor }),
    })
    const l = await res.json()
    setLabels(prev => [...prev, l])
    setNewLabelName('')
  }

  async function saveLabelEdit(id: number) {
    await fetch('/api/workspaces/labels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: editName, color: editColor }),
    })
    setLabels(prev => prev.map(l => l.id === id ? { ...l, name: editName, color: editColor } : l))
    setEditingLabel(null)
  }

  async function removeLabel(id: number) {
    await fetch('/api/workspaces/labels', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setLabels(prev => prev.filter(l => l.id !== id))
  }

  async function moveLabel(id: number, direction: 'up' | 'down') {
    const idx = labels.findIndex(l => l.id === id)
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === labels.length - 1)) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const a = labels[idx]
    const b = labels[swapIdx]
    await Promise.all([
      fetch('/api/workspaces/labels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, sort_order: b.sort_order }) }),
      fetch('/api/workspaces/labels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, sort_order: a.sort_order }) }),
    ])
    const next = [...labels]
    next[idx] = { ...b, sort_order: a.sort_order }
    next[swapIdx] = { ...a, sort_order: b.sort_order }
    next.sort((x, y) => x.sort_order - y.sort_order)
    setLabels(next)
  }

  // ─── Overview CRUD ───
  async function saveOverview() {
    if (!selectedWs) return
    setWsSaving(true)
    await fetch('/api/workspaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedWs, name: wsName, color: wsColor, description: wsDesc }),
    })
    setWorkspaces(prev => prev.map(w => w.id === selectedWs ? { ...w, name: wsName, color: wsColor, description: wsDesc } : w))
    setWsSaving(false)
    // Propagate changes to sidebar and task view
    window.dispatchEvent(new CustomEvent('sidebar-refresh'))
    window.dispatchEvent(new CustomEvent('workspace-updated', { detail: { id: selectedWs, name: wsName, color: wsColor } }))
  }

  async function handleDeleteWorkspace() {
    if (!selectedWs) return
    await fetch(`/api/workspaces?id=${selectedWs}`, { method: 'DELETE' })
    const remaining = workspaces.filter(w => w.id !== selectedWs)
    setWorkspaces(remaining)
    setSelectedWs(remaining.length > 0 ? remaining[0].id : null)
    setConfirmDelete(false)
  }

  // ─── Auto-schedule toggle ───
  async function toggleAutoScheduleDisabled(statusId: number, current: number) {
    const next = current ? 0 : 1
    await fetch('/api/workspaces/statuses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: statusId, auto_schedule_disabled: next }),
    })
    setStatuses(prev => prev.map(s => s.id === statusId ? { ...s, auto_schedule_disabled: next } : s))
  }

  // ─── Custom Field CRUD ───
  async function addCustomField() {
    if (!newFieldName.trim() || !selectedWs) return
    const res = await fetch('/api/workspaces/custom-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: selectedWs, name: newFieldName.trim(), fieldType: newFieldType }),
    })
    const f = await res.json()
    setCustomFields(prev => [...prev, f])
    setNewFieldName('')
    setNewFieldType('text')
  }

  async function removeCustomField(id: number) {
    await fetch(`/api/workspaces/custom-fields?id=${id}`, { method: 'DELETE' })
    setCustomFields(prev => prev.filter(f => f.id !== id))
  }

  function startEdit(type: 'status' | 'label', item: { id: number; name: string; color: string }) {
    setEditName(item.name)
    setEditColor(item.color)
    if (type === 'status') { setEditingStatus(item.id); setEditingLabel(null) }
    else { setEditingLabel(item.id); setEditingStatus(null) }
  }

  if (workspaces.length === 0) {
    return <p className="text-[13px] text-text-dim">No workspaces found. Create a workspace first.</p>
  }

  const selectedWsData = workspaces.find(w => w.id === selectedWs)
  const isPrivate = selectedWsData?.is_private === 1

  return (
    <div className="space-y-6">
      {/* Workspace selector */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Workspace</label>
        <Dropdown
          value={selectedWs != null ? String(selectedWs) : ''}
          onChange={(v) => setSelectedWs(Number(v))}
          options={workspaces.map(w => ({ value: String(w.id), label: `${w.name}${w.is_private ? ' (Private)' : ''}` }))}
          triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
          minWidth={180}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {(['overview', 'members', 'statuses', 'labels', 'custom-fields'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setWsTab(tab)}
            className={`px-3 py-1.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              wsTab === tab ? 'border-accent text-text' : 'border-transparent text-text-dim hover:text-text-secondary'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'members' ? 'Members' : tab === 'statuses' ? 'Statuses' : tab === 'labels' ? 'Labels' : 'Custom Fields'}
          </button>
        ))}
      </div>

      {/* ─── Members Tab ─── */}
      {wsTab === 'members' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[16px] font-semibold text-text">Workspace Members</h3>
              <p className="text-[13px] text-text-dim mt-0.5">Manage who has access to this workspace.</p>
            </div>
            {!isPrivate && (
              <button
                onClick={() => { setShowInviteModal(true); setInviteEmail(''); setInviteName(''); setInviteRole('member'); setInviteError(null); setInviteSuccess(false) }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80"
              >
                <IconPlus size={12} />
                Invite
              </button>
            )}
          </div>

          {isPrivate && (
            <div className="px-3 py-2 rounded-lg text-[13px] text-yellow-400" style={{ background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)' }}>
              Private workspaces can only have the owner as a member.
            </div>
          )}

          {/* Current members */}
          <div className="space-y-1">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3 group hover:border-border-strong transition-colors">
                <Avatar name={m.name || m.email} size={36} src={m.avatar_url} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text truncate">{m.name || 'Unnamed'}</div>
                  <div className="text-[13px] text-text-dim truncate">{m.email}</div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                  m.role === 'owner' ? 'bg-accent/15 text-accent' :
                  m.role === 'admin' ? 'bg-blue-500/15 text-blue-400' :
                  m.role === 'client' ? 'bg-purple-500/15 text-purple-400' :
                  'bg-white/5 text-text-dim'
                }`}>
                  {m.role}
                </span>
              </div>
            ))}
            {members.length === 0 && <p className="text-[13px] text-text-dim py-2">No members yet.</p>}
          </div>

          {/* AI Agents */}
          {agents.length > 0 && (
            <div>
              <h4 className="text-[13px] font-semibold text-text-dim mb-2">AI Agents</h4>
              <div className="space-y-1">
                {agents.map(a => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border p-3 group hover:border-border-strong transition-colors">
                    <Avatar name={a.name} size={36} src={a.avatar} color={a.color} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{a.name}</div>
                      <div className="text-[13px] text-text-dim truncate">{a.role}</div>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-white font-bold">agent</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending invitations */}
          {invitations.filter(i => i.status === 'pending').length > 0 && (
            <div>
              <h4 className="text-[13px] font-semibold text-text-dim mb-2">Pending Invitations</h4>
              <div className="space-y-1">
                {invitations.filter(i => i.status === 'pending').map(inv => (
                  <div key={inv.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 group hover:border-border-strong transition-colors">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center text-[14px] shrink-0">✉</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text truncate">{inv.name || inv.email}</div>
                      <div className="text-[13px] text-text-dim truncate">{inv.email}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-400 uppercase tracking-wider">{inv.role}</span>
                    <button
                      onClick={async () => {
                        await fetch('/api/invitations', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.id }) })
                        setInvitations(prev => prev.filter(i => i.id !== inv.id))
                      }}
                      className="text-[13px] text-text-dim hover:text-red opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invite Modal */}
          {showInviteModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setShowInviteModal(false)}>
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div className="relative w-full max-w-[420px] rounded-xl overflow-hidden" style={{ background: '#1a1b1e', border: '1px solid rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
                <div className="px-6 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <h3 className="text-[16px] font-semibold text-text">Invite to {selectedWsData?.name}</h3>
                </div>
                <div className="px-6 py-5 space-y-4">
                  <label className="block">
                    <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider block mb-1.5">Email</span>
                    <input
                      autoFocus value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      placeholder="name@company.com" type="email"
                      className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider block mb-1.5">Name (optional)</span>
                    <input
                      value={inviteName} onChange={e => setInviteName(e.target.value)}
                      placeholder="Their name"
                      className="w-full bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[13px] text-text-dim font-medium uppercase tracking-wider block mb-1.5">Role</span>
                    <Dropdown
                      value={inviteRole}
                      onChange={(v) => setInviteRole(v)}
                      options={[
                        { value: 'member', label: 'Member - Full access' },
                        { value: 'admin', label: 'Admin - Full access + manage members' },
                        { value: 'client', label: 'Client - Limited view (projects, reports)' },
                      ]}
                      triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                      minWidth={160}
                    />
                  </label>
                  {inviteError && <p className="text-[13px] text-red-400">{inviteError}</p>}
                  {inviteSuccess && <p className="text-[13px] text-accent">Invite sent!</p>}
                </div>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <button onClick={() => setShowInviteModal(false)} className="px-4 py-1.5 text-[13px] text-text-dim hover:text-text transition-colors">Cancel</button>
                  <button
                    onClick={async () => {
                      if (!inviteEmail.trim()) return
                      setInviteSending(true); setInviteError(null); setInviteSuccess(false)
                      try {
                        const res = await fetch('/api/invitations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim() || undefined, workspaceId: selectedWs, role: inviteRole }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error || 'Failed to send')
                        setInvitations(prev => [data, ...prev])
                        setInviteSuccess(true)
                        setTimeout(() => setShowInviteModal(false), 1500)
                      } catch (err: unknown) {
                        setInviteError(err instanceof Error ? err.message : 'Failed to send invite')
                      } finally { setInviteSending(false) }
                    }}
                    disabled={!inviteEmail.trim() || inviteSending}
                    className="px-4 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80 disabled:opacity-40"
                  >
                    {inviteSending ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Overview Tab ─── */}
      {wsTab === 'overview' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Name</label>
              <input
                value={wsName}
                onChange={e => setWsName(e.target.value)}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Description</label>
              <textarea
                value={wsDesc}
                onChange={e => setWsDesc(e.target.value)}
                rows={2}
                className="w-full bg-field border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent resize-none"
                placeholder="What is this workspace for?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-dim font-medium uppercase tracking-wider">Color</label>
              <div className="flex flex-wrap items-center gap-2">
                {APP_COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setWsColor(c.value)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md border transition-colors hover:bg-hover ${wsColor === c.value ? 'border-text bg-hover' : 'border-transparent'}`}
                    title={c.name}
                  >
                    <span className="w-4 h-4 rounded-[3px] shrink-0" style={{ background: c.value }} />
                    <span className="text-[13px] text-text">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={saveOverview}
              disabled={wsSaving}
              className="px-4 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80 disabled:opacity-40"
            >
              {wsSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          {isPrivate && (
            <div className="rounded-md border border-border px-4 py-3 bg-elevated">
              <p className="text-[13px] text-text-dim">This is your private workspace. Tasks and docs here are only visible to you.</p>
            </div>
          )}

          {!isPrivate && (
            <>
              <SectionDivider />
              <div className="space-y-3">
                <h3 className="text-[14px] font-semibold text-red-400">Danger Zone</h3>
                {confirmDelete ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-text-secondary">Are you sure? This will delete all projects, tasks, and docs in this workspace.</span>
                    <button onClick={handleDeleteWorkspace} className="px-3 py-1 bg-red-500 text-white text-[13px] font-medium rounded-md">Yes, delete</button>
                    <button onClick={() => setConfirmDelete(false)} className="px-3 py-1 text-[13px] text-text-dim hover:text-text">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-4 py-1.5 border border-red-500/30 text-red-400 text-[13px] font-medium rounded-md hover:bg-red-500/10"
                  >
                    Delete Workspace
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Statuses Tab ─── */}
      {wsTab === 'statuses' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-[16px] font-semibold text-text">Custom Statuses</h3>
            <p className="text-[13px] text-text-dim mt-1">Define task statuses. Toggle auto-scheduling per status.</p>
          </div>

          <div className="space-y-1">
            {statuses.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-2 group rounded-md border border-border px-3 py-2 hover:border-border-strong transition-colors">
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => moveStatus(s.id, 'up')} disabled={idx === 0} className="text-text-dim hover:text-text disabled:opacity-20 leading-none text-[10px]">&#9650;</button>
                  <button onClick={() => moveStatus(s.id, 'down')} disabled={idx === statuses.length - 1} className="text-text-dim hover:text-text disabled:opacity-20 leading-none text-[10px]">&#9660;</button>
                </div>

                {editingStatus === s.id ? (
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="w-5 h-5 rounded-full border-0 cursor-pointer bg-transparent p-0" />
                ) : (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                )}

                {editingStatus === s.id ? (
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveStatusEdit(s.id); if (e.key === 'Escape') setEditingStatus(null) }}
                    className="flex-1 bg-hover border border-border rounded px-2 py-0.5 text-[13px] text-text outline-none focus:border-accent"
                  />
                ) : (
                  <span className="flex-1 text-[13px] text-text">{s.name}</span>
                )}

                {/* Auto-schedule toggle */}
                <button
                  onClick={() => toggleAutoScheduleDisabled(s.id, s.auto_schedule_disabled || 0)}
                  className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${s.auto_schedule_disabled ? 'bg-border-strong' : 'bg-accent'}`}
                  title={s.auto_schedule_disabled ? 'Auto-scheduling disabled for this status' : 'Auto-scheduling enabled'}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.auto_schedule_disabled ? 'left-0.5' : 'left-4'}`} />
                </button>
                <span className="text-[10px] text-text-dim w-12 shrink-0">{s.auto_schedule_disabled ? 'No auto' : 'Auto'}</span>

                {editingStatus === s.id ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => saveStatusEdit(s.id)} className="text-[13px] text-accent-text hover:underline">Save</button>
                    <button onClick={() => setEditingStatus(null)} className="text-[13px] text-text-dim hover:text-text">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit('status', s)} className="text-[13px] text-text-dim hover:text-text">Edit</button>
                    <button onClick={() => removeStatus(s.id)} className="text-[13px] text-text-dim hover:text-red">Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input type="color" value={newStatusColor} onChange={e => setNewStatusColor(e.target.value)} className="w-6 h-6 rounded-full border border-border cursor-pointer bg-transparent p-0" />
            <input
              value={newStatusName} onChange={e => setNewStatusName(e.target.value)} placeholder="New status name..."
              onKeyDown={e => { if (e.key === 'Enter') addStatus() }}
              className="flex-1 bg-field border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
            />
            <button onClick={addStatus} disabled={!newStatusName.trim()} className="px-3 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80 disabled:opacity-40">Add</button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-dim mr-1">Presets:</span>
            {COLOR_PRESETS.map(c => (
              <button key={c} onClick={() => setNewStatusColor(c)} className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 ${newStatusColor === c ? 'border-text scale-110' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Labels Tab ─── */}
      {wsTab === 'labels' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-[16px] font-semibold text-text">Labels</h3>
            <p className="text-[13px] text-text-dim mt-1">Create labels to categorize and filter tasks in this workspace.</p>
          </div>

          <div className="space-y-1">
            {labels.map((l, idx) => (
              <div key={l.id} className="flex items-center gap-2 group rounded-md border border-border px-3 py-2 hover:border-border-strong transition-colors">
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => moveLabel(l.id, 'up')} disabled={idx === 0} className="text-text-dim hover:text-text disabled:opacity-20 leading-none text-[10px]">&#9650;</button>
                  <button onClick={() => moveLabel(l.id, 'down')} disabled={idx === labels.length - 1} className="text-text-dim hover:text-text disabled:opacity-20 leading-none text-[10px]">&#9660;</button>
                </div>

                {editingLabel === l.id ? (
                  <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="w-5 h-5 rounded-full border-0 cursor-pointer bg-transparent p-0" />
                ) : (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                )}

                {editingLabel === l.id ? (
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveLabelEdit(l.id); if (e.key === 'Escape') setEditingLabel(null) }}
                    className="flex-1 bg-hover border border-border rounded px-2 py-0.5 text-[13px] text-text outline-none focus:border-accent"
                  />
                ) : (
                  <span className="flex-1 text-[13px] text-text">{l.name}</span>
                )}

                {editingLabel === l.id ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => saveLabelEdit(l.id)} className="text-[13px] text-accent-text hover:underline">Save</button>
                    <button onClick={() => setEditingLabel(null)} className="text-[13px] text-text-dim hover:text-text">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit('label', l)} className="text-[13px] text-text-dim hover:text-text">Edit</button>
                    <button onClick={() => removeLabel(l.id)} className="text-[13px] text-text-dim hover:text-red">Delete</button>
                  </div>
                )}
              </div>
            ))}
            {labels.length === 0 && <p className="text-[13px] text-text-dim py-2">No labels yet. Add one below.</p>}
          </div>

          <div className="flex items-center gap-2">
            <input type="color" value={newLabelColor} onChange={e => setNewLabelColor(e.target.value)} className="w-6 h-6 rounded-full border border-border cursor-pointer bg-transparent p-0" />
            <input
              value={newLabelName} onChange={e => setNewLabelName(e.target.value)} placeholder="New label name..."
              onKeyDown={e => { if (e.key === 'Enter') addLabel() }}
              className="flex-1 bg-field border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
            />
            <button onClick={addLabel} disabled={!newLabelName.trim()} className="px-3 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80 disabled:opacity-40">Add</button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-dim mr-1">Presets:</span>
            {COLOR_PRESETS.map(c => (
              <button key={c} onClick={() => setNewLabelColor(c)} className={`w-4 h-4 rounded-full border transition-transform hover:scale-125 ${newLabelColor === c ? 'border-text scale-110' : 'border-transparent'}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Custom Fields Tab ─── */}
      {wsTab === 'custom-fields' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-[16px] font-semibold text-text">Custom Fields</h3>
            <p className="text-[13px] text-text-dim mt-1">Add structured fields to tasks: text, URL, date, person, number, select, and more.</p>
          </div>

          <div className="space-y-1">
            {customFields.map(f => (
              <div key={f.id} className="flex items-center gap-3 group rounded-md border border-border px-3 py-2 hover:border-border-strong transition-colors">
                <span className="text-[13px] text-text flex-1">{f.name}</span>
                <span className="text-[13px] text-text-dim px-2 py-0.5 rounded bg-elevated">{FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}</span>
                <button onClick={() => removeCustomField(f.id)} className="text-[13px] text-text-dim hover:text-red opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
              </div>
            ))}
            {customFields.length === 0 && <p className="text-[13px] text-text-dim py-2">No custom fields yet.</p>}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={newFieldName} onChange={e => setNewFieldName(e.target.value)} placeholder="Field name..."
              onKeyDown={e => { if (e.key === 'Enter') addCustomField() }}
              className="flex-1 bg-field border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent"
            />
            <Dropdown
              value={newFieldType}
              onChange={(v) => setNewFieldType(v)}
              options={FIELD_TYPES}
              triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
              minWidth={120}
            />
            <button onClick={addCustomField} disabled={!newFieldName.trim()} className="px-3 py-1.5 bg-accent text-white text-[13px] font-bold rounded-md hover:bg-accent/80 disabled:opacity-40">Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

interface TeamMemberData {
  id: number
  name: string
  email: string | null
  role: string
  type: 'human' | 'agent'
  avatar: string | null
  color: string
  permissions: string
  schedule_id: number | null
  active: number
  created_at?: number
  workspaces?: { workspace_id: number; workspace_name: string; workspace_color: string; role: string }[]
}

interface WorkspaceOption {
  id: number
  name: string
  color: string
}

const PERMISSION_CATEGORIES = [
  {
    id: 'task_management',
    label: 'Task Management',
    icon: '☑',
    permissions: [
      { id: 'create_tasks', label: 'Create Tasks' },
      { id: 'update_tasks', label: 'Update Tasks' },
      { id: 'delete_tasks', label: 'Delete Tasks' },
      { id: 'assign_tasks', label: 'Assign Tasks' },
    ],
  },
  {
    id: 'projects_content',
    label: 'Projects & Content',
    icon: '◆',
    permissions: [
      { id: 'modify_projects', label: 'Modify Projects' },
      { id: 'create_docs', label: 'Create Docs' },
      { id: 'manage_sheets', label: 'Manage Database' },
      { id: 'manage_files', label: 'Manage Files' },
    ],
  },
  {
    id: 'calendar_scheduling',
    label: 'Calendar & Scheduling',
    icon: '📅',
    permissions: [
      { id: 'access_calendar', label: 'View Calendar' },
      { id: 'create_events', label: 'Create Events' },
      { id: 'manage_schedule', label: 'Manage Schedule' },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: '✉',
    permissions: [
      { id: 'send_emails', label: 'Send Emails' },
      { id: 'access_contacts', label: 'Access Contacts' },
      { id: 'manage_messages', label: 'Manage Messages' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: '⚙',
    permissions: [
      { id: 'manage_team', label: 'Manage Team' },
      { id: 'manage_settings', label: 'Manage Settings' },
      { id: 'view_reports', label: 'View Reports' },
      { id: 'manage_billing', label: 'Manage Billing' },
    ],
  },
]

const ALL_PERMISSIONS = PERMISSION_CATEGORIES.flatMap(c => c.permissions)

const MEMBER_COLORS = ['#7a6b55', '#4285f4', '#ff7043', '#7b68ee', '#f06292', '#26a69a', '#ffa726', '#ef5350', '#66bb6a', '#42a5f5', '#ab47bc', '#ec407a']

function PermissionGrid({ perms, onToggle }: { perms: string[]; onToggle: (perm: string) => void }) {
  const hasAll = perms.includes('all')
  return (
    <div className="space-y-3">
      {/* Full Access toggle */}
      <button
        onClick={() => onToggle('all')}
        className={`text-[13px] px-3 py-1.5 rounded-md border font-bold transition-colors ${hasAll ? 'bg-accent text-white border-accent' : 'border-border text-text-dim hover:bg-hover'}`}
      >
        Full Access
      </button>
      {!hasAll && (
        <div className="grid grid-cols-1 gap-2">
          {PERMISSION_CATEGORIES.map(cat => {
            const catPerms = cat.permissions.map(p => p.id)
            const allChecked = catPerms.every(p => perms.includes(p))
            const someChecked = catPerms.some(p => perms.includes(p))
            return (
              <div key={cat.id} className="border border-border/60 rounded-lg p-2.5 bg-surface/30">
                <button
                  onClick={() => {
                    if (allChecked) {
                      catPerms.forEach(p => { if (perms.includes(p)) onToggle(p) })
                    } else {
                      catPerms.forEach(p => { if (!perms.includes(p)) onToggle(p) })
                    }
                  }}
                  className="flex items-center gap-2 w-full text-left mb-1.5"
                >
                  <span className="text-[13px]">{cat.icon}</span>
                  <span className="text-[13px] font-semibold text-text flex-1">{cat.label}</span>
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
                    allChecked ? 'bg-accent border-accent text-white' : someChecked ? 'bg-accent/30 border-accent/50 text-accent' : 'border-border'
                  }`}>
                    {allChecked ? '✓' : someChecked ? '−' : ''}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1">
                  {cat.permissions.map(p => (
                    <button
                      key={p.id}
                      onClick={() => onToggle(p.id)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        perms.includes(p.id) ? 'bg-accent/80 text-white border-accent/60 font-medium' : 'border-border/50 text-text-dim hover:bg-hover/50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WorkspaceSelector({ selected, workspaces, onChange }: { selected: number[]; workspaces: WorkspaceOption[]; onChange: (ids: number[]) => void }) {
  const allSelected = workspaces.length > 0 && workspaces.every(ws => selected.includes(ws.id))
  return (
    <div className="space-y-1.5">
      <button
        onClick={() => onChange(allSelected ? [] : workspaces.map(ws => ws.id))}
        className={`text-[13px] px-3 py-1 rounded-md border font-bold transition-colors ${allSelected ? 'bg-accent text-white border-accent' : 'border-border text-text-dim hover:bg-hover'}`}
      >
        All Workspaces
      </button>
      <div className="flex flex-wrap gap-1.5">
        {workspaces.map(ws => {
          const isSelected = selected.includes(ws.id)
          return (
            <button
              key={ws.id}
              onClick={() => onChange(isSelected ? selected.filter(id => id !== ws.id) : [...selected, ws.id])}
              className={`flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-md border transition-colors ${
                isSelected ? 'border-accent/60 bg-accent/15 text-text font-medium' : 'border-border/50 text-text-dim hover:bg-hover/50'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ws.color }} />
              {ws.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TeamSection() {
  const [members, setMembers] = useState<TeamMemberData[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TeamMemberData | null>(null)
  const [editWsIds, setEditWsIds] = useState<number[]>([])
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [activeTab, setActiveTab] = useState<'members' | 'details'>('members')
  const [filterQuery, setFilterQuery] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [teamName, setTeamName] = useState('Example Co')
  const [autoJoin, setAutoJoin] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: '', type: 'human' as 'human' | 'agent', avatar: '', color: '#7a6b55', permissions: [] as string[], workspace_ids: [] as number[] })
  const [addingRoleForMemberId, setAddingRoleForMemberId] = useState<number | null>(null)
  const [newRoleValue, setNewRoleValue] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/team?include_inactive=1').then(r => r.json()),
      fetch('/api/workspaces').then(r => r.json()),
    ]).then(([teamData, wsData]) => {
      setMembers(Array.isArray(teamData) ? teamData : [])
      setWorkspaces(Array.isArray(wsData) ? wsData.map((w: any) => ({ id: w.id, name: w.name, color: w.color })) : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function refresh() {
    const data = await fetch('/api/team?include_inactive=1').then(r => r.json())
    setMembers(Array.isArray(data) ? data : [])
  }

  function startEditing(m: TeamMemberData) {
    setEditing(m)
    setEditPerms((() => { try { return JSON.parse(m.permissions || '[]') } catch { return [] } })())
    setEditWsIds(m.workspaces?.map(w => w.workspace_id) || [])
  }

  async function handleCreate() {
    if (!form.name.trim()) return
    await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        email: form.email || undefined,
        role: form.role || 'Team Member',
        type: form.type,
        avatar: form.avatar || form.name.charAt(0).toUpperCase(),
        color: form.color,
        permissions: form.permissions,
        workspace_ids: form.workspace_ids,
      }),
    })
    setForm({ name: '', email: '', role: '', type: 'human', avatar: '', color: '#7a6b55', permissions: [], workspace_ids: [] })
    setShowForm(false)
    refresh()
  }

  async function handleUpdate() {
    if (!editing) return
    await fetch('/api/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing.id,
        name: editing.name,
        email: editing.email,
        role: editing.role,
        type: editing.type,
        avatar: editing.avatar,
        color: editing.color,
        permissions: editPerms,
        active: editing.active,
        workspace_ids: editWsIds,
      }),
    })
    setEditing(null)
    refresh()
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this team member?')) return
    await fetch(`/api/team?id=${id}`, { method: 'DELETE' })
    refresh()
  }

  async function handleToggleActive(m: TeamMemberData) {
    await fetch('/api/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, active: m.active ? 0 : 1 }),
    })
    refresh()
  }

  function togglePerm(perms: string[], perm: string): string[] {
    if (perm === 'all') {
      return perms.includes('all') ? [] : ['all']
    }
    return perms.includes(perm) ? perms.filter(p => p !== perm) : [...perms.filter(p => p !== 'all'), perm]
  }

  function formatDate(ts?: number): string {
    if (!ts) return '--'
    const d = new Date(ts * 1000)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Build role options from existing member roles (no hardcoded list)
  const existingRoles = [...new Set(members.map(m => m.role).filter(r => r && r.trim()))]
  const ROLE_OPTIONS = [
    ...existingRoles.map(r => ({ value: r, label: r })),
    { value: '__add_role__', label: '+ Add role' },
  ]

  const MAX_WS_PILLS = 2

  const filteredMembers = filterQuery
    ? members.filter(m =>
        m.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        (m.email && m.email.toLowerCase().includes(filterQuery.toLowerCase())) ||
        m.role.toLowerCase().includes(filterQuery.toLowerCase())
      )
    : members

  if (loading) return <div className="text-[13px] text-text-dim">Loading team...</div>

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text">Team Settings</h3>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-[13px] font-semibold rounded-md hover:bg-accent/80 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="12" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          Invite Member
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border mb-4">
        <button
          onClick={() => setActiveTab('members')}
          className={`pb-2.5 text-[13px] font-medium transition-colors relative ${
            activeTab === 'members' ? 'text-text' : 'text-text-dim hover:text-text'
          }`}
        >
          Members
          {activeTab === 'members' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full" />}
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`pb-2.5 text-[13px] font-medium transition-colors relative ${
            activeTab === 'details' ? 'text-text' : 'text-text-dim hover:text-text'
          }`}
        >
          Details
          {activeTab === 'details' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full" />}
        </button>
      </div>

      {/* ── Invite Member Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-elevated border border-border rounded-xl p-5 w-full max-w-lg space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h4 className="text-[15px] font-semibold text-text">Invite Team Member</h4>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text">
                <IconX size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" placeholder="Full name" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Email</label>
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" placeholder="email@example.com" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Role</label>
                <input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" placeholder="e.g. Project Manager" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Type</label>
                <Dropdown
                  value={form.type}
                  onChange={(v) => setForm(f => ({ ...f, type: v as 'human' | 'agent' }))}
                  options={[
                    { value: 'human', label: 'Human' },
                    { value: 'agent', label: 'AI Agent' },
                  ]}
                  triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                  minWidth={140}
                />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Avatar</label>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-black shrink-0 overflow-hidden" style={{ background: form.color }}>
                    {form.avatar && form.avatar.startsWith('/uploads') ? (
                      <img src={form.avatar} className="w-full h-full object-cover" alt="" />
                    ) : (
                      form.avatar && form.avatar.length <= 2 ? form.avatar : form.name?.charAt(0) || '?'
                    )}
                  </div>
                  <label className="px-2.5 py-1 bg-elevated border border-border rounded-md text-[12px] text-text-dim hover:text-text cursor-pointer transition-colors">
                    Upload
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const fd = new FormData()
                      fd.append('file', file)
                      const res = await fetch('/api/uploads/avatar', { method: 'POST', body: fd })
                      const data = await res.json()
                      if (data.url) setForm(f => ({ ...f, avatar: data.url }))
                    }} />
                  </label>
                  {form.avatar && form.avatar.startsWith('/uploads') && (
                    <button onClick={() => setForm(f => ({ ...f, avatar: '' }))} className="text-[10px] text-text-dim hover:text-red-400">Remove</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {MEMBER_COLORS.map(c => (
                    <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))} className={`w-5 h-5 rounded-full border-2 transition-all ${form.color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-[12px] text-text-dim block mb-1.5">Workspace Access</label>
              <WorkspaceSelector selected={form.workspace_ids} workspaces={workspaces} onChange={ids => setForm(f => ({ ...f, workspace_ids: ids }))} />
            </div>
            <div>
              <label className="text-[12px] text-text-dim block mb-1.5">Permissions</label>
              <PermissionGrid perms={form.permissions} onToggle={p => setForm(f => ({ ...f, permissions: togglePerm(f.permissions, p) }))} />
            </div>
            <div className="flex gap-2 pt-1 border-t border-border">
              <button onClick={handleCreate} disabled={!form.name.trim()} className="px-4 py-1.5 bg-accent text-white text-[13px] font-semibold rounded-md hover:bg-accent/80 disabled:opacity-40 mt-3">Invite</button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-[13px] text-text-dim hover:text-text mt-3">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Member Modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-elevated border border-border rounded-xl p-5 w-full max-w-lg space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h4 className="text-[15px] font-semibold text-text">Edit: {editing.name}</h4>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text">
                <IconX size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Name</label>
                <input value={editing.name} onChange={e => setEditing(ed => ed ? { ...ed, name: e.target.value } : null)} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Email</label>
                <input value={editing.email || ''} onChange={e => setEditing(ed => ed ? { ...ed, email: e.target.value || null } : null)} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Role</label>
                <input value={editing.role} onChange={e => setEditing(ed => ed ? { ...ed, role: e.target.value } : null)} className="glass-input w-full px-2.5 py-1.5 text-[13px] rounded-md" />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Type</label>
                <Dropdown
                  value={editing.type}
                  onChange={(v) => setEditing(ed => ed ? { ...ed, type: v as 'human' | 'agent' } : null)}
                  options={[
                    { value: 'human', label: 'Human' },
                    { value: 'agent', label: 'AI Agent' },
                  ]}
                  triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                  minWidth={140}
                />
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Avatar</label>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-black shrink-0 overflow-hidden" style={{ background: editing.color }}>
                    {editing.avatar && editing.avatar.startsWith('/uploads') ? (
                      <img src={editing.avatar} className="w-full h-full object-cover" alt="" />
                    ) : (
                      editing.avatar && editing.avatar.length <= 2 ? editing.avatar : editing.name?.charAt(0) || '?'
                    )}
                  </div>
                  <label className="px-2.5 py-1 bg-elevated border border-border rounded-md text-[12px] text-text-dim hover:text-text cursor-pointer transition-colors">
                    Upload
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const fd = new FormData()
                      fd.append('file', file)
                      const res = await fetch('/api/uploads/avatar', { method: 'POST', body: fd })
                      const data = await res.json()
                      if (data.url) setEditing(ed => ed ? { ...ed, avatar: data.url } : null)
                    }} />
                  </label>
                  {editing.avatar && editing.avatar.startsWith('/uploads') && (
                    <button onClick={() => setEditing(ed => ed ? { ...ed, avatar: '' } : null)} className="text-[10px] text-text-dim hover:text-red-400">Remove</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[12px] text-text-dim block mb-1">Color</label>
                <div className="flex gap-1.5 flex-wrap">
                  {MEMBER_COLORS.map(c => (
                    <button key={c} onClick={() => setEditing(ed => ed ? { ...ed, color: c } : null)} className={`w-5 h-5 rounded-full border-2 transition-all ${editing.color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/30'}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-[12px] text-text-dim block mb-1.5">Workspace Access</label>
              <WorkspaceSelector selected={editWsIds} workspaces={workspaces} onChange={setEditWsIds} />
            </div>
            <div>
              <label className="text-[12px] text-text-dim block mb-1.5">Permissions</label>
              <PermissionGrid perms={editPerms} onToggle={p => setEditPerms(prev => togglePerm(prev, p))} />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[12px] text-text-dim">Active</label>
              <button onClick={() => setEditing(ed => ed ? { ...ed, active: ed.active ? 0 : 1 } : null)}
                className={`w-9 h-5 rounded-full relative transition-colors ${editing.active ? 'bg-accent' : 'bg-border'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${editing.active ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="flex gap-2 pt-1 border-t border-border">
              <button onClick={handleUpdate} className="px-4 py-1.5 bg-accent text-white text-[13px] font-semibold rounded-md hover:bg-accent/80 mt-3">Save</button>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-[13px] text-text-dim hover:text-text mt-3">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Members Tab ── */}
      {activeTab === 'members' && (
        <div>
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3">
            <button className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-text-dim border border-border rounded-md hover:bg-hover transition-colors">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
              Bulk edit role and workspaces
            </button>
            <div className="relative">
              <button
                onClick={() => setShowFilter(!showFilter)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-text-dim border border-border rounded-md hover:bg-hover transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                Filter list
              </button>
              {showFilter && (
                <input
                  autoFocus
                  value={filterQuery}
                  onChange={e => setFilterQuery(e.target.value)}
                  onBlur={() => { if (!filterQuery) setShowFilter(false) }}
                  placeholder="Search members..."
                  className="absolute top-full left-0 mt-1 glass-input px-2.5 py-1.5 text-[12px] rounded-md w-52 z-10"
                />
              )}
            </div>
            {filterQuery && (
              <button onClick={() => { setFilterQuery(''); setShowFilter(false) }} className="text-[11px] text-text-dim hover:text-text">
                Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_120px_1fr_auto] gap-0 px-3 py-2 bg-surface/30 border-b border-border">
              <span className="text-[11px] text-text-dim uppercase tracking-wider font-medium">Name</span>
              <span className="text-[11px] text-text-dim uppercase tracking-wider font-medium">Role</span>
              <span className="text-[11px] text-text-dim uppercase tracking-wider font-medium">Date Added</span>
              <span className="text-[11px] text-text-dim uppercase tracking-wider font-medium">Workspaces</span>
              <span className="w-[100px]" />
            </div>

            {/* Table rows */}
            {filteredMembers.map(m => {
              const wsItems = m.workspaces || []
              const visibleWs = wsItems.slice(0, MAX_WS_PILLS)
              const overflowCount = wsItems.length - MAX_WS_PILLS
              return (
                <div
                  key={m.id}
                  className={`grid grid-cols-[1fr_120px_120px_1fr_auto] gap-0 px-3 py-2.5 border-b border-border items-center hover:bg-hover/30 transition-colors ${!m.active ? 'opacity-40' : ''}`}
                >
                  {/* Name column */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={m.name} size={28} src={m.avatar} color={m.color} />
                    <div className="min-w-0">
                      <span className="text-[13px] text-text font-medium truncate block">
                        {m.name}
                        {m.email && <span className="text-text-dim font-normal ml-1">({m.email})</span>}
                      </span>
                      {m.type === 'agent' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold inline-block mt-0.5">AI Agent</span>
                      )}
                      {!m.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 inline-block mt-0.5 ml-1">inactive</span>
                      )}
                    </div>
                  </div>

                  {/* Role column */}
                  <div>
                    {addingRoleForMemberId === m.id ? (
                      <form
                        className="flex items-center gap-1"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          if (!newRoleValue.trim()) { setAddingRoleForMemberId(null); return }
                          await fetch('/api/team', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: m.id, role: newRoleValue.trim() }),
                          })
                          setAddingRoleForMemberId(null)
                          setNewRoleValue('')
                          refresh()
                        }}
                      >
                        <input
                          autoFocus
                          value={newRoleValue}
                          onChange={e => setNewRoleValue(e.target.value)}
                          onBlur={() => { setAddingRoleForMemberId(null); setNewRoleValue('') }}
                          onKeyDown={e => { if (e.key === 'Escape') { setAddingRoleForMemberId(null); setNewRoleValue('') } }}
                          className="text-[13px] px-2 py-1 rounded-md outline-none text-text border border-border/50 focus:border-accent/50 min-w-0 w-[120px]"
                          style={{ background: 'var(--bg-elevated)' }}
                          placeholder="Role name..."
                        />
                      </form>
                    ) : (
                      <Dropdown
                        value={m.role}
                        onChange={async (v) => {
                          if (v === '__add_role__') {
                            setAddingRoleForMemberId(m.id)
                            setNewRoleValue('')
                            return
                          }
                          await fetch('/api/team', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: m.id, role: v }),
                          })
                          refresh()
                        }}
                        options={ROLE_OPTIONS}
                        renderOption={(opt, isSelected) => (
                          <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${
                            opt.value === '__add_role__' ? 'text-text-dim border-t border-border mt-0.5 pt-2' :
                            isSelected ? 'bg-[rgba(255,255,255,0.08)] font-medium text-text' : 'text-text hover:bg-[rgba(255,255,255,0.06)]'
                          }`} style={{ borderRadius: 'var(--radius-sm)' }}>
                            <span className="flex-1">{opt.label}</span>
                            {isSelected && opt.value !== '__add_role__' && <IconCheck size={12} />}
                          </div>
                        )}
                        triggerClassName="text-[13px] text-text-dim hover:text-text cursor-pointer inline-flex items-center gap-1"
                        minWidth={140}
                      />
                    )}
                  </div>

                  {/* Date Added column */}
                  <div className="text-[13px] text-text-dim">
                    {formatDate(m.created_at)}
                  </div>

                  {/* Workspaces column */}
                  <div className="flex items-center gap-1 min-w-0 flex-wrap">
                    {visibleWs.map(w => (
                      <span key={w.workspace_id} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border/50 text-text-dim whitespace-nowrap">
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: w.workspace_color }} />
                        {w.workspace_name}
                      </span>
                    ))}
                    {overflowCount > 0 && (
                      <Dropdown
                        value=""
                        onChange={() => {}}
                        options={wsItems.slice(MAX_WS_PILLS).map(w => ({ value: String(w.workspace_id), label: w.workspace_name }))}
                        renderTrigger={() => (
                          <span className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full border border-border/50 text-text-dim hover:text-text cursor-pointer">
                            +{overflowCount}
                            <IconChevronDown size={10} strokeWidth={1.5} />
                          </span>
                        )}
                        minWidth={140}
                      />
                    )}
                    {wsItems.length === 0 && (
                      <span className="text-[11px] text-text-dim/40">No workspaces</span>
                    )}
                  </div>

                  {/* Actions column */}
                  <div className="flex items-center gap-0.5 w-[100px] justify-end">
                    <button onClick={() => startEditing(m)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text" title="Edit">
                      <IconEdit size={13} strokeWidth={1.3} />
                    </button>
                    <button onClick={() => handleToggleActive(m)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text" title={m.active ? 'Deactivate' : 'Activate'}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d={m.active ? 'M8 2v5M4.5 4.2A5.5 5.5 0 108 13.5 5.5 5.5 0 0011.5 4.2' : 'M3.5 8.5l3 3 6-7'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button onClick={() => handleDelete(m.id)} className="text-[11px] text-text-dim hover:text-red-400 ml-1 whitespace-nowrap">
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}

            {filteredMembers.length === 0 && (
              <div className="text-center py-8 text-text-dim text-[13px]">
                {filterQuery ? 'No members match your filter.' : 'No team members yet. Invite your first member above.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Details Tab ── */}
      {activeTab === 'details' && (
        <div className="space-y-6 max-w-md">
          {/* Team name */}
          <div className="space-y-2">
            <label className="text-[13px] text-text font-medium block">Team name</label>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent text-[14px] font-bold shrink-0">
                {teamName.charAt(0)}
              </div>
              <input
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                className="glass-input flex-1 px-2.5 py-1.5 text-[13px] rounded-md"
              />
            </div>
          </div>

          {/* Auto-join toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-text font-medium">Auto-join by email domain</p>
                <p className="text-[12px] text-text-dim mt-0.5">
                  Allow team members that have your email domain to automatically join your team.
                </p>
              </div>
              <button
                onClick={() => setAutoJoin(!autoJoin)}
                className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ml-4 ${autoJoin ? 'bg-accent' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoJoin ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          {/* Member count info */}
          <div className="flex items-center gap-2 text-[12px] text-text-dim bg-surface/30 border border-border/50 rounded-md px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 5v3M8 10.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            <span>{members.length} member{members.length !== 1 ? 's' : ''} on this team ({members.filter(m => m.active).length} active)</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Client Portals ───

interface PortalConfig {
  id: number
  client_slug: string
  project_id: number | null
  project_name: string | null
  enabled: number
  booking_url: string | null
  welcome_message: string | null
  magic_link_token: string | null
  created_at: number
}

interface ProjectOption {
  id: number
  name: string
}

function ClientPortalsSection() {
  const [portals, setPortals] = useState<PortalConfig[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newBookingUrl, setNewBookingUrl] = useState('')
  const [newWelcome, setNewWelcome] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editPassword, setEditPassword] = useState('')
  const [editBookingUrl, setEditBookingUrl] = useState('')
  const [editWelcome, setEditWelcome] = useState('')
  const [editProjectId, setEditProjectId] = useState('')

  useEffect(() => {
    loadPortals()
    loadProjects()
  }, [])

  async function loadPortals() {
    setLoading(true)
    const res = await fetch('/api/portal?all=1')
    const data = await res.json()
    setPortals(data)
    setLoading(false)
  }

  async function loadProjects() {
    try {
      const res = await fetch('/api/projects')
      const data = await res.json()
      setProjects(Array.isArray(data) ? data.map((p: Record<string, unknown>) => ({ id: p.id as number, name: p.name as string })) : [])
    } catch { /* noop */ }
  }

  async function createPortal() {
    if (!newSlug.trim()) return
    setCreating(true)
    await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        client_slug: newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        project_id: newProjectId ? Number(newProjectId) : null,
        password: newPassword || null,
        booking_url: newBookingUrl || null,
        welcome_message: newWelcome || null,
      }),
    })
    setNewSlug('')
    setNewProjectId('')
    setNewPassword('')
    setNewBookingUrl('')
    setNewWelcome('')
    setShowCreate(false)
    setCreating(false)
    loadPortals()
  }

  async function togglePortal(id: number, enabled: boolean) {
    await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id, enabled }),
    })
    loadPortals()
  }

  async function deletePortal(id: number) {
    if (!confirm('Delete this portal? This cannot be undone.')) return
    await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    loadPortals()
  }

  async function updatePortal(id: number) {
    await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        id,
        project_id: editProjectId ? Number(editProjectId) : null,
        password: editPassword || undefined,
        booking_url: editBookingUrl || null,
        welcome_message: editWelcome || null,
      }),
    })
    setEditingId(null)
    loadPortals()
  }

  function copyLink(portal: PortalConfig) {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const url = portal.magic_link_token
      ? `${base}/portal/${portal.client_slug}?token=${portal.magic_link_token}`
      : `${base}/portal/${portal.client_slug}`
    navigator.clipboard.writeText(url)
    setCopiedId(portal.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function startEdit(p: PortalConfig) {
    setEditingId(p.id)
    setEditPassword('')
    setEditBookingUrl(p.booking_url || '')
    setEditWelcome(p.welcome_message || '')
    setEditProjectId(p.project_id ? String(p.project_id) : '')
  }

  if (loading) {
    return <div className="text-[13px] text-text-dim py-4">Loading portals...</div>
  }

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-text-dim">
        Create client-facing portal pages where clients can view project progress, tasks, and deadlines. Each portal gets a unique shareable URL.
      </p>

      {/* Existing portals */}
      {portals.length > 0 && (
        <div className="space-y-3">
          {portals.map(p => (
            <div key={p.id} className="border border-border rounded-lg p-4 space-y-3">
              {editingId === p.id ? (
                /* Edit mode */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-text">Editing: {p.client_slug}</span>
                    <button onClick={() => setEditingId(null)} className="text-[13px] text-text-dim hover:text-text">Cancel</button>
                  </div>
                  <div>
                    <label className="text-[13px] text-text-dim block mb-1">Project</label>
                    <Dropdown
                      value={editProjectId}
                      onChange={(v) => setEditProjectId(v)}
                      options={[{ value: '', label: 'No project linked' }, ...projects.map(pr => ({ value: String(pr.id), label: pr.name }))]}
                      triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                      searchable
                      minWidth={180}
                    />
                  </div>
                  <div>
                    <label className="text-[13px] text-text-dim block mb-1">New Password (leave blank to keep current)</label>
                    <input
                      type="password"
                      value={editPassword}
                      onChange={e => setEditPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] text-text-dim block mb-1">Booking URL</label>
                    <input
                      type="text"
                      value={editBookingUrl}
                      onChange={e => setEditBookingUrl(e.target.value)}
                      placeholder="/booking or https://..."
                      className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] text-text-dim block mb-1">Welcome Message</label>
                    <textarea
                      value={editWelcome}
                      onChange={e => setEditWelcome(e.target.value)}
                      placeholder="Custom welcome message for the client"
                      rows={2}
                      className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim resize-none"
                    />
                  </div>
                  <button
                    onClick={() => updatePortal(p.id)}
                    className="bg-accent text-white text-[13px] font-medium px-3 py-1.5 rounded-md hover:bg-accent/90 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              ) : (
                /* View mode */
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.enabled ? 'bg-accent' : 'bg-text-dim'}`} />
                      <span className="text-[13px] font-medium text-text">{p.client_slug}</span>
                      {p.project_name && (
                        <span className="text-[13px] text-text-dim bg-elevated px-1.5 py-0.5 rounded">{p.project_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => copyLink(p)}
                        className={`text-[13px] px-2 py-1 rounded transition-colors ${copiedId === p.id ? 'bg-accent text-white font-bold' : 'bg-elevated text-text-secondary hover:text-text'}`}
                      >
                        {copiedId === p.id ? 'Copied!' : 'Copy Link'}
                      </button>
                      <button
                        onClick={() => startEdit(p)}
                        className="text-[13px] px-2 py-1 rounded bg-elevated text-text-secondary hover:text-text transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => togglePortal(p.id, !p.enabled)}
                        className={`text-[13px] px-2 py-1 rounded transition-colors ${p.enabled ? 'bg-elevated text-text-secondary hover:text-text' : 'bg-accent text-white font-bold hover:bg-accent/20'}`}
                      >
                        {p.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => deletePortal(p.id)}
                        className="text-[13px] px-2 py-1 rounded bg-elevated text-red-400 hover:text-red-500 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="text-[13px] text-text-dim">
                    /portal/{p.client_slug}
                    {p.welcome_message && <span className="ml-2 text-text-dim/60">-- &quot;{p.welcome_message.slice(0, 60)}{p.welcome_message.length > 60 ? '...' : ''}&quot;</span>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create new portal */}
      {showCreate ? (
        <div className="border border-accent/30 rounded-lg p-4 space-y-3 bg-accent-dim/20">
          <h4 className="text-[13px] font-medium text-text">New Client Portal</h4>
          <div>
            <label className="text-[13px] text-text-dim block mb-1">Client Slug (URL-friendly)</label>
            <input
              type="text"
              value={newSlug}
              onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="e.g. uppercuts, animo, elevation"
              className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[13px] text-text-dim block mb-1">Link to Project</label>
            <Dropdown
              value={newProjectId}
              onChange={(v) => setNewProjectId(v)}
              options={[{ value: '', label: 'No project linked' }, ...projects.map(pr => ({ value: String(pr.id), label: pr.name }))]}
              triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
              searchable
              minWidth={180}
            />
          </div>
          <div>
            <label className="text-[13px] text-text-dim block mb-1">Password (optional -- leave blank for public access)</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Access code"
              className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
            />
          </div>
          <div>
            <label className="text-[13px] text-text-dim block mb-1">Booking URL (optional)</label>
            <input
              type="text"
              value={newBookingUrl}
              onChange={e => setNewBookingUrl(e.target.value)}
              placeholder="/booking or https://calendly.com/..."
              className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim"
            />
          </div>
          <div>
            <label className="text-[13px] text-text-dim block mb-1">Welcome Message (optional)</label>
            <textarea
              value={newWelcome}
              onChange={e => setNewWelcome(e.target.value)}
              placeholder="Custom welcome message for the client portal header"
              rows={2}
              className="w-full bg-field border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent placeholder:text-text-dim resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={createPortal}
              disabled={creating || !newSlug.trim()}
              className="bg-accent text-white text-[13px] font-medium px-3 py-1.5 rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Portal'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="text-[13px] text-text-dim hover:text-text px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-[13px] text-accent-text hover:text-accent-text/80 transition-colors font-medium"
        >
          <IconPlus size={12} />
          Add Client Portal
        </button>
      )}
    </div>
  )
}

// ─── AI Settings (BYOK, Model, Budget, Usage) ───

function AiSettingsSection() {
  const [apiKey, setApiKey] = useState('')
  const [keyPreview, setKeyPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [lastPoll, setLastPoll] = useState<string | null>(null)
  const [bridgeSecret, setBridgeSecret] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [bridgeRestarting, setBridgeRestarting] = useState(false)
  const [bridgeAutoApprove, setBridgeAutoApprove] = useState(true)
  const [bridgeModeSaving, setBridgeModeSaving] = useState(false)
  const [bridgeActionMsg, setBridgeActionMsg] = useState<string | null>(null)

  const refreshBridgeStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dispatch/bridge')
      if (!res.ok) throw new Error('offline')
      const d = await res.json()
      if (d.lastPoll) {
        const pollAge = Date.now() / 1000 - d.lastPoll
        setBridgeStatus(pollAge < 120 ? 'connected' : 'offline')
        setLastPoll(new Date(d.lastPoll * 1000).toLocaleTimeString())
      } else {
        setBridgeStatus('offline')
        setLastPoll(null)
      }
      if (typeof d.autoApprove === 'boolean') setBridgeAutoApprove(d.autoApprove)
    } catch {
      setBridgeStatus('offline')
      setLastPoll(null)
    }
  }, [])

  useEffect(() => {
    // Load API key config
    fetch('/api/api-keys').then(r => r.json()).then(d => {
      if (d.key_preview) setKeyPreview(d.key_preview)
    }).catch(() => {})

    // Check dispatch bridge status
    refreshBridgeStatus()

    // Check bridge secret
    const secret = process.env.NEXT_PUBLIC_BRIDGE_SECRET || ''
    if (secret) {
      setBridgeSecret(secret.length > 8 ? `${secret.slice(0, 4)}${'*'.repeat(8)}${secret.slice(-4)}` : '****')
    }
  }, [refreshBridgeStatus])

  async function restartBridge() {
    setBridgeRestarting(true)
    setBridgeActionMsg(null)
    try {
      const res = await fetch('/api/dispatch/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBridgeActionMsg('Restart requested. Bridge will reinitialize on next poll.')
        setTimeout(() => { refreshBridgeStatus().catch(() => {}) }, 1200)
      } else {
        setBridgeActionMsg(data.error || 'Failed to request restart')
      }
    } catch {
      setBridgeActionMsg('Failed to request restart')
    }
    setBridgeRestarting(false)
  }

  async function setAutoApprove(enabled: boolean) {
    setBridgeModeSaving(true)
    setBridgeActionMsg(null)
    try {
      const res = await fetch('/api/dispatch/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_auto_approve', enabled }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBridgeAutoApprove(enabled)
        setBridgeActionMsg(enabled ? 'Autonomous mode enabled.' : 'Review-required mode enabled.')
      } else {
        setBridgeActionMsg(data.error || 'Failed to update mode')
      }
    } catch {
      setBridgeActionMsg('Failed to update mode')
    }
    setBridgeModeSaving(false)
  }

  async function saveKey() {
    if (!apiKey.trim()) return
    setSaving(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setKeyPreview(data.key_preview || apiKey.slice(0, 8) + '...' + apiKey.slice(-4))
        setApiKey('')
        setTestResult({ ok: true, message: 'API key saved and verified' })
      } else {
        setTestResult({ ok: false, message: data.error || 'Failed to save' })
      }
    } catch {
      setTestResult({ ok: false, message: 'Connection error' })
    }
    setSaving(false)
  }

  async function deleteKey() {
    await fetch('/api/api-keys', { method: 'DELETE' })
    setKeyPreview('')
    setApiKey('')
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/api-keys')
      const data = await res.json()
      if (data.key_preview) {
        setTestResult({ ok: true, message: `Connected. Key: ${data.key_preview}` })
      } else {
        setTestResult({ ok: false, message: 'No API key configured' })
      }
    } catch {
      setTestResult({ ok: false, message: 'Connection failed' })
    }
    setTesting(false)
  }

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-text-dim">AI Dispatch routes tasks to Claude Code running on your local machine. In autonomous mode it executes and auto-completes tasks without manual review.</p>

      {/* Dispatch Bridge Status */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">Dispatch Bridge</h3>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-elevated">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            bridgeStatus === 'checking' ? 'bg-yellow-500 animate-pulse'
            : bridgeStatus === 'connected' ? 'bg-green-500'
            : 'bg-gray-500'
          }`} />
          <div className="flex-1">
            <span className="text-[14px] font-medium text-text">
              {bridgeStatus === 'checking' ? 'Checking...'
              : bridgeStatus === 'connected' ? 'Bridge Connected'
              : 'Bridge Offline'}
            </span>
            {lastPoll && (
              <span className="text-[12px] text-text-dim ml-2">Last poll: {lastPoll}</span>
            )}
          </div>
          <button
            onClick={restartBridge}
            disabled={bridgeRestarting}
            className="px-3 py-1.5 bg-hover text-text text-[12px] font-medium rounded-md hover:bg-border shrink-0 disabled:opacity-50"
          >
            {bridgeRestarting ? 'Restarting...' : 'Restart Bridge'}
          </button>
          <button
            onClick={() => refreshBridgeStatus()}
            className="px-3 py-1.5 bg-hover text-text text-[12px] font-medium rounded-md hover:bg-border shrink-0"
          >
            Refresh
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoApprove(true)}
            disabled={bridgeModeSaving}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md border shrink-0 disabled:opacity-50 ${bridgeAutoApprove ? 'bg-[#22c55e20] border-[#22c55e50] text-[#22c55e]' : 'bg-hover border-border text-text-dim hover:text-text'}`}
          >
            Autonomous
          </button>
          <button
            onClick={() => setAutoApprove(false)}
            disabled={bridgeModeSaving}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md border shrink-0 disabled:opacity-50 ${!bridgeAutoApprove ? 'bg-[#f9731620] border-[#f9731650] text-[#f97316]' : 'bg-hover border-border text-text-dim hover:text-text'}`}
          >
            Review Required
          </button>
          <span className="text-[12px] text-text-dim">{bridgeAutoApprove ? 'Auto-approve ON' : 'Manual review ON'}</span>
        </div>
        {bridgeActionMsg && (
          <p className="text-[12px] text-text-dim">{bridgeActionMsg}</p>
        )}
      </div>

      {/* How Dispatch Works */}
      <div className="space-y-3">
        <button
          onClick={() => setShowSetup(!showSetup)}
          className="flex items-center gap-2 text-[14px] font-semibold text-text hover:text-accent transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" className={`transition-transform ${showSetup ? 'rotate-90' : ''}`}>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          How Dispatch Works
        </button>
        {showSetup && (
          <div className="space-y-3 pl-1">
            <ol className="list-decimal list-inside space-y-1.5 text-[13px] text-text-dim">
              <li>Tasks dispatched from Motion Lite are queued on the server</li>
              <li>The dispatch bridge runs locally on your machine</li>
              <li>It picks up tasks and runs Claude Code with your subscription</li>
              <li>Results are posted back and either auto-completed or sent for review based on mode</li>
            </ol>
            <div className="rounded-md bg-field border border-border px-3 py-2">
              <p className="text-[11px] text-text-dim mb-1">Quick start (shell keepalive):</p>
              <code className="text-[13px] text-text font-mono">npm run dispatch:keepalive</code>
            </div>
            <div className="rounded-md bg-field border border-border px-3 py-2">
              <p className="text-[11px] text-text-dim mb-1">Managed mode (PM2):</p>
              <div className="text-[12px] text-text font-mono space-y-1">
                <div>npm run dispatch:pm2:start</div>
                <div>npm run dispatch:pm2:status</div>
                <div>npm run dispatch:pm2:logs</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bridge Secret */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">Bridge Secret</h3>
        <p className="text-[13px] text-text-dim">This secret authenticates your local bridge with the server.</p>
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-elevated">
          <span className="text-[13px] text-text font-mono">
            {bridgeSecret || 'Not configured'}
          </span>
        </div>
        <p className="text-[12px] text-text-dim">Set <code className="font-mono bg-field px-1 py-0.5 rounded text-[11px]">BRIDGE_SECRET</code> in your .env file</p>
      </div>

      {/* API Key */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text">API Key</h3>
        <p className="text-[13px] text-text-dim">Used for Meeting AI and other server-side AI features. Supports Anthropic (sk-ant-...) and OpenRouter (sk-or-...).</p>
        {keyPreview ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text-dim font-mono">
              {keyPreview}
            </div>
            <button onClick={testConnection} disabled={testing} className="px-3 py-1.5 bg-hover text-text text-[13px] font-medium rounded-md hover:bg-border shrink-0 disabled:opacity-50">
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button onClick={deleteKey} className="px-3 py-1.5 text-[#ef5350] text-[13px] font-medium rounded-md hover:bg-red/10 shrink-0">
              Remove
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-... or sk-or-..."
              className="flex-1 bg-field border border-border rounded-md px-3 py-2 text-[13px] text-text font-mono placeholder:text-text-dim outline-none focus:border-border-strong"
            />
            <button onClick={saveKey} disabled={!apiKey.trim() || saving} className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80 shrink-0 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Key'}
            </button>
          </div>
        )}
        {testResult && (
          <p className={`text-[13px] ${testResult.ok ? 'text-[#7a6b55]' : 'text-[#ef5350]'}`}>{testResult.message}</p>
        )}
      </div>
    </div>
  )
}

// ─── Environment Variable Vault ───

function EnvVaultSection() {
  const [vars, setVars] = useState<Array<{ id: number; key: string; description: string; has_value: boolean }>>([])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    fetch('/api/env-vault').then(r => r.json()).then(d => setVars(d.vars || [])).catch(() => {})
  }, [])

  async function addVar() {
    if (!newKey.trim() || !newValue.trim()) return
    await fetch('/api/env-vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), description: newDesc.trim() }),
    })
    setNewKey('')
    setNewValue('')
    setNewDesc('')
    setShowAdd(false)
    const res = await fetch('/api/env-vault')
    const d = await res.json()
    setVars(d.vars || [])
  }

  async function deleteVar(key: string) {
    await fetch(`/api/env-vault?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    setVars(prev => prev.filter(v => v.key !== key))
  }

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-text-dim">
        Store API keys and secrets that skills need to function. These are available to all skills that require them.
      </p>

      <div className="space-y-2">
        {vars.map(v => (
          <div key={v.id} className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-elevated border border-border">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-mono font-medium text-text">{v.key}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${v.has_value ? 'bg-[#7a6b55]' : 'bg-red'}`} />
              </div>
              {v.description && <p className="text-[10px] text-text-dim mt-0.5">{v.description}</p>}
            </div>
            <button
              onClick={() => deleteVar(v.key)}
              className="text-[13px] text-[#ef5350] hover:underline shrink-0"
            >
              Remove
            </button>
          </div>
        ))}
        {vars.length === 0 && !showAdd && (
          <p className="text-[13px] text-text-dim text-center py-4">No environment variables configured</p>
        )}
      </div>

      {showAdd ? (
        <div className="space-y-2 p-4 rounded-lg border border-border bg-elevated">
          <input
            value={newKey}
            onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder="VARIABLE_NAME"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text font-mono placeholder:text-text-dim outline-none focus:border-border-strong"
          />
          <input
            type="password"
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            placeholder="Value (will be stored securely)"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text font-mono placeholder:text-text-dim outline-none focus:border-border-strong"
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text placeholder:text-text-dim outline-none focus:border-border-strong"
          />
          <div className="flex gap-2">
            <button onClick={addVar} disabled={!newKey || !newValue} className="px-3 py-1.5 bg-accent text-white text-[13px] font-medium rounded-md hover:bg-accent/80 disabled:opacity-50">
              Save
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-text-dim text-[13px] rounded-md hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-[13px] text-accent-text hover:text-accent-text/80 font-medium"
        >
          <IconPlus size={12} />
          Add Variable
        </button>
      )}

      {/* Common variables hint */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold text-text">Common Variables</h3>
        <div className="space-y-1 text-[13px]">
          {[
            { key: 'OPENAI_API_KEY', desc: 'Required by last30days, research skills' },
            { key: 'META_ACCESS_TOKEN', desc: 'Required by ads-meta, Meta campaign analysis' },
            { key: 'APIFY_TOKEN', desc: 'Required by content scraping skills' },
            { key: 'YOUTUBE_API_KEY', desc: 'Required by YouTube research' },
          ].map(hint => {
            const isConfigured = vars.some(v => v.key === hint.key)
            return (
              <div key={hint.key} className="flex items-center gap-2 text-text-dim">
                <span className={`w-1.5 h-1.5 rounded-full ${isConfigured ? 'bg-[#7a6b55]' : 'bg-border'}`} />
                <span className="font-mono">{hint.key}</span>
                <span>-- {hint.desc}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
