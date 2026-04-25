'use client'

function readStoredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem('active-workspace-id') || window.localStorage.getItem('active-workspace-id')
}

export interface CrmStreamEvent {
  type?: string
  [key: string]: unknown
}

export function getCrmWorkspaceHeaders(): HeadersInit {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' }
  const workspaceId = readStoredWorkspaceId()
  return {
    'Content-Type': 'application/json',
    ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
  }
}

export async function crmFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...getCrmWorkspaceHeaders(),
      ...(init?.headers || {}),
    },
  })
  const payload = await response.json() as { data: T; error: string | null }
  if (!response.ok || payload.error) {
    throw new Error(payload.error || 'CRM request failed')
  }
  return payload.data
}
export async function crmStream(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  onEvent: (event: CrmStreamEvent) => void,
): Promise<void> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...getCrmWorkspaceHeaders(),
      ...(init?.headers || {}),
    },
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || 'CRM stream failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const dataLines = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length) {
        const payload = dataLines.join('\n')
        if (payload === '[DONE]') return
        const event = JSON.parse(payload) as CrmStreamEvent
        onEvent(event)
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
