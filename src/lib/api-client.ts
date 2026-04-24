'use client'

import { getActiveWorkspaceId } from './use-active-workspace'

/**
 * Fetch wrapper that automatically attaches the X-Workspace-Id header
 * from the active workspace in localStorage. Drop-in replacement for fetch().
 */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const workspaceId = getActiveWorkspaceId()
  const headers = new Headers(init?.headers)

  if (workspaceId && !headers.has('x-workspace-id')) {
    headers.set('x-workspace-id', String(workspaceId))
  }

  return fetch(url, { ...init, headers })
}

/**
 * GET convenience: apiFetch with JSON parsing.
 */
export async function apiGet<T = any>(url: string): Promise<T> {
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

/**
 * POST convenience: apiFetch with JSON body.
 */
export async function apiPost<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

/**
 * PATCH convenience: apiFetch with JSON body.
 */
export async function apiPatch<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

/**
 * DELETE convenience.
 */
export async function apiDelete<T = any>(url: string): Promise<T> {
  const res = await apiFetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}
