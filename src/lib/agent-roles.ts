export const AGENT_ROLES: Record<string, { name: string; taskTypes: string[] }> = {
  'executive-assistant': {
    name: 'Executive Assistant (Jimmy)',
    taskTypes: ['admin', 'planning', 'communication', 'review'],
  },
  'meta-ads': {
    name: 'Meta Ads Specialist (Gary)',
    taskTypes: ['meta-ads', 'analytics', 'reporting', 'campaign'],
  },
  'copywriter': {
    name: 'Copywriter (Ricky)',
    taskTypes: ['content', 'copy', 'scripts', 'email'],
  },
  'social-media': {
    name: 'Social Media Manager (Sofia)',
    taskTypes: ['social', 'content-calendar', 'engagement'],
  },
}

export function findAgentForTaskType(taskType: string): string | null {
  for (const [roleId, role] of Object.entries(AGENT_ROLES)) {
    if (role.taskTypes.includes(taskType)) return roleId
  }
  return null
}

export function getTaskTypesForRole(roleId: string): string[] {
  return AGENT_ROLES[roleId]?.taskTypes || []
}
