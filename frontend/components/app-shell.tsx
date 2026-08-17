'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles, Library, Boxes, Bookmark, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/theme-toggle'
import { FloatingQuickActions } from '@/components/floating-quick-actions'
import { AccountMenu } from '@/components/account-menu'
import { API_STATUS_UPDATED_EVENT, getCachedApiStatus, refreshApiStatus, type ApiStatus, type ApiStatusUpdatedDetail } from '@/lib/api-status'
import { useSession } from '@/components/session-provider'

const navItems = [
  { href: '/', label: '作品库', icon: Library },
  { href: '/materials', label: '素材库', icon: Boxes },
  { href: '/saves', label: '我的存档', icon: Bookmark },
]

const apiStatusLabels: Record<ApiStatus, string> = {
  not_checked: '待检测',
  checking: '检查中',
  online: '在线',
  unconfigured: '未配置',
  offline: '不可用',
  unauthenticated: '未登录',
}

const apiStatusDotClasses: Record<ApiStatus, string> = {
  not_checked: 'bg-muted-foreground/55',
  checking: 'bg-amber-500',
  online: 'bg-emerald-500',
  unconfigured: 'bg-muted-foreground/55',
  offline: 'bg-destructive',
  unauthenticated: 'bg-muted-foreground/55',
}

function apiStatusLabel(apiStatus: ApiStatus, providerName: string) {
  const label = apiStatusLabels[apiStatus]
  return apiStatus === 'unauthenticated' ? `API ${label}` : `${providerName} ${label}`
}

function BrandMark({ apiStatus, providerName }: { apiStatus: ApiStatus; providerName: string }) {
  const statusLabel = apiStatusLabel(apiStatus, providerName)
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <Sparkles className="size-5" />
      </span>
      <span className="font-rounded text-lg font-extrabold tracking-tight text-foreground">
        织梦
      </span>
      <Badge variant="outline" title={statusLabel} className="ml-1 hidden gap-1.5 rounded-full text-[10px] font-medium sm:inline-flex">
        <span className={`size-1.5 rounded-full ${apiStatusDotClasses[apiStatus]}`} aria-hidden="true" />
        {statusLabel}
      </Badge>
    </Link>
  )
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {navItems.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { session, loading } = useSession()
  const [apiStatus, setApiStatus] = useState<ApiStatus>('not_checked')
  const [providerName, setProviderName] = useState('API')

  useEffect(() => {
    if (loading) return
    if (!session.authenticated || !session.user) {
      setProviderName('API')
      setApiStatus('unauthenticated')
      return
    }

    const cached = getCachedApiStatus(session.user.id)
    setProviderName(cached?.providerName || 'API')
    setApiStatus(cached?.status || 'not_checked')

    const onStatusUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ApiStatusUpdatedDetail>).detail
      if (detail.userId !== session.user?.id) return
      setProviderName(detail.providerName)
      setApiStatus(detail.status)
    }
    window.addEventListener(API_STATUS_UPDATED_EVENT, onStatusUpdated)
    void refreshApiStatus(session.user.id)
    return () => window.removeEventListener(API_STATUS_UPDATED_EVENT, onStatusUpdated)
  }, [loading, session.authenticated, session.user])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          {/* 移动端菜单 */}
          <Sheet>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="rounded-full md:hidden" aria-label="打开菜单">
                  <Menu className="size-5" />
                </Button>
              }
            />
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-b border-border/60">
                <SheetTitle className="text-left">
                  <BrandMark apiStatus={apiStatus} providerName={providerName} />
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 p-3">
                <NavLinks pathname={pathname} />
              </nav>
            </SheetContent>
          </Sheet>

          <BrandMark apiStatus={apiStatus} providerName={providerName} />

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            <NavLinks pathname={pathname} />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              render={<Link href={session.authenticated ? '/editor' : '/login'} />}
              nativeButton={false}
              className="hidden rounded-full sm:inline-flex"
              size="lg"
              disabled={loading}
            >
              <Sparkles data-icon="inline-start" />
              新建作品
            </Button>
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <FloatingQuickActions />

      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>织梦 · AI 文字冒险</span>
          <span>用心讲好每一个故事</span>
        </div>
      </footer>
    </div>
  )
}
