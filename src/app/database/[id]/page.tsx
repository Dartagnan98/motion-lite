'use client'

import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DatabaseByIdPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string // can be numeric or public_id

  useEffect(() => {
    // Redirect to main database page with open param (supports both numeric and public_id)
    if (id) {
      router.replace(`/database?open=${id}`)
    }
  }, [id, router])

  return (
    <div className="flex items-center justify-center h-screen bg-[#1a1a1a]">
      <div className="text-white/50">Loading database...</div>
    </div>
  )
}
