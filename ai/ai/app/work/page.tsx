import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { WorkDetailView } from '@/components/library/work-detail-view'

export default function WorkPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在打开作品…</div>}>
        <WorkDetailView />
      </Suspense>
    </AppShell>
  )
}
