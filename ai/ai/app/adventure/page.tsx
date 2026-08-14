import { Suspense } from 'react'
import { AdventureView } from '@/components/adventure/adventure-view'

export default function AdventurePage() {
  return <Suspense fallback={null}><AdventureView /></Suspense>
}
