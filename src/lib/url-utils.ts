/** Generate a doc URL using public_id */
export function docUrl(publicId: string): string {
  return `/doc/${publicId}`
}

/** Generate a project URL using public_id */
export function projectUrl(publicId: string): string {
  return `/project/${publicId}`
}

/** Generate a workspace URL using public_id */
export function workspaceUrl(publicId: string): string {
  return `/workspace/${publicId}`
}

/** Extract identifier from catch-all params (always a public_id string now) */
export function parseDocParams(params: string[]): string | null {
  if (!params || params.length === 0) return null
  return params[params.length - 1] || null
}

/** Extract identifier from catch-all params (always a public_id string now) */
export function parseProjectParams(params: string[]): string | null {
  if (!params || params.length === 0) return null
  return params[params.length - 1] || null
}
