export interface Workspace {
  id: number
  public_id?: string
  name: string
  slug: string
  color: string
  sort_order: number
  is_private: number
  is_primary: number
  owner_id: number | null
  description: string | null
  created_at: number
  updated_at: number
  // Populated by the multi-tenant migration. These are always present at
  // runtime — older rows are backfilled from the column defaults.
  timezone?: string
  currency?: string
  primary_color?: string
  business_hours_start?: number
  business_hours_end?: number
  business_days_mask?: number
  notify_new_lead_email?: number
  notify_owner_on_inbound?: number
  auto_unsubscribe_footer?: number
  default_reminder_24h?: number
  default_reminder_1h?: number
  support_email?: string | null
  // Conversation AI auto-reply (added with the feat/conversation-ai-autoreply
  // wave). See src/lib/conversation-ai-autoreply.ts.
  ai_autoreply_enabled?: number
  ai_autoreply_channels?: string
  ai_autoreply_confidence_threshold?: number
  ai_autoreply_business_hours_only?: number
  ai_autoreply_max_per_contact_per_day?: number
  ai_autoreply_system_prompt?: string | null
  ai_autoreply_handoff_keywords?: string
  facebook_page_access_tokens?: string | null
  facebook_webhook_verify_token?: string | null
  google_ads_api_token?: string | null
}

export interface UserWorkspaceMember {
  user_id: number
  workspace_id: number
  role: 'owner' | 'admin' | 'member'
  joined_at: number
}

export interface Folder {
  id: number
  public_id?: string
  workspace_id: number
  parent_id: number | null
  name: string
  color: string
  sort_order: number
  created_at: number
  updated_at: number
}

export interface Project {
  id: number
  public_id?: string
  workspace_id: number
  folder_id: number | null
  name: string
  description: string | null
  color: string
  status: 'open' | 'closed' | 'archived'
  assignee: string | null
  start_date: string | null
  deadline: string | null
  priority: string | null
  labels: string | null
  archived: number
  default_assignee: string | null
  default_priority: string
  auto_schedule_tasks: number
  template_id: number | null
  template_version: number | null
  sort_order: number
  created_at: number
  updated_at: number
  deleted_at: string | null
}

export interface Stage {
  id: number
  public_id?: string
  project_id: number
  name: string
  color: string
  is_active: number
  sort_order: number
  created_at: number
  deleted_at: string | null
}

export interface Task {
  id: number
  public_id?: string
  title: string
  description: string | null
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | 'archived'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  client: string | null
  assignee: string | null
  due_date: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  sort_order: number
  workspace_id: number | null
  project_id: number | null
  stage_id: number | null
  folder_id: number | null
  duration_minutes: number
  start_date: string | null
  hard_deadline: number
  labels: string | null
  blocked_by: string | null
  blocking: string | null
  auto_schedule: number
  completed_time_minutes: number
  scheduled_start: string | null
  scheduled_end: string | null
  schedule_id: number | null
  overdue_from: string | null
  min_chunk_minutes: number
  is_asap: number
  task_type: string | null
  recurrence_rule: string | null
  recurrence_parent_id: number | null
  parent_task_id: number | null
  is_favorite: number
  effort_level: string | null
  locked_at: string | null
  deleted_at: string | null
  /** Set when the task is tied to a CRM contact. Populated by the workflow
   *  `create_task` action and by Tasks created from the contact card. */
  crm_contact_id: number | null
}

export interface TaskChunk {
  id: number
  task_id: number
  chunk_start: string
  chunk_end: string
  completed: number
  created_at: number
}

export interface Doc {
  id: number
  public_id?: string
  workspace_id: number | null
  folder_id: number | null
  project_id: number | null
  parent_doc_id: number | null
  title: string
  content: string
  doc_type: string | null
  color: string | null
  icon: string | null
  published: number
  publish_slug: string | null
  share_mode: string
  created_at: number
  updated_at: number
}

export interface DocComment {
  id: number
  doc_id: number
  block_id: string | null
  parent_comment_id: number | null
  author: string
  content: string
  resolved: number
  created_at: number
  updated_at: number
  replies?: DocComment[]
}

