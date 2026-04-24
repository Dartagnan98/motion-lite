'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AgendaPage() {
  const router = useRouter()
  const [error, setError] = useState(false)

  useEffect(() => {
    const dateStr = toDateStr(new Date())
    fetch(`/api/agenda/generate?date=${dateStr}`)
      .then(r => r.json())
      .then(data => {
        if (data.docId) {
          router.replace(`/doc/${data.docId}`)
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
  }, [router])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-text-dim text-[14px]">
        Failed to generate today&apos;s agenda.
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center text-text-dim text-[14px]">
      Loading today&apos;s agenda...
    </div>
  )
}
