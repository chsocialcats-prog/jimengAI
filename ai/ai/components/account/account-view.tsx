'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ShieldCheck, LogOut, Crown, UserRound, CalendarDays, Upload, LoaderCircle } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { api } from '@/lib/api'
import { useSession } from '@/components/session-provider'

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function AccountView() {
  const router = useRouter()
  const { session, setSession } = useSession()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  if (!session.authenticated || !session.user) {
    return <div className="mx-auto max-w-2xl px-4 py-10"><Alert><UserRound className="size-4" /><AlertTitle>当前以访客身份浏览</AlertTitle><AlertDescription className="mt-2 flex flex-wrap items-center gap-3">登录后可以创建作品、保存冒险并管理模型设置。<Button size="sm" className="rounded-full" onClick={() => router.push('/login')}>前往登录</Button></AlertDescription></Alert></div>
  }

  const logout = async () => {
    try {
      await api.logout()
      setSession({ authenticated: false, user: null })
      toast.success('已退出登录')
      router.push('/')
    } catch (error) { toast.error(error instanceof Error ? error.message : '退出失败') }
  }
  const changePassword = async () => {
    if (nextPassword.length < 10) { toast.error('新密码至少需要 10 位'); return }
    setSavingPassword(true)
    try {
      const nextSession = await api.changePassword(currentPassword, nextPassword)
      setSession(nextSession)
      setPasswordOpen(false)
      setCurrentPassword('')
      setNextPassword('')
      toast.success('密码已更新')
    } catch (error) { toast.error(error instanceof Error ? error.message : '修改密码失败') } finally { setSavingPassword(false) }
  }

  return <div className="mx-auto max-w-2xl px-4 py-8 md:py-10"><header className="mb-6"><h1 className="font-serif text-2xl font-bold text-foreground md:text-3xl">账户信息</h1><p className="mt-1 text-sm text-muted-foreground">管理本地账户与访问安全。</p></header>
    <Card className="overflow-hidden"><CardHeader><div className="flex items-center gap-4"><Avatar className="size-16">{session.user.avatar_url && <AvatarImage src={session.user.avatar_url} alt={`${session.user.username} 的头像`} />}<AvatarFallback>{session.user.username.slice(0, 1)}</AvatarFallback></Avatar><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><CardTitle className="text-lg">{session.user.username}</CardTitle><Badge className="rounded-full"><Crown className="size-3" /> 创作者</Badge></div><CardDescription>本地账户</CardDescription></div></div></CardHeader><Separator /><CardContent className="pt-6"><FieldGroup><Field><FieldLabel>用户名</FieldLabel><Input value={session.user.username} readOnly /><FieldDescription>用户名由注册时设置，当前版本不支持在线修改。</FieldDescription></Field><Field><FieldLabel>账户创建时间</FieldLabel><div className="flex h-10 items-center gap-2 rounded-xl border border-input px-3 text-sm text-muted-foreground"><CalendarDays className="size-4" />{formatCreatedAt(session.user.created_at)}</div></Field></FieldGroup></CardContent></Card>
    <AvatarUploadCard />
    <Card className="mt-6"><CardHeader><CardTitle className="text-base">访问与安全</CardTitle><CardDescription>账户密码和登录状态只保存在本地服务中。</CardDescription></CardHeader><CardContent><FieldGroup><Field orientation="horizontal"><div className="flex items-start gap-3"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"><ShieldCheck className="size-4" /></span><div className="flex flex-col"><FieldLabel>修改密码</FieldLabel><FieldDescription>密码长度需至少为 10 位。</FieldDescription></div></div><Button variant="outline" size="sm" className="rounded-full" onClick={() => setPasswordOpen(true)}>修改</Button></Field></FieldGroup></CardContent><Separator /><CardFooter className="pt-4"><Button variant="ghost" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void logout()}><LogOut data-icon="inline-start" />退出登录</Button></CardFooter></Card>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent><DialogHeader><DialogTitle>修改密码</DialogTitle><DialogDescription>修改成功后会保持当前登录状态。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="current-password">当前密码</FieldLabel><Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field><Field><FieldLabel htmlFor="next-password">新密码</FieldLabel><Input id="next-password" type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="至少 10 位" /></Field></FieldGroup><DialogFooter><Button variant="ghost" onClick={() => setPasswordOpen(false)}>取消</Button><Button onClick={() => void changePassword()} disabled={savingPassword || !currentPassword || !nextPassword}>{savingPassword ? '正在保存…' : '更新密码'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function AvatarUploadCard() {
  const { session, setSession } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const upload = async (file?: File) => {
    if (!file || !session.user) return
    setUploading(true)
    try {
      const uploaded = await api.uploadImage(file)
      setSession(await api.updateProfile({ avatar_url: uploaded.url }))
      toast.success('账号头像已更新')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '账号头像上传失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  if (!session.user) return null
  return <><Card className="mt-6"><CardHeader><CardTitle className="text-base">账号头像</CardTitle><CardDescription>用于账户菜单和个人资料展示。</CardDescription></CardHeader><CardContent><div className="flex items-center gap-4"><Avatar className="size-16">{session.user.avatar_url && <AvatarImage src={session.user.avatar_url} alt={`${session.user.username} 的头像`} />}<AvatarFallback>{session.user.username.slice(0, 1)}</AvatarFallback></Avatar><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { setCropFile(event.target.files?.[0] || null); event.target.value = '' }} /><Button variant="outline" className="rounded-full" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload data-icon="inline-start" />}{uploading ? '正在上传…' : '上传头像'}</Button></div><p className="mt-3 text-xs text-muted-foreground">支持 PNG、JPEG、WebP、GIF，最大 5 MB。</p></CardContent></Card><ImageCropDialog file={cropFile} shape="avatar" open={Boolean(cropFile)} onOpenChange={(open) => !open && setCropFile(null)} onConfirm={(file) => { setCropFile(null); void upload(file) }} onError={(message) => toast.error(message)} /></>
}
