import { createTaskActivity, createNotificationRow } from './db'
import { sendPushToAll } from './push'

export type NotificationType =
  | 'task.assigned'
  | 'task.overdue'
  | 'task.mentioned'
  | 'task.completed'
  | 'schedule.rearranged'
  | 'budget.warning'

const NOTIFICATION_TITLES: Record<string, string> = {
  'task.assigned': 'Task Assigned',
  'task.overdue': 'Task Overdue',
  'task.mentioned': 'You were mentioned',
  'task.completed': 'Task Completed',
  'schedule.rearranged': 'Schedule Changed',
  'budget.warning': 'Budget Warning',
}

/**
 * Legacy: Create a task-activity notification.
 * Kept for backward compat with existing task triggers.
 */
export function createNotification(
  type: NotificationType,
  title: string,
  message?: string,
  taskId?: number,
  agentId?: string,
  agentName?: string
) {
  if (!taskId) return null
  const metadata = agentName ? JSON.stringify({ agent_name: agentName }) : undefined
  const activity = createTaskActivity(taskId, type, message || title, agentId, metadata)

  // Fire Web Push notification (async, non-blocking)
  sendPushToAll({
    title: NOTIFICATION_TITLES[type] || 'Motion Lite',
    body: message || title,
    url: taskId ? `/projects-tasks?task=${taskId}` : '/inbox',
    tag: type,
  }).catch(() => {})

  return activity
}

// ─── Unified notification helpers ───

/**
 * Notify: agent sent a DM response
 */
export function notifyMessage(
  channelId: number,
  senderName: string,
  senderAvatar: string | undefined,
  senderColor: string | undefined,
  messagePreview: string,
) {
  const body = messagePreview.length > 100 ? messagePreview.slice(0, 100) + '...' : messagePreview
  const row = createNotificationRow({
    type: 'message',
    subtype: 'dm',
    title: `${senderName} sent a message`,
    body,
    url: `/messages?channel=${channelId}`,
    actor_name: senderName,
    actor_avatar: senderAvatar,
    actor_color: senderColor,
    reference_id: channelId,
  })

  sendPushToAll({
    title: senderName,
    body,
    url: `/messages?channel=${channelId}`,
    tag: 'message.dm',
  }).catch(() => {})

  return row
}

/**
 * Notify: @mention in a channel
 */
export function notifyMention(
  channelId: number,
  channelName: string,
  senderName: string,
  senderAvatar: string | undefined,
  senderColor: string | undefined,
  messagePreview: string,
) {
  const body = messagePreview.length > 100 ? messagePreview.slice(0, 100) + '...' : messagePreview
  const row = createNotificationRow({
    type: 'message',
    subtype: 'mention',
    title: `${senderName} mentioned you in #${channelName}`,
    body,
    url: `/messages?channel=${channelId}`,
    actor_name: senderName,
    actor_avatar: senderAvatar,
    actor_color: senderColor,
    reference_id: channelId,
  })

  sendPushToAll({
    title: `Mentioned in #${channelName}`,
    body,
    url: `/messages?channel=${channelId}`,
    tag: 'message.mention',
  }).catch(() => {})

  return row
}

/**
 * Notify: task event (created, completed, overdue)
 */
export function notifyTask(
  taskId: number,
  subtype: 'assigned' | 'completed' | 'overdue',
  taskTitle: string,
  agentName?: string,
  agentAvatar?: string,
  agentColor?: string,
) {
  const titles: Record<string, string> = {
    assigned: 'New task',
    completed: 'Task completed',
    overdue: 'Task overdue',
  }
  const row = createNotificationRow({
    type: 'task',
    subtype,
    title: `${titles[subtype]}: ${taskTitle}`,
    url: `/projects-tasks?task=${taskId}`,
    actor_name: agentName,
    actor_avatar: agentAvatar,
    actor_color: agentColor,
    reference_id: taskId,
  })

  sendPushToAll({
    title: titles[subtype] || 'Task update',
    body: taskTitle,
    url: `/projects-tasks?task=${taskId}`,
    tag: `task.${subtype}`,
  }).catch(() => {})

  // Also create legacy task_activity for backward compat
  const typeMap: Record<string, NotificationType> = {
    assigned: 'task.assigned',
    completed: 'task.completed',
    overdue: 'task.overdue',
  }
  if (typeMap[subtype]) {
    createTaskActivity(taskId, typeMap[subtype], taskTitle)
  }

  return row
}

/**
 * Notify: calendar event
 */
export function notifyCalendar(
  eventId: number,
  subtype: 'upcoming' | 'new',
  eventTitle: string,
) {
  const titles: Record<string, string> = {
    upcoming: 'Starting soon',
    new: 'New event',
  }
  const row = createNotificationRow({
    type: 'calendar',
    subtype,
    title: `${titles[subtype]}: ${eventTitle}`,
    url: '/calendar',
    reference_id: eventId,
  })

  sendPushToAll({
    title: titles[subtype] || 'Calendar',
    body: eventTitle,
    url: '/calendar',
    tag: `calendar.${subtype}`,
  }).catch(() => {})

  return row
}

/**
 * Notify: project event
 */
export function notifyProject(
  projectId: number,
  subtype: 'created',
  projectName: string,
) {
  const row = createNotificationRow({
    type: 'project',
    subtype,
    title: `New project: ${projectName}`,
    url: `/projects-tasks?project=${projectId}`,
    reference_id: projectId,
  })

  sendPushToAll({
    title: 'New Project',
    body: projectName,
    url: `/projects-tasks?project=${projectId}`,
    tag: 'project.created',
  }).catch(() => {})

  return row
}
