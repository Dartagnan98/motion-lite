import type { AssigneeMember } from './use-team-members'

/** Minimal shape required for assignee lookups */
type AssigneeLike = { id: string; name: string }

/**
 * Find a team member by assignee value.
 * Handles: public_id match, full name match, first-name-lowercase legacy match.
 */
export function findAssignee<T extends AssigneeLike>(value: string | null | undefined, members: T[]): T | null {
  if (!value) return null
  return members.find(a =>
    a.id === value ||
    a.name === value ||
    a.name.split(' ')[0].toLowerCase() === value
  ) || null
}

/** Get display name for an assignee value, with fallback */
export function getAssigneeName(value: string | null | undefined, members: AssigneeLike[]): string {
  if (!value) return 'Unassigned'
  const member = findAssignee(value, members)
  return member?.name || value
}
