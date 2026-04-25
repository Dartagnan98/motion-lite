import {
  createCrmContact,
  findCrmContactsByPhone,
  getCrmContactByEmail,
  updateCrmContact,
} from '@/lib/db'

/**
 * Shared helper: upsert a contact for an incoming lead-ad submission.
 *
 * Match order: email (case-insensitive) first, then phone (digit match).
 * When creating a new contact, stamp the source so the attribution report
 * can segment by lead source + form name.
 */
export async function upsertContactForLead(workspaceId: number, data: {
  email: string | null
  phone: string | null
  fullName: string | null
  formName: string | null
  source: 'facebook' | 'google'
}): Promise<{ contactId: number; created: boolean }> {
  const sourceLabel = data.formName
    ? `${data.source}_lead:${data.formName}`
    : `${data.source}_lead`

  if (data.email) {
    const existing = getCrmContactByEmail(workspaceId, data.email)
    if (existing) {
      const patch: Parameters<typeof updateCrmContact>[2] = {}
      if (!existing.phone && data.phone) patch.phone = data.phone
      if (!existing.source) patch.source = sourceLabel
      if (existing.name === existing.email && data.fullName) patch.name = data.fullName
      if (Object.keys(patch).length > 0) updateCrmContact(existing.id, workspaceId, patch)
      return { contactId: existing.id, created: false }
    }
  }

  if (data.phone) {
    const matches = findCrmContactsByPhone(data.phone, workspaceId)
    const match = matches[0]
    if (match) {
      const patch: Parameters<typeof updateCrmContact>[2] = {}
      if (!match.email && data.email) patch.email = data.email
      if (!match.source) patch.source = sourceLabel
      if (match.name === match.phone && data.fullName) patch.name = data.fullName
      if (Object.keys(patch).length > 0) updateCrmContact(match.id, workspaceId, patch)
      return { contactId: match.id, created: false }
    }
  }

  const displayName = data.fullName || data.email || data.phone || `${data.source} lead`
  const created = createCrmContact({
    workspaceId,
    name: displayName,
    email: data.email,
    phone: data.phone,
  })
  try {
    updateCrmContact(created.id, workspaceId, { source: sourceLabel })
  } catch { /* best-effort */ }
  return { contactId: created.id, created: true }
}
