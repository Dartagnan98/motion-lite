import { spawn } from 'child_process'
import { getTask, updateTask, getAgent, updateAgent, createTaskActivity, getAgentSkill, updateAgentSkill } from './db'
import type { Task } from './types'

interface ExecutionResult {
  success: boolean
  output: string
  error?: string
}

// Build context string for the agent
function buildContext(task: Task, agent: { name: string; role: string; system_prompt: string | null }): string {
  let context = ''
  if (agent.system_prompt) {
    context += agent.system_prompt + '\n\n'
  }
  context += `You are ${agent.name}, role: ${agent.role}.\n\n`
  context += `Task: ${task.title}\n`
  if (task.description) context += `Description: ${task.description}\n`
  context += `Priority: ${task.priority}\n`
  if (task.due_date) context += `Due: ${task.due_date}\n`
  context += `Duration: ${task.duration_minutes || 30} minutes\n`
  context += '\nComplete this task and provide the output.'
  return context
}

// Execute a task via claude -p
export async function executeTask(taskId: number, agentId: string): Promise<ExecutionResult> {
  const task = getTask(taskId)
  if (!task) return { success: false, output: '', error: 'Task not found' }

  const agent = getAgent(agentId)
  if (!agent) return { success: false, output: '', error: 'Agent not found' }

  const prompt = buildContext(task, agent)

  // Update agent status
  updateAgent(agentId, { status: 'working', current_task_id: taskId })
  updateTask(taskId, { status: 'in_progress' })

  // Log start
  createTaskActivity(taskId, 'agent_started', `${agent.name} started working on "${task.title}"`, agentId)

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', prompt], {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 300000, // 5 min timeout
    })

    let output = ''
    let error = ''

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      error += data.toString()
    })

    proc.on('close', (code: number | null) => {
      const success = code === 0

      // Update agent status
      updateAgent(agentId, { status: 'standby', current_task_id: null, last_active: Math.floor(Date.now() / 1000) })

      // Log completion
      createTaskActivity(
        taskId,
        success ? 'agent_completed' : 'agent_failed',
        success
          ? `${agent.name} completed "${task.title}"`
          : `${agent.name} failed on "${task.title}": ${error.slice(0, 200)}`,
        agentId,
        JSON.stringify({ output: output.slice(0, 5000), error: error.slice(0, 1000), exitCode: code })
      )

      if (success) {
        updateTask(taskId, { status: 'review' })
      }

      resolve({ success, output, error })
    })

    proc.on('error', (err: Error) => {
      updateAgent(agentId, { status: 'standby', current_task_id: null })
      createTaskActivity(taskId, 'agent_failed', `${agent.name} failed to start: ${err.message}`, agentId)
      resolve({ success: false, output: '', error: err.message })
    })
  })
}

// Alias for backward compat
export const executeAgentTask = executeTask

// Execute a skill (standalone prompt, not tied to a specific task)
export async function executeSkill(skillId: number, agentId: string): Promise<ExecutionResult> {
  const skill = getAgentSkill(skillId)
  if (!skill) return { success: false, output: '', error: 'Skill not found' }

  const agent = getAgent(agentId)
  if (!agent) return { success: false, output: '', error: 'Agent not found' }

  const prompt = (agent.system_prompt ? agent.system_prompt + '\n\n' : '') + (skill.prompt || skill.name)

  updateAgent(agentId, { status: 'working' })

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', prompt], {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 300000,
    })

    let output = ''
    let error = ''

    proc.stdout.on('data', (data: Buffer) => { output += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { error += data.toString() })

    proc.on('close', (code: number | null) => {
      updateAgent(agentId, { status: 'standby', last_active: Math.floor(Date.now() / 1000) })
      updateAgentSkill(skillId, { last_run: Math.floor(Date.now() / 1000) })
      resolve({ success: code === 0, output, error })
    })

    proc.on('error', (err: Error) => {
      updateAgent(agentId, { status: 'standby' })
      resolve({ success: false, output: '', error: err.message })
    })
  })
}
