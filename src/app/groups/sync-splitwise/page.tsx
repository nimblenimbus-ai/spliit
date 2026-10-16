'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import manifest from './manifest.json'

export default function SyncSplitwisePage() {
  const router = useRouter()
  const [status, setStatus] = useState('Syncing 74 Splitwise groups into your browser...')

  useEffect(() => {
    try {
      // Sort so active groups appear first, ordered by most recently updated
      const sorted = [...manifest].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })

      const recentGroups = sorted.map((g) => ({
        id: g.id,
        name: g.name,
      }))
      const starredGroups = sorted.filter((g) => g.isActive).map((g) => g.id)
      const archivedGroups = sorted.filter((g) => !g.isActive).map((g) => g.id)

      localStorage.setItem('recentGroups', JSON.stringify(recentGroups))
      localStorage.setItem('starredGroups', JSON.stringify(starredGroups))
      localStorage.setItem('archivedGroups', JSON.stringify(archivedGroups))

      for (const g of sorted) {
        if (g.myParticipantId) {
          localStorage.setItem(`${g.id}-activeUser`, g.myParticipantId)
        }
      }

      setStatus('Synced 74 groups (16 active Favorites, 58 Archived) and set active user to Jek Tan! Redirecting...')
      setTimeout(() => {
        router.replace('/groups')
      }, 1200)
    } catch (err) {
      setStatus(`Error syncing: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [router])

  return (
    <div className="max-w-xl mx-auto my-12 p-6 border rounded-lg shadow-sm bg-card text-card-foreground">
      <h1 className="text-xl font-bold mb-2">Splitwise → Spliit Sync</h1>
      <p className="text-sm text-muted-foreground">{status}</p>
    </div>
  )
}
