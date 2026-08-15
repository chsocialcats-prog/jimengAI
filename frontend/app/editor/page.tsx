import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { EditorView } from '@/components/editor/editor-view'

export default function EditorPage() {
  return (
    <AppShell>
      <Suspense fallback={null}><EditorView /></Suspense>
    </AppShell>
  )
}
