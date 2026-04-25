import { NextResponse, type NextRequest } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'

export function jsonData<T>(data: T, status = 200) {
  return NextResponse.json({ data, error: null }, { status })
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message }, { status })
}

export async function requireCrmWorkspace(request: NextRequest): Promise<{ userId: number; workspaceId: number } | { errorResponse: NextResponse }> {
  try {
    const { user, workspaceId } = await requireAuthWithWorkspace(request)
    return { userId: user.id, workspaceId }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNAUTHORIZED'
    if (message === 'FORBIDDEN') return { errorResponse: jsonError('Forbidden', 403) }
    if (message === 'NO_WORKSPACE') return { errorResponse: jsonError('No workspace available', 400) }
    return { errorResponse: jsonError('Unauthorized', 401) }
  }
}

export function parseRouteInt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

