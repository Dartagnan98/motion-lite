// Everhour adapter — provider-specific raw types.
//
// Reference: https://everhour.docs.apiary.io/
// API base: https://api.everhour.com/
//
// Endpoints used:
//   GET  /users/me            — validate API key (used in connect())
//   GET  /team/time           — list time entries for a date range
//
// All time values from the Everhour API are in seconds. We convert to decimal
// hours (seconds / 3600) in normalize.ts.

// ─── User ─────────────────────────────────────────────────────────────────────

export interface EverhourUser {
  id: number
  name: string
  email: string
  role: string
  status: string
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface EverhourProject {
  id: string
  name: string
  /** Client name, if the project is associated with a client. May be null. */
  clientName?: string | null
}

// ─── Time entry ──────────────────────────────────────────────────────────────

/** A single time entry from the /team/time endpoint. */
export interface EverhourTimeEntry {
  /** Unique entry identifier. */
  id: number
  /** User who logged the time. */
  user: {
    id: number
    name: string
  }
  /** ISO date string YYYY-MM-DD. */
  date: string
  /** Time logged in seconds. */
  time: number
  /** The task this time was logged against. Everhour's `/team/time` endpoint
   *  returns `projects` as an array of bare project ID strings (not objects).
   *  Project names must be looked up via a separate /projects call — see
   *  EverhourRawSnapshot.projectsById. */
  task: {
    id: string
    name: string
    /** Array of project ID strings (e.g. "as:1212850290787554"). */
    projects: string[]
  } | null
  /** Free-form comment the user entered when logging time. */
  comment: string | null
}

/** Response shape from GET /team/time?from=...&to=... */
export interface EverhourTeamTimeResponse {
  /** Flat array of time entries. */
  data?: EverhourTimeEntry[]
  /** Some API versions return the array directly (not wrapped in `data`).
   *  The adapter handles both. */
  [key: string]: unknown
}

// ─── Raw snapshot ─────────────────────────────────────────────────────────────

/** Composite raw snapshot assembled by fetchSnapshot.
 *  This is what fetchSnapshot returns and what persists to raw_json. */
export interface EverhourRawSnapshot {
  periodStart: string        // 'YYYY-MM-DD'
  periodEnd: string          // 'YYYY-MM-DD'
  entries: EverhourTimeEntry[]
  /** Project ID → { name, clientName? } map. Built from a separate /projects
   *  call; normalize.ts uses this to resolve project names from the bare ID
   *  strings in entry.task.projects. */
  projectsById: Record<string, { name: string; clientName?: string | null }>
  fetchedAt: string          // ISO datetime
}
