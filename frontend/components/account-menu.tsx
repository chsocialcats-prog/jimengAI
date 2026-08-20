'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Feather, Info, LogIn, LogOut, Settings, ShieldCheck, Sparkles, User } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { aboutDream, creatorProfileLink } from '@/lib/about-dream'
import { useSession } from '@/components/session-provider'

export function AccountMenu() {
  const router = useRouter()
  const [aboutOpen, setAboutOpen] = useState(false)
  const { session, loading, setSession, user } = useSession()

  if (loading) {
    return <div className="flex size-9 items-center justify-center" aria-label="正在检查登录状态" role="status"><span className="size-8 rounded-full bg-muted" aria-hidden="true" /></div>
  }

  if (!session.authenticated || !user) {
    return <Button variant="outline" size="sm" className="rounded-full" render={<Link href="/login" />} nativeButton={false}><LogIn data-icon="inline-start" />登录</Button>
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button className="flex items-center gap-2 rounded-full p-0.5 pr-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="打开账户菜单"><Avatar className="size-8">{user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.username} 的头像`} />}<AvatarFallback>{user.username.slice(0, 1)}</AvatarFallback></Avatar></button>} />
        <DropdownMenuContent align="end" className="w-60">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="size-9">{user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.username} 的头像`} />}<AvatarFallback>{user.username.slice(0, 1)}</AvatarFallback></Avatar>
            <div className="flex flex-col"><span className="text-sm font-semibold text-foreground">{user.username}</span><span className="text-xs text-muted-foreground">本地账户</span></div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href="/account" />}><User className="size-4" />账户信息</DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}><Settings className="size-4" />设置</DropdownMenuItem>
            {user.role === 'station_master' && <DropdownMenuItem render={<Link href="/admin" />}><ShieldCheck className="size-4" />站长后台</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => setAboutOpen(true)}><Info className="size-4" />关于织梦</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={logout}><LogOut className="size-4" />退出登录</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-lg">
          <div className="relative overflow-hidden border-b border-border/60 bg-[radial-gradient(circle_at_85%_15%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_11rem)] px-6 py-6 pr-14 sm:px-8 sm:py-7">
            <span className="absolute -right-7 -top-8 size-32 rounded-full border border-primary/15" aria-hidden="true" />
            <span className="absolute right-7 top-7 size-2 rounded-full bg-primary/35" aria-hidden="true" />
            <DialogHeader className="relative gap-3 text-left">
              <div className="flex items-center gap-2 text-primary">
                <span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="size-4" /></span>
                <span className="font-rounded text-sm font-bold tracking-[0.18em]">织梦</span>
              </div>
              <div>
                <DialogTitle className="font-rounded text-2xl font-extrabold tracking-tight sm:text-3xl">关于织梦</DialogTitle>
                <DialogDescription className="mt-2 max-w-sm text-sm leading-6">{aboutDream.description}</DialogDescription>
              </div>
            </DialogHeader>
          </div>

          <div className="soft-scroll min-h-0 space-y-5 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
            <section aria-labelledby="about-creator" className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.055] p-4 sm:p-5">
              <div className="flex items-start gap-4">
                <span className="flex size-16 shrink-0 -rotate-3 items-center justify-center rounded-full border-2 border-primary/45 bg-background/85 text-center font-rounded text-sm font-extrabold leading-4 text-primary shadow-sm" aria-hidden="true">社会<br />の喵</span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p id="about-creator" className="text-xs font-semibold tracking-[0.14em] text-primary">创作者落款</p>
                  <p className="mt-1.5 font-rounded text-xl font-bold text-foreground">{aboutDream.creator}</p>
                  <p className="mt-1 text-xs text-muted-foreground">独立创作 · {aboutDream.publishedAt}</p>
                </div>
              </div>
              <a {...creatorProfileLink} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                B站同名主页 <ExternalLink className="size-3.5" />
              </a>
            </section>

            <div className="flex items-center gap-3 rounded-2xl bg-secondary/70 px-4 py-3 text-sm text-secondary-foreground">
              <Feather className="size-4 shrink-0 text-primary" />
              <span className="font-medium">{aboutDream.purpose}</span>
            </div>

            <section aria-labelledby="about-disclaimer">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                <h3 id="about-disclaimer" className="font-rounded text-sm font-bold text-foreground">使用说明与免责声明</h3>
              </div>
              <ul className="mt-3 space-y-2.5 text-xs leading-5 text-muted-foreground">
                {aboutDream.disclaimers.map((item) => <li key={item} className="grid grid-cols-[auto_1fr] gap-2"><span className="mt-2 size-1 rounded-full bg-primary/65" aria-hidden="true" /><span>{item}</span></li>)}
              </ul>
            </section>
          </div>

          <DialogFooter className="m-0 rounded-none border-t border-border/60 bg-muted/35 px-6 py-3 sm:px-8">
            <Button className="rounded-full px-6" onClick={() => setAboutOpen(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
