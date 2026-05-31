// Asana adapter — provider-specific raw types.
//
// Reference: https://developers.asana.com/reference
// API base: https://app.asana.com/api/1.0
//
// Endpoints used:
//   GET  /workspaces                          — list workspaces the authed user can see
//   POST /workspaces/{wid}/tasks/search        — search tasks with completed_since filter
//
// Asana paginates all list responses at limit=100 (hard cap). Pagination uses
// a cursor via response.next_page.offset. We follow until next_page is null.

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface AsanaWorkspace {
  gid: string
  name: string
  resource_type: 'workspace'
}

export interface AsanaWorkspacesResponse {
  data: AsanaWorkspace[]
  next_page: AsanaNextPage | null
}

// ─── Task search ─────────────────────────────────────────────────────────────

export interface AsanaTaskMembership {
  project: {
    gid: string
    name: string
    resource_type: 'project'
  }
  section: {
    gid: string
    name: string
    resource_type: 'section'
  } | null
}

export interface AsanaTask {
  gid: string
  name: string
  completed: boolean
  completed_at: string | null       // ISO datetime; null if incomplete
  memberships: AsanaTaskMembership[]
}

export interface AsanaNextPage {
  offset: string
  path: string
  uri: string
}

export interface AsanaTasksResponse {
  data: AsanaTask[]
  next_page: AsanaNextPage | null
}

// ─── Raw snapshot ─────────────────────────────────────────────────────────────

/** Composite raw snapshot assembled by fetchSnapshot.
 *  This is what fetchSnapshot returns and what persists to raw_json.
 *  tasks is the flat, de-paginated list of all completed tasks in the period. */
export interface AsanaRawSnapshot {
  workspaceId: string
  periodStart: string    // 'YYYY-MM-DD'
  periodEnd: string      // 'YYYY-MM-DD'
  tasks: AsanaTask[]
  fetchedAt: string      // ISO datetime
}
