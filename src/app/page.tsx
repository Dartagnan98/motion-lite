import { getUserWorkspaces, getTasks, getProjects, getStages } from '@/lib/db'
import { WorkspaceView } from '@/components/tasks/WorkspaceView'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const workspaces = getUserWorkspaces(user.id)
  if (workspaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-white">
          C
        </div>
        <h1 className="text-lg font-semibold text-text">Welcome to Motion Lite</h1>
        <p className="text-sm text-text-dim max-w-sm text-center">
          Create a workspace from the sidebar to get started. Add folders, projects, and tasks to organize your work.
        </p>
      </div>
    )
  }

  const ws = workspaces[0]
  const projects = getProjects(ws.id) ?? []
  const allTasks = getTasks({ workspaceId: ws.id }) ?? []

  const projectGroups = projects.map((project) => {
    const stages = getStages(project.id) ?? []
    const stageGroups = stages.map((stage) => ({
      stage,
      tasks: allTasks.filter((t) => t.project_id === project.id && t.stage_id === stage.id),
    }))
    const unstagedTasks = allTasks.filter((t) => t.project_id === project.id && !t.stage_id)
    return { project, stageGroups, unstagedTasks }
  })

  const unassignedTasks = allTasks.filter((t) => !t.project_id)

  return (
    <WorkspaceView
      title="My Tasks"
      projectGroups={projectGroups}
      unassignedTasks={unassignedTasks}
      allTasks={allTasks}
      workspaceId={ws.id}
      workspaceName={ws.name}
    />
  )
}
