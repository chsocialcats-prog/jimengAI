'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { StartAdventureDialog } from '@/components/adventure/start-adventure-dialog'
import { Search, X, Plus, SlidersHorizontal, Sparkles, BookOpen, LoaderCircle } from 'lucide-react'
import { api, type Work } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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
import { WorkCard } from '@/components/library/work-card'
import { useSession } from '@/components/session-provider'

type StatusFilter = 'all' | 'active' | 'archived'
type SortKey = 'recent' | 'name'

const sortLabels: Record<SortKey, string> = {
  recent: '最近更新',
  name: '按名称',
}

export function LibraryView() {
  const { session } = useSession()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>('recent')
  const [deleteTarget, setDeleteTarget] = useState<Work | null>(null)
  const [works, setWorks] = useState<Work[]>([])
  const [startTarget, setStartTarget] = useState<Work | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refreshWorks = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setWorks(await api.listWorks())
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取作品库'
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshWorks()
  }, [session.authenticated])

  const tags = useMemo(() => Array.from(new Set(works.flatMap((work) => work.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [works])

  const toggleTag = (tag: string) => {
    setActiveTags((previous) => previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag])
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const list = works.filter((work) => {
      const text = `${work.title} ${work.description} ${work.owner_username}`.toLocaleLowerCase()
      const matchQuery = !needle || text.includes(needle)
      const matchStatus = status === 'all' || (status === 'archived' ? work.is_archive : !work.is_archive)
      const matchTags = activeTags.length === 0 || activeTags.every((tag) => work.tags.includes(tag))
      return matchQuery && matchStatus && matchTags
    })
    return [...list].sort((left, right) => {
      if (sort === 'name') return left.title.localeCompare(right.title, 'zh-CN')
      return String(right.updated_at).localeCompare(String(left.updated_at))
    })
  }, [works, query, status, activeTags, sort])

  const hasFilters = query !== '' || status !== 'all' || activeTags.length > 0
  const resetFilters = () => {
    setQuery('')
    setStatus('all')
    setActiveTags([])
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteWork(deleteTarget.id)
      setWorks((previous) => previous.filter((work) => work.id !== deleteTarget.id))
      toast.success(`已删除《${deleteTarget.title}》`)
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-rounded text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">作品库</h1>
          <p className="text-sm text-muted-foreground">浏览和管理互动叙事作品，从一张空白封面开启新的故事。</p>
        </div>
        <Button render={<Link href={session.authenticated ? '/editor' : '/login'} />} nativeButton={false} size="lg" className="rounded-full sm:hidden">
          <Plus data-icon="inline-start" />
          新建作品
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="h-10 flex-1 rounded-full bg-card">
            <InputGroupAddon><Search className="text-muted-foreground" /></InputGroupAddon>
            <InputGroupInput placeholder="搜索作品名、简介或作者…" value={query} onChange={(event) => setQuery(event.target.value)} />
            {query && (
              <InputGroupAddon align="inline-end">
                <button onClick={() => setQuery('')} aria-label="清除搜索" className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              </InputGroupAddon>
            )}
          </InputGroup>

          <div className="flex items-center gap-3">
            <Tabs value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <TabsList className="rounded-full">
                <TabsTrigger value="all" className="rounded-full">全部</TabsTrigger>
                <TabsTrigger value="active" className="rounded-full">进行中</TabsTrigger>
                <TabsTrigger value="archived" className="rounded-full">已归档</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger className="h-10 rounded-full bg-card" size="default">
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                <SelectValue>{(value: string) => sortLabels[value as SortKey]}</SelectValue>
              </SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="recent">最近更新</SelectItem><SelectItem value="name">按名称</SelectItem></SelectGroup></SelectContent>
            </Select>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => {
              const active = activeTags.includes(tag)
              return <button key={tag} onClick={() => toggleTag(tag)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground')}>{tag}</button>
            })}
            {hasFilters && <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={resetFilters}><X data-icon="inline-start" />清除筛选</Button>}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{loading ? '正在加载作品库…' : `共 ${filtered.length} 部作品${hasFilters ? ' · 已应用筛选' : ''}`}</p>
      </div>

      {loading ? (
        <div className="mt-12 flex justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取真实数据…</div>
      ) : loadError ? (
        <Empty className="mt-8 rounded-3xl border border-dashed border-border bg-card/50 py-16">
          <EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>无法加载作品库</EmptyTitle><EmptyDescription>{loadError}</EmptyDescription></EmptyHeader>
          <EmptyContent><Button variant="outline" className="rounded-full" onClick={() => void refreshWorks()}>重新加载</Button></EmptyContent>
        </Empty>
      ) : filtered.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Link href={session.authenticated ? '/editor' : '/login'} className="group flex min-h-56 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border bg-card/50 p-6 text-center transition-colors hover:border-primary/50 hover:bg-secondary/40">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary transition-transform group-hover:scale-110"><Plus className="size-7" /></span>
            <div className="flex flex-col gap-0.5"><span className="font-rounded text-sm font-bold text-foreground">新建作品</span><span className="text-xs text-muted-foreground">从空白开始创作</span></div>
          </Link>
          {filtered.map((work, index) => <WorkCard key={work.id} work={work} onPlay={setStartTarget} onDelete={setDeleteTarget} priority={index < 3} />)}
        </div>
      ) : (
        <Empty className="mt-4 rounded-3xl border border-dashed border-border bg-card/50 py-16">
          <EmptyHeader><EmptyMedia variant="icon">{hasFilters ? <Search /> : <BookOpen />}</EmptyMedia><EmptyTitle>{hasFilters ? '没有匹配的作品' : '还没有任何作品'}</EmptyTitle><EmptyDescription>{hasFilters ? '试着调整搜索关键词或清除部分筛选条件。' : '创建你的第一部 AI 文字冒险作品，开启互动叙事之旅。'}</EmptyDescription></EmptyHeader>
          <EmptyContent>{hasFilters ? <Button variant="outline" className="rounded-full" onClick={resetFilters}>清除全部筛选</Button> : <Button render={<Link href={session.authenticated ? '/editor' : '/login'} />} nativeButton={false} className="rounded-full"><Sparkles data-icon="inline-start" />新建作品</Button>}</EmptyContent>
        </Empty>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除这部作品？</AlertDialogTitle><AlertDialogDescription>《{deleteTarget?.title}》及其编辑内容将被移除。此操作不可撤销，相关会话也会受到影响。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void confirmDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除作品</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StartAdventureDialog work={startTarget} open={startTarget !== null} onOpenChange={(open) => !open && setStartTarget(null)} />
    </div>
  )
}
