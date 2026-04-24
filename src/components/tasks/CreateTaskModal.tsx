'use client'

import { useState, useEffect, useRef } from 'react'
import { createTaskAction } from '@/lib/actions'
import { Dropdown } from '@/components/ui/Dropdown'
import DatePicker from '@/components/ui/DatePicker'
import { StatusIcon, renderStatusOption } from '@/components/ui/StatusIcon'
import { useTeamMembers } from '@/lib/use-team-members'
import { PRIORITY_OPTIONS as SHARED_PRIORITY, renderPriorityOption } from '@/components/ui/PriorityIcon'
import { STATUS_OPTIONS, DURATION_OPTIONS, DEFAULT_TASK_VALUES } from '@/lib/task-constants'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { IconClock } from '@/components/ui/Icons'

interface ProjectOption {
  id: number
  name: string
  stages: Array<{ id: number; name: string }>
}

const PRIORITY_OPTIONS = SHARED_PRIORITY

// ASSIGNEE_OPTIONS removed -- now dynamic from useTeamMembers()

export function CreateTaskModal({
  workspaceId,
  onClose,
}: {
  workspaceId: number
  onClose: () => void
}) {
  const teamMembers = useTeamMembers()
  const ASSIGNEE_OPTIONS = [{ value: '', label: 'Unassigned' }, ...teamMembers.map(m => ({ value: m.id, label: m.name }))]
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [selectedStage, setSelectedStage] = useState<string>('')
  const [status, setStatus] = useState('todo')
  const [priority, setPriority] = useState('medium')
  const [assignee, setAssignee] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [duration, setDuration] = useState(String(DEFAULT_TASK_VALUES.duration_minutes))
  const [autoSchedule, setAutoSchedule] = useState(DEFAULT_TASK_VALUES.auto_schedule)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/projects?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(async (projs: Array<{ id: number; name: string }>) => {
        const withStages = await Promise.all(projs.map(async (p) => {
          const stages = await fetch(`/api/stages?projectId=${(p as any).public_id || p.id}`).then(r => r.json())
          return { ...p, stages }
        }))
        setProjects(withStages)
      })
    titleRef.current?.focus()
  }, [workspaceId])

  const currentStages = selectedProject
    ? projects.find(p => p.id === Number(selectedProject))?.stages || []
    : []

  const projectOptions = [
    { value: '', label: 'No Project' },
    ...projects.map(p => ({ value: String(p.id), label: p.name })),
  ]

  const stageOptions = [
    { value: '', label: 'No Stage' },
    ...currentStages.map(s => ({ value: String(s.id), label: s.name })),
  ]

  const dropdownTriggerClass = `
    inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px]
    transition-colors cursor-pointer border border-[var(--border)]
    hover:bg-[var(--bg-hover)]
  `

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-[520px] rounded-lg border border-border-strong animate-glass-in"
        style={{ background: 'var(--bg-card)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <form
          action={async (formData) => {
            await createTaskAction(formData)
            onClose()
          }}
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="priority" value={priority} />
          <input type="hidden" name="assignee" value={assignee} />
          {selectedProject && <input type="hidden" name="projectId" value={selectedProject} />}
          {selectedStage && <input type="hidden" name="stageId" value={selectedStage} />}
          <input type="hidden" name="duration_minutes" value={duration} />
          <input type="hidden" name="auto_schedule" value={autoSchedule ? '1' : '0'} />

          {/* Title */}
          <div className="px-5 pt-5 pb-3">
            <input
              ref={titleRef}
              name="title"
              placeholder="Task name"
              className="w-full bg-transparent text-sm font-medium text-text outline-none placeholder:text-text-dim"
              required
            />
          </div>

          {/* Description */}
          <div className="px-5 pb-3">
            <textarea
              name="description"
              placeholder="Description (optional)"
              className="w-full min-h-[60px] resize-none bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-dim"
            />
          </div>

          {/* Properties row */}
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
            <Dropdown
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
              placeholder="Status"
              minWidth={120}
              searchable
              renderOption={renderStatusOption}
              renderTrigger={({ selected }) => (
                <button type="button" className={`${dropdownTriggerClass} ${status ? 'text-text' : 'text-text-dim'}`}>
                  {status ? <StatusIcon status={status} size={14} /> : null}
                  {selected?.label || 'Status'}
                </button>
              )}
            />

            <Dropdown
              value={priority}
              onChange={setPriority}
              options={PRIORITY_OPTIONS}
              placeholder="Priority"
              minWidth={120}
              triggerClassName={`${dropdownTriggerClass} ${priority ? 'text-text' : 'text-text-dim'}`}
            />

            <Dropdown
              value={assignee}
              onChange={setAssignee}
              options={ASSIGNEE_OPTIONS}
              placeholder="Assignee"
              minWidth={140}
              triggerClassName={`${dropdownTriggerClass} ${assignee ? 'text-text' : 'text-text-dim'}`}
            />

            <Dropdown
              value={selectedProject}
              onChange={(v) => {
                setSelectedProject(v)
                setSelectedStage('')
              }}
              options={projectOptions}
              placeholder="No Project"
              minWidth={160}
              searchable={projects.length > 5}
              triggerClassName={`${dropdownTriggerClass} ${selectedProject ? 'text-text' : 'text-text-dim'}`}
            />

            {currentStages.length > 0 && (
              <Dropdown
                value={selectedStage}
                onChange={setSelectedStage}
                options={stageOptions}
                placeholder="No Stage"
                minWidth={120}
                triggerClassName={`${dropdownTriggerClass} ${selectedStage ? 'text-text' : 'text-text-dim'}`}
              />
            )}

            <Dropdown
              value={duration}
              onChange={setDuration}
              options={DURATION_OPTIONS}
              placeholder="Duration"
              minWidth={120}
              renderTrigger={({ selected }) => (
                <button type="button" className={`${dropdownTriggerClass} ${duration !== '0' ? 'text-text' : 'text-text-dim'}`}>
                  <IconClock size={12} />
                  {selected?.label || '30 min'}
                </button>
              )}
            />

            <input type="hidden" name="due_date" value={dueDate} />
            <DatePicker
              value={dueDate}
              onChange={v => setDueDate(v)}
              size="sm"
              placeholder="Due date"
            />

            <AutoScheduleToggle
              active={autoSchedule}
              onChange={() => setAutoSchedule(!autoSchedule)}
              size="sm"
              compact
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[13px] text-text-dim hover:text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/80"
            >
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
