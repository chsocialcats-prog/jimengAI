'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Sparkles, Library, Boxes, Bookmark, Menu, User, Info, LogOut, Settings, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/theme-toggle'
import { FloatingQuickActions } from '@/components/floating-quick-actions'
import { api } from '@/lib/api'
import { API_STATUS_UPDATED_EVENT, getCachedApiStatus, type ApiStatus, type ApiStatusUpdatedDetail } from '@/lib/api-status'
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

function AccountMenu() {
  const router = useRouter()
  const { session, loading, setSession, user } = useSession()

  if (loading) {
    return (
      <div className="flex size-9 items-center justify-center" aria-label="正在检查登录状态" role="status">
        <span className="size-8 rounded-full bg-muted" aria-hidden="true" />
      </div>
    )
  }

  if (!session.authenticated || !user) {
    return (
      <Button variant="outline" size="sm" className="rounded-full" render={<Link href="/login" />} nativeButton={false}>
        <LogIn data-icon="inline-start" />
        登录
      </Button>
    )
  }

  const logout = async () => {
    try {
      await api.logout()
      setSession({ authenticated: false, user: null })
      toast.success('已退出登录')
      router.push('/')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '退出失败')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button className="flex items-center gap-2 rounded-full p-0.5 pr-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
            <Avatar className="size-8">
              {user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.username} 的头像`} />}
              <AvatarFallback>{user.username.slice(0, 1)}</AvatarFallback>
            </Avatar>
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar className="size-9">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.username} 的头像`} />}
            <AvatarFallback>{user.username.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{user.username}</span>
            <span className="text-xs text-muted-foreground">本地账户</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/account" />}>
            <User className="size-4" />
            账户信息
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings className="size-4" />
            设置
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Info className="size-4" />
            关于织梦
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}>
          <LogOut className="size-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
