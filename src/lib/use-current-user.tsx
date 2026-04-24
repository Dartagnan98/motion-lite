'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface CurrentUser {
  id: number
  email: string
  name: string
  role: 'owner' | 'team' | 'client'
  avatar_url: string | null
}

interface UserContextValue {
  user: CurrentUser | null
  loading: boolean
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true })

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) setUser(data.user)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return <UserContext.Provider value={{ user, loading }}>{children}</UserContext.Provider>
}

export function useCurrentUser(): UserContextValue {
  return useContext(UserContext)
}
