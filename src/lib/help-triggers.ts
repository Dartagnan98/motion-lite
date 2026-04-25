import {
  getDb,
  queueCrmWorkflowRunsForTrigger,
  type CrmWorkflow,
} from '@/lib/db'

const MAX_HELP_TRIGGER_CONTACTS = 50

function contactsForWorkspace(workspaceId: number, limit: number): Array<{ id: number }> {
  try {
    return getDb()
      .prepare('SELECT id FROM crm_contacts WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?')
      .all(workspaceId, limit) as Array<{ id: number }>
  } catch {
    return []
  }
}

function hasWorkflowForTrigger(workspaceId: number, triggerType: CrmWorkflow['trigger_type']): boolean {
  try {
    const row = getDb()
      .prepare('SELECT 1 AS ok FROM crm_workflows WHERE workspace_id = ? AND trigger_type = ? AND is_active = 1 LIMIT 1')
      .get(workspaceId, triggerType) as { ok: number } | undefined
    return Boolean(row)
  } catch {
    return false
  }
}

function fanOutHelpTrigger(workspaceId: number, triggerType: CrmWorkflow['trigger_type'], triggerValue: string, contactId?: number | null): void {
  if (!hasWorkflowForTrigger(workspaceId, triggerType)) return
  if (contactId) {
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId,
        triggerType,
        triggerValue,
      })
    } catch {}
    return
  }
  const contacts = contactsForWorkspace(workspaceId, MAX_HELP_TRIGGER_CONTACTS)
  for (const contact of contacts) {
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId: contact.id,
        triggerType,
        triggerValue,
      })
    } catch {}
  }
}

export function fireHelpArticlePublishedTrigger(workspaceId: number, articleSlug: string): void {
  fanOutHelpTrigger(workspaceId, 'help_article_published', articleSlug)
}

export function fireHelpSearchNoResultTrigger(
  workspaceId: number,
  query: string,
  contactId?: number | null,
): void {
  fanOutHelpTrigger(workspaceId, 'help_search_no_result', query, contactId)
}

export function fireHelpArticleUnhelpfulTrigger(
  workspaceId: number,
  articleSlug: string,
  contactId?: number | null,
): void {
  fanOutHelpTrigger(workspaceId, 'help_article_unhelpful', articleSlug, contactId)
}
