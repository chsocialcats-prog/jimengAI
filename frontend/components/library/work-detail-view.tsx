'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, BookMarked, ChevronRight, Clock, LoaderCircle, Map, Pencil, Play, Sparkles, Users } from 'lucide-react'
import { StartAdventureDialog } from '@/components/adventure/start-adventure-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { api, type Work, type Worldbook } from '@/lib/api'
import { workCover } from './work-card'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近更新'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

export function WorkDetailView() {
  const searchParams = useSearchParams()
  const workId = Number(searchParams.get('work'))
  const [work, setWork] = useState<Work | null>(null)
  const [worldbook, setWorldbook] = useState<Worldbook | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [startOpen, setStartOpen] = useState(false)

  useEffect(() => {
    if (!Number.isInteger(workId) || workId <= 0) {
      setLoading(false)
      setError('作品链接无效。')
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const nextWork = await api.getWork(workId)
        const nextWorldbook = nextWork.worldbook_id ? await api.getWorldbook(nextWork.worldbook_id) : null
        if (cancelled) return
        setWork(nextWork)
        setWorldbook(nextWorldbook)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '无法读取作品信息')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [workId])

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在打开作品…</div>
  if (error || !work) return <WorkUnavailable description={error || '找不到这部作品。'} />

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="rounded-full" render={<Link href="/" />} nativeButton={false}><ArrowLeft data-icon="inline-start" />返回作品库</Button>
        {work.can_edit && <Button variant="outline" size="sm" className="rounded-full" render={<Link href={`/editor?work=${work.id}`} />} nativeButton={false}><Pencil data-icon="inline-start" />编辑作品</Button>}
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(210px,280px)_minmax(0,1fr)] lg:items-end">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-muted shadow-lg shadow-primary/10">
          <img src={workCover(work)} alt={`《${work.title}》封面`} className="size-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent p-5 pt-16">
            <p className="text-xs font-medium tracking-wide text-white/70">AI 文字冒险</p>
            <p className="mt-1 font-rounded text-xl font-bold text-white">{work.title}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col lg:pb-1">
          <div className="flex flex-wrap gap-2">
            {work.is_archive ? <Badge variant="outline" className="rounded-full">作品已归档</Badge> : <Badge variant="secondary" className="rounded-full">可开始冒险</Badge>}
            {work.tags.map((tag) => <Badge key={tag} variant="outline" className="rounded-full font-normal">{tag}</Badge>)}
          </div>
          <h1 className="mt-4 font-rounded text-3xl font-extrabold text-foreground sm:text-4xl">{work.title}</h1>
          <p className="mt-3 max-w-2xl whitespace-pre-wrap text-pretty text-base leading-7 text-muted-foreground">{work.description || '这部作品还没有简介。'}</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><Users className="size-4 text-primary" />{work.cards.length ? `${work.cards.length} 张角色卡` : '自由叙事'}</span>
            <span className="flex items-center gap-1.5"><Clock className="size-4 text-primary" />更新于 {formatDate(work.updated_at)}</span>
            {worldbook && <span className="flex items-center gap-1.5"><BookMarked className="size-4 text-primary" />{worldbook.title}</span>}
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" className="rounded-full" onClick={() => setStartOpen(true)} disabled={work.is_archive}><Play data-icon="inline-start" />开始新冒险</Button>
            {work.onboarding?.enabled && <span className="inline-flex items-center gap-1.5 self-center text-xs text-muted-foreground"><Sparkles className="size-3.5 text-primary" />开始前将先完成开局设定</span>}
          </div>
        </div>
      </section>

      <Separator className="my-9" />

      <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-9">
          <section>
            <SectionHeading icon={BookMarked} title="开场剧情" subtitle="进入冒险后，系统会从这里开始讲述。" />
            <div className="mt-4 border-l-2 border-primary/40 pl-5 font-serif text-[15px] leading-8 text-foreground sm:text-base">
              {work.opening || '故事从这里开始。'}
            </div>
          </section>

          {worldbook && <section>
            <SectionHeading icon={Map} title="世界书" subtitle={worldbook.description || '这份设定会按剧情关键词补充到对话中。'} />
            <div className="mt-4 divide-y divide-border rounded-2xl border border-border/70 bg-card">
              {(worldbook.entries || []).filter((entry) => entry.enabled).length ? (worldbook.entries || []).filter((entry) => entry.enabled).map((entry) => <div key={entry.id} className="p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-foreground">{entry.title}</h3><Badge variant="secondary" className="rounded-full text-[11px]">优先级 {entry.priority}</Badge>{entry.keywords.map((keyword) => <Badge key={keyword} variant="outline" className="rounded-full text-[11px] font-normal">{keyword}</Badge>)}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{entry.content}</p></div>) : <p className="p-4 text-sm text-muted-foreground">这份世界书还没有启用的条目。</p>}
            </div>
          </section>}
        </div>

        <aside className="lg:border-l lg:border-border/70 lg:pl-7">
          <SectionHeading icon={Users} title="出场角色" subtitle={work.cards.length ? '角色卡会按此顺序参与剧情。' : '本作没有绑定角色卡。'} />
          <div className="mt-4 flex flex-col gap-3">
            {work.cards.map((card, index) => <div key={card.id} className="flex gap-3 rounded-2xl bg-secondary/45 p-3"><Avatar className="size-10 rounded-xl"><AvatarFallback>{card.name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs text-primary">{String(index + 1).padStart(2, '0')}</span><h3 className="truncate text-sm font-semibold text-foreground">{card.name}</h3></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{card.persona || card.personality || card.speaking_style || '尚未填写角色描述。'}</p></div></div>)}
          </div>
        </aside>
      </div>

      <StartAdventureDialog work={work} open={startOpen} onOpenChange={setStartOpen} />
    </div>
  )
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof BookMarked; title: string; subtitle: string }) {
  return <div><div className="flex items-center gap-2"><Icon className="size-4 text-primary" /><h2 className="font-rounded text-lg font-bold text-foreground">{title}</h2></div><p className="mt-1 text-sm leading-6 text-muted-foreground">{subtitle}</p></div>
}

function WorkUnavailable({ description }: { description: string }) {
  return <div className="flex min-h-[60vh] items-center justify-center p-6"><Empty className="max-w-md rounded-2xl border border-dashed border-border bg-card/50 py-14"><EmptyHeader><EmptyMedia variant="icon"><BookMarked /></EmptyMedia><EmptyTitle>无法打开作品</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader><EmptyContent><Button className="rounded-full" render={<Link href="/" />} nativeButton={false}><ChevronRight data-icon="inline-start" />返回作品库</Button></EmptyContent></Empty></div>
}
