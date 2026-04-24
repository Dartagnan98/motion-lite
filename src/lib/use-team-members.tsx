'use client'

import { useState, useEffect } from 'react'

export interface AssigneeMember {
  id: string
  name: string
  role: string
  type: 'human' | 'agent'
  avatar: string   // URL or initial letter
  color: string
}

const FALLBACK: AssigneeMember[] = [
  { id: 'operator', name: 'Operator', role: 'Owner', type: 'human', avatar: 'D', color: '#7a6b55' },
]

// Module-level cache so multiple components share one fetch
let _cache: AssigneeMember[] | null = null
let _promise: Promise<AssigneeMember[]> | null = null

function fetchMembers(): Promise<AssigneeMember[]> {
  if (_promise) return _promise
  _promise = fetch('/api/team?format=assignees')
    .then(r => r.json())
    .then(data => {
      if (Array.isArray(data) && data.length > 0) {
        _cache = data
        return data
      }
      return FALLBACK
    })
    .catch(() => FALLBACK)
  return _promise
}

/** Invalidate cache (call after adding/removing members) */
export function invalidateTeamCache() {
  _cache = null
  _promise = null
}

/**
 * Shared hook: returns team members from /api/team?format=assignees.
 * Module-level cache avoids duplicate fetches across components.
 */
export function useTeamMembers() {
  const [members, setMembers] = useState<AssigneeMember[]>(_cache || FALLBACK)

  useEffect(() => {
    if (_cache) { setMembers(_cache); return }
    fetchMembers().then(setMembers)
  }, [])

  return members
}
