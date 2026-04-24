import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), '..', 'store', 'motion.db')

function getDb(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

// ─── Defaults ───

export const SETTING_DEFAULTS: Record<string, unknown> = {
  // Auto-scheduling
  showTasksOnCalendar: true,
  syncTasksToGoogle: false,
  displayTaskNames: true,
  breakMinutes: 15,
  breakEveryMinutes: 180,

  // Task defaults
  defaultPriority: 'medium',
  defaultDuration: 30,
  defaultAutoSchedule: true,
  defaultHardDeadline: false,
  minChunkDuration: 30,
  maxChunkDuration: 90,
  taskBufferMinutes: 5,
  dailyCapPercent: 85,

  // Smart scheduling (Phase 2)
  deadlineUrgencyEnabled: true,
  deadlineUrgencyDays: 3,
  batchSimilarTasks: true,
  deepWorkCapEnabled: true,
  deepWorkCapMinutes: 240,
  noDeepWorkAfterMeetings: true,
  deepWorkMeetingBufferMinutes: 30,
  eatTheFrogEnabled: true,

  // Timezone
  timezone: 'America/Los_Angeles',
  secondaryTimezone: '',

  // Theme
  weekStartDay: 'sunday',

  // Conference
  defaultConferenceMethod: 'zoom',
  zoomLink: '',
  phoneNumber: '',
  customLocation: '',

  // Booking
  bookingUrl: '',
  bookingMessage: 'Here are some times that work for me:\n$Meeting times$\n\nBook directly: $Booking link$\n\nTimezone: $Timezone$\nDuration: $Duration$',

  // CRM
  sendgrid_api_key: '',
  twilio_account_sid: '',
  twilio_auth_token: '',
  twilio_phone_number: '',
  twilio_messaging_service_sid: '',

  // Notifications
  notifyEventCreated: true,
  notifyEventUpdated: true,
  notifyEventReminder: true,
  notifyTaskDue: true,

  // Meeting AI Processing
  meetingTaskScope: 'Marketing & Meta Ads, Funnels & Landing Pages, Technology & Automation, Content Creation & Videography, Client Management & Communication',
  meetingAutoProcess: true,
  meetingAutoCreateTasks: true,
  meetingModel: 'anthropic/claude-sonnet-4-6',
  meetingClientKeywords: {},

  // Jimmy Dispatch (push meeting pointers to Mac via Tailscale)
  meetingAutoDispatch: true,
  meetingDispatchMinUrgency: 'medium', // 'low' | 'medium' | 'high'

  // AI Dispatch push (wake the Mac bridge instantly instead of 2s polling)
  dispatchWebhookUrl: '',
  dispatchWebhookToken: '',
}

export type SettingKey = keyof typeof SETTING_DEFAULTS

// ─── Functions ───

export function getSetting<T = unknown>(key: string): T {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (row) {
    try { return JSON.parse(row.value) as T } catch { return row.value as T }
  }
  return (SETTING_DEFAULTS[key] ?? null) as T
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, serialized)
}

export function getAllSettings(): Record<string, unknown> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const result = { ...SETTING_DEFAULTS }
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value) } catch { result[row.key] = row.value }
  }
  return result
}
