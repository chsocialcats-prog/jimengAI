'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Play, Trash2, Archive, RotateCcw, MoreVertical, Clock, Save, LoaderCircle, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { api, type Conversation, type Snapshot, type Work } from '@/lib/api'
import { useSession } from '@/components/session-provider'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function SavesView() {
  const router = useRouter()
  const { session } = useSession()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [works, setWorks] = useState<Work[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  const [snapshotTarget, setSnapshotTarget] = useState<Conversation | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  const load = async () => {
    if (!session.authenticated) { setLoading(false); return }
    setLoading(true)
    try {
      const [nextConversations, nextWorks] = await Promise.all([api.listConversations(), api.listWorks()])
      setConversations(nextConversations)
      setWorks(nextWorks)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取存档')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [session.authenticated])

  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works])
  const openSnapshots = async (conversation: Conversation) => {
    setSnapshotTarget(conversation)
    setSnapshotLoading(true)
    try { setSnapshots(await api.listSnapshots(conversation.id)) } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取存档点') } finally { setSnapshotLoading(false) }
  }
  const continueAdventure = async (conversation: Conversation) => {
    try {
      if (conversation.status === 'archived') await api.restoreConversation(conversation.id)
      router.push(`/adventure?conversation=${conversation.id}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法恢复会话') }
  }
  const toggleArchive = async (conversation: Conversation) => {
    try {
      const updated = conversation.status === 'active' ? await api.archiveConversation(conversation.id) : await api.restoreConversation(conversation.id)
      setConversations((previous) => previous.map((item) => item.id === updated.id ? updated : item))
      toast.success(updated.status === 'archived' ? '会话已归档' : '会话已恢复')
    } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败') }
  }
  const deleteConversation = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteConversation(deleteTarget.id)
      setConversations((previous) => previous.filter((item) => item.id !== deleteTarget.id))
      toast.success('存档已删除')
      setDeleteTarget(null)
    } catch (error) { toast.error(error instanceof Error ? error.message : '删除失败') }
  }
  const createSnapshot = async () => {
    if (!snapshotTarget) return
    try {
      const snapshot = await api.createSnapshot(snapshotTarget.id, `手动存档 ${new Date().toLocaleString('zh-CN')}`, '从存档页创建')
      setSnapshots((previous) => [snapshot, ...previous])
      toast.success('已创建手动存档')
    } catch (error) { toast.error(error instanceof Error ? error.message : '创建存档失败') }
  }
  const restoreSnapshot = async (snapshot: Snapshot) => {
    if (!snapshotTarget) return
    try {
      await api.restoreSnapshot(snapshotTarget.id, snapshot.id)
      toast.success('已恢复到这个存档点')
      router.push(`/adventure?conversation=${snapshotTarget.id}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '恢复失败') }
  }

  if (!session.authenticated) return <SavesEmpty title="登录后查看存档" description="冒险会话和手动存档都只对当前账户可见。" actionLabel="前往登录" />
  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取存档…</div>

  return <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6"><header className="flex flex-col gap-1.5"><h1 className="font-rounded text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">我的存档</h1><p className="text-sm text-muted-foreground">继续未完成的冒险、管理会话状态，或恢复手动存档点。</p></header>{conversations.length === 0 ? <SavesEmpty title="还没有冒险存档" description="从作品库开始一次冒险后，进度会自动保存到这里。" actionLabel="前往作品库" /> : <div className="mt-6 flex flex-col gap-4">{conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} work={conversation.work_id ? workById.get(conversation.work_id) : undefined} onContinue={() => void continueAdventure(conversation)} onSnapshots={() => void openSnapshots(conversation)} onArchive={() => void toggleArchive(conversation)} onDelete={() => setDeleteTarget(conversation)} />)}</div>}

    <Dialog open={!!snapshotTarget} onOpenChange={(open) => !open && setSnapshotTarget(null)}><DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{snapshotTarget?.title || '存档点'}</DialogTitle><DialogDescription>手动存档会保存该会话的剧情消息与角色状态。</DialogDescription></DialogHeader><div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void createSnapshot()}><Save />创建手动存档</Button></div>{snapshotLoading ? <p className="py-8 text-center text-sm text-muted-foreground">正在读取存档点…</p> : snapshots.length ? <div className="flex flex-col gap-2">{snapshots.map((snapshot) => <div key={snapshot.id} className="flex items-center gap-3 rounded-2xl border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{snapshot.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(snapshot.created_at)}{snapshot.note ? ` · ${snapshot.note}` : ''}</p></div><Button size="sm" className="rounded-full" onClick={() => void restoreSnapshot(snapshot)}><RotateCcw />恢复</Button></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">还没有手动存档点。</p>}<DialogFooter><Button variant="ghost" onClick={() => setSnapshotTarget(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除这个冒险？</AlertDialogTitle><AlertDialogDescription>会话消息、状态与关联的存档点都会被删除，且无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteConversation()}>删除存档</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

function ConversationRow({ conversation, work, onContinue, onSnapshots, onArchive, onDelete }: { conversation: Conversation; work?: Work; onContinue: () => void; onSnapshots: () => void; onArchive: () => void; onDelete: () => void }) {
  return <article className="flex flex-col gap-4 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:flex-row sm:items-center"><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary"><BookOpen className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-medium text-foreground">{conversation.title}</h2><Badge variant={conversation.status === 'active' ? 'secondary' : 'outline'} className="rounded-full">{conversation.status === 'active' ? '进行中' : '已归档'}</Badge></div><p className="mt-1 truncate text-sm text-muted-foreground">{work?.title || '原作品已删除或不可用'}</p><p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" />最后更新：{formatDate(conversation.updated_at)}</p></div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" className="rounded-full" onClick={onSnapshots}><Save data-icon="inline-start" />存档点</Button><Button size="sm" className="rounded-full" onClick={onContinue}><Play data-icon="inline-start" />{conversation.status === 'archived' ? '恢复并继续' : '继续'}</Button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="存档操作"><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={onArchive}>{conversation.status === 'active' ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}{conversation.status === 'active' ? '归档会话' : '恢复会话'}</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 className="size-4" />删除会话</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></article>
}

function SavesEmpty({ title, description, actionLabel }: { title: string; description: string; actionLabel: string }) {
  const href = actionLabel === '前往登录' ? '/login' : '/'
  return <Empty className="mt-8 rounded-3xl border border-dashed border-border bg-card/50 py-16"><EmptyHeader><EmptyMedia variant="icon"><Save /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader><EmptyContent><Button className="rounded-full" onClick={() => { location.href = href }}>{actionLabel}</Button></EmptyContent></Empty>
}
