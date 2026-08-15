'use client'

import { Sparkles, Clock, BookMarked, Brain, ChevronRight, Coins, Backpack, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { AdventureState, Conversation, RoleCard } from '@/lib/api'

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 px-1"><Icon className="size-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">{children}</h3></div>
}

function displayValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return '—'
}

function progressValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function isRoleCardSnapshot(value: Conversation['card_snapshot']): value is RoleCard {
  return typeof (value as Partial<RoleCard>).name === 'string'
}

export function StatusPanel({ state, conversation }: { state: AdventureState; conversation: Conversation }) {
  const attributes = Object.entries(state.attributes || {})
  const relations = Object.entries(state.relations || {})
  const characters = Object.entries(state.characters || {})
  const logs = (state.logs || []).slice(0, 5)
  const items = Array.isArray(state.items) ? state.items : []
  const legacyCard = conversation.card_snapshot
  const cards: RoleCard[] = conversation.card_snapshots.length
    ? conversation.card_snapshots
    : (isRoleCardSnapshot(legacyCard) ? [legacyCard] : [])
  const avatarByCharacterName = new Map(cards
    .filter((card) => Boolean(card.name?.trim() && card.avatar_url?.trim()))
    .map((card) => [card.name.trim(), card.avatar_url.trim()]))

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <SectionTitle icon={Clock}>当前进度</SectionTitle>
        <div className="rounded-2xl bg-secondary/60 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{conversation.title}</p>
          <dl className="flex flex-col gap-2.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground"><Clock className="size-3.5 shrink-0" /><dt className="sr-only">状态</dt><dd>{conversation.status === 'active' ? '冒险进行中' : '会话已归档'}</dd></div>
            <div className="flex items-center gap-2 text-muted-foreground"><Coins className="size-3.5 shrink-0" /><dt className="sr-only">金钱</dt><dd>金钱：{displayValue(state.money)}</dd></div>
            <div className="flex items-center gap-2 text-muted-foreground"><Backpack className="size-3.5 shrink-0" /><dt className="sr-only">背包</dt><dd>背包：{items.length ? items.map(displayValue).join('、') : '空'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle icon={Sparkles}>角色属性</SectionTitle>
        {attributes.length ? <div className="flex flex-col gap-4 px-1">{attributes.map(([name, value]) => {
          const percent = progressValue(value)
          return <div key={name} className="flex flex-col gap-1.5"><div className="flex items-center justify-between text-sm"><span className="font-medium text-foreground">{name}</span><span className="tabular-nums text-muted-foreground">{displayValue(value)}</span></div>{percent !== null && <Progress value={percent} className="h-2" />}</div>
        })}</div> : <p className="px-1 text-sm text-muted-foreground">这个作品还没有设置初始属性。</p>}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <SectionTitle icon={Users}>关系与角色</SectionTitle>
        {relations.length || characters.length ? <div className="flex flex-col gap-2 px-1">{relations.map(([name, value]) => <RelationCard key={`relation-${name}`} name={name} avatarUrl={avatarByCharacterName.get(name.trim())} detail={`关系值：${displayValue(value)}`} value={typeof value === 'number' ? value : null} />)}{characters.filter(([name]) => !relations.some(([relation]) => relation === name)).map(([name, profile]) => <RelationCard key={`character-${name}`} name={name} avatarUrl={avatarByCharacterName.get(name.trim())} detail={Object.entries(profile.attributes || {}).slice(0, 2).map(([key, value]) => `${key} ${displayValue(value)}`).join(' · ') || '已加入故事'} value={null} />)}</div> : <p className="px-1 text-sm text-muted-foreground">尚未记录角色关系。</p>}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-1"><SectionTitle icon={Brain}>剧情记忆</SectionTitle><ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" /></CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="mb-3 flex items-start gap-2 rounded-xl bg-accent/50 p-3 text-xs text-accent-foreground"><BookMarked className="mt-0.5 size-3.5 shrink-0" /><p>系统会在对话变长后自动保留关键剧情记忆，确保后续内容保持连贯。</p></div>
            {logs.length ? <ul className="flex flex-col gap-2 px-1">{logs.map((log, index) => <li key={index} className="flex gap-2 text-sm text-muted-foreground"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/50" /><span className="leading-relaxed">{typeof log.message === 'string' ? log.message : JSON.stringify(log)}</span></li>)}</ul> : <p className="px-1 text-sm text-muted-foreground">尚无可展示的状态记录。</p>}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  )
}

function RelationCard({ name, avatarUrl, detail, value }: { name: string; avatarUrl?: string; detail: string; value: number | null }) {
  const level = value === null ? 0 : Math.max(0, Math.min(5, Math.ceil(Math.abs(value) / 20)))
  return <div className="flex items-center gap-3 rounded-2xl bg-card p-2.5 shadow-sm"><Avatar className="size-10">{avatarUrl && <AvatarImage src={avatarUrl} alt={`${name} 头像`} />}<AvatarFallback>{name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{name}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div>{value !== null ? <div className="flex gap-0.5" aria-label={`关系值 ${value}`}>{Array.from({ length: 5 }).map((_, index) => <span key={index} className={cn('size-1.5 rounded-full', index < level ? 'bg-primary' : 'bg-muted')} />)}</div> : <Badge variant="secondary" className="rounded-full text-[10px]">角色</Badge>}</div>
}
