import { getProject, getStages, getTasks, getWorkspaceById, getDocs, getFolder } from '@/lib/db'
import { ProjectPage as ProjectPageClient } from '@/components/project/ProjectPage'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ params: string[] }> }): Promise<Metadata> {
  const { params: segments } = await params
  const id = parseInt(segments[segments.length - 1])
  const project = isNaN(id) ? null : getProject(id)
  return {
    title: project ? `${project.name} | Motion Lite` : 'Project | Motion Lite',
    description: project?.description || 'Project in Motion Lite',
    openGraph: {
      title: project?.name || 'Project',
      description: project?.description || 'Project in Motion Lite',
      siteName: 'Motion Lite',
    },
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ params: string[] }> }) {
  const { params: segments } = await params
  // URL: /project/{projectId} or /project/{workspaceId}/{projectId} -- ID is always last
  const id = parseInt(segments[segments.length - 1])
  if (isNaN(id)) notFound()
  const project = getProject(id)
  if (!project) notFound()

  const stages = getStages(project.id)
  const tasks = getTasks({ projectId: project.id })
  const workspace = getWorkspaceById(project.workspace_id)
  const docs = getDocs({ projectId: project.id })
  const folder = project.folder_id ? getFolder(project.folder_id) : null

  return (
    <ProjectPageClient
      project={project}
      stages={stages}
      tasks={tasks}
      workspace={workspace}
      docs={docs}
      folder={folder}
    />
  )
}
