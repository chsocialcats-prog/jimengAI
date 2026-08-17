'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Info, LogIn, LogOut, Settings, User } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useSession } from '@/components/session-provider'

export function AccountMenu() {
  const router = useRouter()
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
          <DropdownMenuItem><Info className="size-4" />关于织梦</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}><LogOut className="size-4" />退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
