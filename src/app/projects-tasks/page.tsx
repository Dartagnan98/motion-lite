import { getUserWorkspaces, getAllTasksEnriched, getAllProjects, getAllStages, getAllFolders, getViews, getLabels, getAllTaskChunks } from '@/lib/db'
import { ProjectsTasksView } from '@/components/tasks/ProjectsTasksView'
import { MobileHome } from '@/components/MobileHome'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProjectsTasksPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const workspaces = getUserWorkspaces(user.id)
  const wsIds = workspaces.map(w => w.id)
  const rawTasks = getAllTasksEnriched(wsIds)
  const allChunks = getAllTaskChunks()
  const tasks = rawTasks.map(t => ({ ...t, chunks: allChunks[t.id] || [] })) as any
  const projects = getAllProjects(wsIds)
  const stages = getAllStages(wsIds)
  const folders = getAllFolders(wsIds)
  const views = getViews()
  const labels = getLabels()

  return (
    <>
      {/* Mobile: show home view */}
      <div className="sm:hidden h-full">
        <MobileHome />
      </div>
      {/* Desktop: show full projects & tasks view */}
      <div className="hidden sm:flex sm:flex-col h-full">
        <ProjectsTasksView
          tasks={tasks}
          workspaces={workspaces}
          projects={projects}
          stages={stages}
          folders={folders}
          views={views}
          labels={labels}
        />
      </div>
    </>
  )
}
