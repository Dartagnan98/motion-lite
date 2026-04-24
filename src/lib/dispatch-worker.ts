// DEPRECATED: This worker is replaced by src/dispatch-bridge.ts
// Kept for reference. The bridge polls /api/dispatch/queue and runs
// Claude Code locally instead of just sending Telegram notifications.

import { getPendingDispatches, updateDispatch, getTask, updateTask, createTaskActivity } from './db'

let isRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

function getTelegramConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.ALLOWED_CHAT_IDS?.split(',')[0] || '',
  }
}

async function sendToTelegram(text: string): Promise<boolean> {
  const { token, chatId } = getTelegramConfig()
  if (!token || !chatId) {
    console.error('[dispatch-worker] Missing TELEGRAM_BOT_TOKEN or ALLOWED_CHAT_IDS')
    return false
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    return res.ok
  } catch (err) {
    console.error('[dispatch-worker] Telegram send failed:', err)
    return false
  }
}

async function processDispatch(item: typeof getPendingDispatches extends () => (infer T)[] ? T : never) {
  // Mark as running
  updateDispatch(item.id, {
    status: 'running',
    started_at: Math.floor(Date.now() / 1000),
    attempt_count: item.attempt_count + 1,
  })

  // Build the task message
  let taskInfo = ''
  if (item.task_id) {
    const task = getTask(item.task_id)
    if (task) {
      updateTask(item.task_id, { status: 'in_progress' })
      createTaskActivity(item.task_id, 'dispatched', 'Sent to Telegram for execution')
      taskInfo = `<b>Task #${task.id}:</b> ${task.title}`
      if (task.description) taskInfo += `\n${task.description}`
      taskInfo += `\nPriority: ${task.priority}`
      if (task.due_date) taskInfo += `\nDue: ${task.due_date}`
    }
  }

  const prompt = item.input_context || ''

  const msg = [
    `<b>[Dispatch #${item.id}]</b>`,
    taskInfo,
    prompt ? `\n${prompt}` : '',
    '',
    item.task_id ? `When done, update task #${item.task_id} to done and log what was accomplished.` : '',
  ].filter(Boolean).join('\n')

  const sent = await sendToTelegram(msg)

  if (sent) {
    // Mark as sent (not completed) -- completion requires explicit callback or operator ack
    updateDispatch(item.id, {
      status: 'sent',
      result: 'Delivered to Telegram, awaiting completion',
    })
  } else {
    if (item.attempt_count + 1 < item.max_retries) {
      const backoff = Math.pow(2, item.attempt_count) * 30
      updateDispatch(item.id, {
        status: 'pending',
        error: 'Telegram delivery failed',
        next_retry_at: Math.floor(Date.now() / 1000) + backoff,
      })
    } else {
      updateDispatch(item.id, {
        status: 'failed',
        error: 'Telegram delivery failed after retries',
        completed_at: Math.floor(Date.now() / 1000),
      })
    }
  }
}

async function poll() {
  if (isRunning) return
  isRunning = true
  try {
    const pending = getPendingDispatches()
    for (const item of pending) {
      await processDispatch(item)
    }
  } catch (err) {
    console.error('[dispatch-worker] Poll error:', err)
  } finally {
    isRunning = false
  }
}

export function startDispatchWorker(intervalMs = 10000) {
  if (intervalId) return
  console.log(`[dispatch-worker] Started, polling every ${intervalMs / 1000}s (Telegram relay)`)
  intervalId = setInterval(poll, intervalMs)
  poll()
}

export function stopDispatchWorker() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
