export interface ProjectETA {
  status: 'on_track' | 'at_risk' | 'ahead' | 'past_deadline' | 'missed_deadline' | 'no_deadline'
  label: string
  color: string  // hex color
  completionPct: number
  estimatedEnd: string | null  // ISO date
  daysRemaining: number | null
}

interface TaskForETA {
  id: number
  status: string
  due_date: string | null
  duration_minutes: number | null
  completed_at: number | null  // unix timestamp
  created_at: number           // unix timestamp
}

interface ProjectForETA {
  deadline: string | null
  start_date: string | null
}

export function calculateProjectETA(project: ProjectForETA, tasks: TaskForETA[]): ProjectETA {
  if (tasks.length === 0) {
    return { status: 'no_deadline', label: 'No tasks', color: '#888', completionPct: 0, estimatedEnd: null, daysRemaining: null }
  }

  const done = tasks.filter(t => t.status === 'done' || t.status === 'cancelled')
  const remaining = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived')
  const completionPct = Math.round((done.length / tasks.length) * 100)

  if (!project.deadline) {
    return { status: 'no_deadline', label: `${completionPct}% complete`, color: '#888', completionPct, estimatedEnd: null, daysRemaining: null }
  }

  const now = new Date()
  const deadline = new Date(project.deadline)
  const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  // All done
  if (remaining.length === 0) {
    return {
      status: daysRemaining >= 0 ? 'ahead' : 'on_track',
      label: 'Complete',
      color: '#4caf50',
      completionPct: 100,
      estimatedEnd: new Date().toISOString().split('T')[0],
      daysRemaining
    }
  }

  // Estimate completion based on velocity
  const earliestCreated = Math.min(...tasks.map(t => t.created_at))
  const startDate = project.start_date ? new Date(project.start_date) : new Date(earliestCreated)
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
  const tasksPerDay = done.length / daysElapsed

  let estimatedEnd: string | null = null
  if (tasksPerDay > 0) {
    const daysToComplete = Math.ceil(remaining.length / tasksPerDay)
    const estDate = new Date(now.getTime() + daysToComplete * 24 * 60 * 60 * 1000)
    estimatedEnd = estDate.toISOString().split('T')[0]
  }

  // Deadline already passed
  if (daysRemaining < 0) {
    return {
      status: 'missed_deadline',
      label: `${Math.abs(daysRemaining)}d overdue`,
      color: '#f44336',
      completionPct, estimatedEnd, daysRemaining
    }
  }

  // Check if estimated completion is after deadline
  if (estimatedEnd && new Date(estimatedEnd) > deadline) {
    const daysOver = Math.ceil((new Date(estimatedEnd).getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24))
    if (daysOver > 5) {
      return { status: 'past_deadline', label: `~${daysOver}d behind`, color: '#ff5722', completionPct, estimatedEnd, daysRemaining }
    }
    return { status: 'at_risk', label: `${daysRemaining}d left`, color: '#ff9800', completionPct, estimatedEnd, daysRemaining }
  }

  // Ahead of schedule
  if (estimatedEnd && new Date(estimatedEnd) < new Date(deadline.getTime() - 3 * 24 * 60 * 60 * 1000)) {
    return { status: 'ahead', label: `${daysRemaining}d left`, color: '#2196f3', completionPct, estimatedEnd, daysRemaining }
  }

  // On track
  return { status: 'on_track', label: `${daysRemaining}d left`, color: '#4caf50', completionPct, estimatedEnd, daysRemaining }
}
