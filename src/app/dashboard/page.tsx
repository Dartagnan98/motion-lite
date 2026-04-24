import { getUserWorkspaces, getTasks, getProjects } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const workspaces = getUserWorkspaces(user.id)
  if (workspaces.length === 0) return <div className="p-6 text-text-dim">No workspace yet.</div>

  const ws = workspaces[0]
  const allTasks = getTasks({ workspaceId: ws.id })
  const projects = getProjects(ws.id)

  const now = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().split('T')[0]

  // Compute day boundaries for last 7 days
  const last7Days: { label: string; dateStr: string }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    last7Days.push({
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dateStr: d.toISOString().split('T')[0],
    })
  }

  const activeTasks = allTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived')
  const completedThisWeek = allTasks.filter(t => t.completed_at && t.completed_at > now - 7 * 86400)
  const overdueTasks = allTasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled')

  // Status distribution (active only)
  const statusCounts = {
    todo: allTasks.filter(t => t.status === 'todo' || t.status === 'backlog').length,
    inProgress: allTasks.filter(t => t.status === 'in_progress').length,
    done: allTasks.filter(t => t.status === 'done').length,
    blocked: allTasks.filter(t => t.status === 'blocked').length,
    review: allTasks.filter(t => t.status === 'review').length,
  }
  const statusTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  // Priority distribution (active only)
  const priorityCounts = {
    urgent: activeTasks.filter(t => t.priority === 'urgent').length,
    high: activeTasks.filter(t => t.priority === 'high').length,
    medium: activeTasks.filter(t => t.priority === 'medium').length,
    low: activeTasks.filter(t => t.priority === 'low').length,
  }
  const priorityTotal = Object.values(priorityCounts).reduce((a, b) => a + b, 0)

  // Tasks completed per day (last 7 days)
  const completedPerDay = last7Days.map(day => {
    const dayStart = new Date(day.dateStr).getTime() / 1000
    const dayEnd = dayStart + 86400
    return {
      ...day,
      count: allTasks.filter(t => t.completed_at && t.completed_at >= dayStart && t.completed_at < dayEnd).length,
    }
  })
  const maxCompleted = Math.max(...completedPerDay.map(d => d.count), 1)

  // Project progress
  const projectStats = projects
    .map(p => {
      const projectTasks = allTasks.filter(t => t.project_id === p.id)
      const done = projectTasks.filter(t => t.status === 'done').length
      return {
        name: p.name,
        color: p.color,
        total: projectTasks.length,
        done,
        pct: projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0,
      }
    })
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total)

  // Upcoming deadlines (next 5 tasks with due dates)
  const upcoming = activeTasks
    .filter(t => t.due_date && t.due_date >= today)
    .sort((a, b) => (a.due_date! > b.due_date! ? 1 : -1))
    .slice(0, 5)

  // Build conic gradient for donut chart
  function buildConicGradient(segments: { value: number; color: string }[]) {
    const total = segments.reduce((a, s) => a + s.value, 0)
    if (total === 0) return 'conic-gradient(var(--border) 0deg 360deg)'
    let currentDeg = 0
    const stops: string[] = []
    for (const seg of segments) {
      const deg = (seg.value / total) * 360
      stops.push(`${seg.color} ${currentDeg}deg ${currentDeg + deg}deg`)
      currentDeg += deg
    }
    return `conic-gradient(${stops.join(', ')})`
  }

  const statusGradient = buildConicGradient([
    { value: statusCounts.todo, color: 'var(--blue)' },
    { value: statusCounts.inProgress, color: 'var(--gold)' },
    { value: statusCounts.review, color: 'var(--purple)' },
    { value: statusCounts.done, color: 'var(--green)' },
    { value: statusCounts.blocked, color: 'var(--red)' },
  ])

  const priorityGradient = buildConicGradient([
    { value: priorityCounts.urgent, color: 'var(--priority-urgent)' },
    { value: priorityCounts.high, color: 'var(--priority-high)' },
    { value: priorityCounts.medium, color: 'var(--priority-medium)' },
    { value: priorityCounts.low, color: 'var(--priority-low)' },
  ])

  function formatDueDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    const diff = Math.ceil((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function priorityColor(p: string): string {
    const map: Record<string, string> = {
      urgent: 'var(--priority-urgent)',
      high: 'var(--priority-high)',
      medium: 'var(--priority-medium)',
      low: 'var(--priority-low)',
    }
    return map[p] || 'var(--text-dim)'
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-[14px] font-semibold text-text">Dashboard</h1>
        <span className="text-[11px] text-text-dim">{ws.name}</span>
      </div>

      <div className="p-6">
        {/* Number cards row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <NumberCard label="Active Tasks" value={activeTasks.length} />
          <NumberCard label="Completed This Week" value={completedThisWeek.length} color="var(--green)" />
          <NumberCard label="Overdue Tasks" value={overdueTasks.length} color="var(--red)" alert={overdueTasks.length > 0} />
        </div>

        {/* Charts row: donut charts + bar chart */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}>
          {/* Tasks by Status - Donut */}
          <div className="rounded-md border border-border glass glass-interactive" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Tasks by Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: statusGradient,
                position: 'relative',
                flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute',
                  inset: '30px',
                  borderRadius: '50%',
                  background: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>{statusTotal}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                <DonutLegend color="var(--blue)" label="Todo / Backlog" value={statusCounts.todo} />
                <DonutLegend color="var(--gold)" label="In Progress" value={statusCounts.inProgress} />
                <DonutLegend color="var(--purple)" label="Review" value={statusCounts.review} />
                <DonutLegend color="var(--green)" label="Done" value={statusCounts.done} />
                <DonutLegend color="var(--red)" label="Blocked" value={statusCounts.blocked} />
              </div>
            </div>
          </div>

          {/* Tasks by Priority - Donut */}
          <div className="rounded-md border border-border glass glass-interactive" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Tasks by Priority</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: priorityGradient,
                position: 'relative',
                flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute',
                  inset: '30px',
                  borderRadius: '50%',
                  background: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>{priorityTotal}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                <DonutLegend color="var(--priority-urgent)" label="ASAP" value={priorityCounts.urgent} />
                <DonutLegend color="var(--priority-high)" label="High" value={priorityCounts.high} />
                <DonutLegend color="var(--priority-medium)" label="Medium" value={priorityCounts.medium} />
                <DonutLegend color="var(--priority-low)" label="Low" value={priorityCounts.low} />
              </div>
            </div>
          </div>

          {/* Tasks Completed Per Day - Bar Chart */}
          <div className="rounded-md border border-border glass glass-interactive" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>
              Completed Per Day
              <span style={{ fontWeight: 400, color: 'var(--text-dim)', marginLeft: '8px', fontSize: '11px' }}>Last 7 days</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '100px' }}>
              {completedPerDay.map((day, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  {day.count > 0 && (
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '4px' }}>{day.count}</span>
                  )}
                  <div style={{
                    width: '100%',
                    maxWidth: '32px',
                    height: `${Math.max((day.count / maxCompleted) * 80, day.count > 0 ? 8 : 3)}px`,
                    background: day.count > 0 ? 'var(--accent)' : 'var(--border)',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease',
                  }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '6px' }}>{day.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row: Project progress + Upcoming deadlines */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
        }}>
          {/* Project Progress */}
          {projectStats.length > 0 && (
            <div className="rounded-md border border-border glass glass-interactive" style={{ padding: '20px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Project Progress</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {projectStats.map((p, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: p.color,
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: '12px', color: 'var(--text)' }}>{p.name}</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{p.done}/{p.total} ({p.pct}%)</span>
                    </div>
                    <div style={{
                      height: '6px',
                      background: 'var(--border)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${p.pct}%`,
                        background: p.color,
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming Deadlines */}
          <div className="rounded-md border border-border glass glass-interactive" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Upcoming Deadlines</div>
            {upcoming.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>No upcoming deadlines</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {upcoming.map(t => (
                  <div key={t.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'var(--bg-elevated)',
                  }}>
                    <span style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: priorityColor(t.priority),
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '12px', color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: t.due_date === today ? 'var(--gold)' : 'var(--text-dim)',
                      flexShrink: 0,
                      fontWeight: t.due_date === today ? 600 : 400,
                    }}>
                      {formatDueDate(t.due_date!)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NumberCard({ label, value, color, alert }: { label: string; value: number; color?: string; alert?: boolean }) {
  return (
    <div className="rounded-md border border-border glass glass-interactive" style={{
      background: alert ? 'rgba(239, 83, 80, 0.06)' : undefined,
      padding: '20px',
      borderColor: alert ? 'rgba(239, 83, 80, 0.25)' : undefined,
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: 700, color: color || 'var(--text)', lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  )
}

function DonutLegend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
