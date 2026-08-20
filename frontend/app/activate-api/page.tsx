import { Suspense } from 'react'
import { ApiActivationView } from '@/components/activation/api-activation-view'

export default function ActivateApiPage() {
  return <Suspense fallback={null}><ApiActivationView /></Suspense>
}