export interface DocShare {
  id: number
  doc_id: number
  email: string
  role: 'full_access' | 'editor' | 'viewer'
  created_at: number
}

export interface Agent {
  id: string
  name: string
  role: string
  system_prompt: string | null
  soul_md: string | null
  memory_md: string | null
  avatar_color: string | null
  can_delegate_to: string | null
  model_preference: string | null
  allowed_tools: string | null
  max_turns: number | null
  learnings_md: string | null
  status: string
  current_task_id: number | null
  last_active: number | null
  created_at: number
}

export interface AgentReference {
  id: number
  agent_id: string
  name: string
  content: string
  category: string
  created_at: number
  updated_at: number
}

export interface SkillDefinition {
  id: number
  slug: string
  name: string
  description: string
  instructions: string | null
  argument_hint: string | null
  allowed_tools: string
  model: string
  max_turns: number
  metadata: string
  source: string
  created_at: number
}

export interface TaskActivity {
  id: number
  task_id: number
  agent_id: string | null
  activity_type: string
  message: string
  metadata: string | null
  created_at: number
}

// Sidebar tree node
export interface TreeNode {
  id: string // e.g., "folder-1", "project-3", "doc-5"
  public_id?: string // the entity's public_id for URL construction
  type: 'workspace' | 'folder' | 'project' | 'doc' | 'database'
  name: string
  color: string
  itemCount: number
  children: TreeNode[]
  data: Workspace | Folder | Project | Doc | Record<string, unknown>
}

// Workspace-level custom statuses
export interface WorkspaceStatus {
  id: number
  workspace_id: number
  name: string
  color: string
  sort_order: number
  auto_schedule_disabled: number
}

// Workspace-level managed labels
export interface WorkspaceLabel {
  id: number
  workspace_id: number
  name: string
  color: string
  sort_order: number
}

// Assignee option for dropdowns
export interface AssigneeOption {
  id: string
  name: string
  role: string
  type: 'human' | 'agent'
}

// Team members
export interface TeamMember {
  id: number
  public_id?: string
  name: string
  email: string | null
  role: string
  type: 'human' | 'agent'
  avatar: string | null
  color: string
  permissions: string // JSON array of permission strings
  schedule_id: number | null
  active: number
  created_at: number
  updated_at: number
}

// Task templates
export interface TaskTemplate {
  id: number
  name: string
  description: string | null
  default_title: string | null
  default_priority: string
  default_duration_minutes: number
  default_status: string
  subtasks: string | null // JSON array: [{title, duration_minutes, priority}]
  workspace_id: number | null
  created_at: number
}

// Project templates
export interface ProjectTemplate {
  id: number
  name: string
  description: string | null
  stages: string // JSON: TemplateStage[]
  default_tasks: string // JSON: TemplateTaskDef[]
  roles: string // JSON: TemplateRole[]
  text_variables: string // JSON: TemplateVariable[]
  workspace_id: number | null
  is_builtin: number
  template_version: number
  created_at: number
}

export interface TemplateStage {
  name: string
  color: string
  sort_order: number
  expected_duration_value?: number
  expected_duration_unit?: 'days' | 'weeks' | 'months'
  auto_schedule_all?: boolean
}

export interface TemplateTaskDef {
  id: string
  title: string
  description?: string
  status?: string
  priority?: string
  stage_index: number
  duration_minutes?: number
  role?: string
  blocked_by_ids?: string[]
  offset_days?: number
  offset_unit?: 'days' | 'weekdays' | 'weeks'
  deadline_offset_days?: number
  deadline_offset_unit?: 'days' | 'weekdays' | 'weeks'
  task_type?: 'task' | 'event'
  checklist?: string[]
  labels?: string[]
  auto_schedule?: boolean
  hard_deadline?: boolean
  min_chunk_minutes?: number
}

export interface TemplateRole {
  name: string
  description?: string
  color?: string
}

export interface TemplateVariable {
  key: string
  label: string
  default_value?: string
}
