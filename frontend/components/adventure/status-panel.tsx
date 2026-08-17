'use client'

import { useState, type ElementType, type ReactNode } from 'react'
import { Backpack, BookMarked, Brain, ChevronRight, Clock, Coins, NotebookPen, Plus, Sparkles, UserRound, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import type { AdventureState, Conversation, MemorySummary, RoleCard } from '@/lib/api'

const PLAYER_ENTRY_ID = 'player'

type StatusEntry = {
  id: string
  kind: 'character' | 'player'
  name: string
  avatar_url?: string
  avatar_alt?: string
  attributes: Record<string, unknown>
  flags: unknown[]
  relation?: unknown
  card?: RoleCard
}

type LiveCharacter = {
  attributes?: Record<string, unknown>
  flags: unknown[]
}

function SectionTitle({ icon: Icon, children }: { icon: ElementType; children: ReactNode }) {
  return <div className="flex items-center gap-2 px-1"><Icon className="size-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">{children}</h3></div>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.map(displayValue).filter((item) => item !== '—').join('、') || '—'
  return '—'
}

function progressValue(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null
  return value
}

function isRoleCardSnapshot(value: Conversation['card_snapshot']): value is RoleCard {
  return isRecord(value) && typeof value.name === 'string'
}

function roleCardsForConversation(conversation: Conversation) {
  const snapshots = Array.isArray(conversation.card_snapshots) ? conversation.card_snapshots : []
  if (snapshots.length) return snapshots.filter((card) => Boolean(card?.name?.trim()))
  return isRoleCardSnapshot(conversation.card_snapshot) ? [conversation.card_snapshot] : []
}

function readLiveCharacter(value: unknown): LiveCharacter {
  const profile = recordValue(value)
  return {
    attributes: isRecord(profile.attributes) ? profile.attributes : undefined,
    flags: Array.isArray(profile.flags) ? profile.flags : [],
  }
}

function normalizedName(name: string) {
  return name.trim()
}

function buildStatusEntries(state: AdventureState, conversation: Conversation, playerAvatarUrl?: string, playerUsername?: string): StatusEntry[] {
  const cards = roleCardsForConversation(conversation)
  const runtimeCharacters = new Map(
    Object.entries(recordValue(state.characters))
      .map(([name, profile]) => [normalizedName(name), { name: normalizedName(name), profile: readLiveCharacter(profile) }] as const)
      .filter(([name]) => Boolean(name)),
  )
  const relations = new Map(
    Object.entries(recordValue(state.relations))
      .map(([name, value]) => [normalizedName(name), value] as const)
      .filter(([name]) => Boolean(name)),
  )
  const entries: StatusEntry[] = []
  const seenNames = new Set<string>()

  for (const card of cards) {
    const name = normalizedName(card.name)
    if (!name || seenNames.has(name)) continue
    seenNames.add(name)
    const live = runtimeCharacters.get(name)?.profile
    entries.push({
      id: `character:${name}`,
      kind: 'character',
      name,
      attributes: live?.attributes ?? recordValue(card.character_attributes),
      flags: live?.flags ?? [],
      relation: relations.get(name),
      card,
    })
  }

  for (const [name, { profile }] of runtimeCharacters) {
    if (seenNames.has(name)) continue
    entries.push({
      id: `character:${name}`,
      kind: 'character',
      name,
      attributes: profile.attributes ?? {},
      flags: profile.flags,
      relation: relations.get(name),
    })
  }

  entries.push({
    id: PLAYER_ENTRY_ID,
    kind: 'player',
    name: '玩家',
    avatar_url: playerAvatarUrl,
    avatar_alt: playerUsername ? `${playerUsername} 的头像` : '玩家头像',
    attributes: recordValue(state.attributes),
    flags: Array.isArray(state.flags) ? state.flags : [],
  })
  return entries
}

function flagLabels(flags: unknown[]) {
  return flags.map(displayValue).filter((flag) => flag !== '—')
}

function relationRows(entry: StatusEntry) {
  if (entry.kind === 'player') return [] as Array<[string, unknown]>
  const rows: Array<[string, unknown]> = []
  if (entry.relation !== undefined) rows.push(['与玩家关系', entry.relation])
  const snapshotRelations = recordValue(entry.card?.relationships)
  for (const [name, value] of Object.entries(snapshotRelations)) {
    if (name.trim() === '玩家' && entry.relation !== undefined) continue
    rows.push([name, value])
  }
  return rows.slice(0, 4)
}

function logMessage(log: Record<string, unknown>) {
  if (typeof log.message === 'string' && log.message.trim()) return log.message
  if (log.type === 'state_update' && Array.isArray(log.keys)) return `状态已更新：${log.keys.map(displayValue).join('、')}`
  if (typeof log.type === 'string' && log.type.trim()) return log.type
  return '状态已更新'
}

function memoryUpdatedAt(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function StatusPanel({ state, conversation, memorySummary, onAddLog, playerAvatarUrl, playerUsername }: { state: AdventureState; conversation: Conversation; memorySummary: MemorySummary; onAddLog: (content: string) => Promise<void>; playerAvatarUrl?: string; playerUsername?: string }) {
  const [selection, setSelection] = useState<{ conversationId: number; entryId: string } | null>(null)
  const [logEditorOpen, setLogEditorOpen] = useState(false)
  const [logDraft, setLogDraft] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const entries = buildStatusEntries(state, conversation, playerAvatarUrl, playerUsername)
  const selectedEntry = (selection?.conversationId === conversation.id && entries.find((entry) => entry.id === selection.entryId)) || entries[0]
  const roleEntries = entries.filter((entry) => entry.kind === 'character')
  const playerEntry = entries.find((entry) => entry.kind === 'player')
  const items = Array.isArray(state.items) ? state.items : []
  const logs = [...(state.logs || [])].slice(-20).reverse()
  const canAddLog = conversation.status === 'active'

  const saveLog = async () => {
    const content = logDraft.trim()
    if (!content || logSaving) return
    setLogSaving(true)
    try {
      await onAddLog(content)
      setLogDraft('')
      setLogEditorOpen(false)
    } catch {
      // The parent reports the failed request and keeps the draft available.
    } finally {
      setLogSaving(false)
    }
  }

  if (!selectedEntry || !playerEntry) return null

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <SectionTitle icon={Clock}>当前进度</SectionTitle>
        <div className="rounded-2xl bg-secondary/60 p-3.5">
          <p className="mb-2.5 truncate text-sm font-medium text-foreground">{conversation.title}</p>
          <dl className="grid gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><Clock className="size-3.5 shrink-0" /><dt className="sr-only">状态</dt><dd>{conversation.status === 'active' ? '冒险进行中' : '会话已归档'}</dd></div>
            <div className="flex items-center gap-2"><Coins className="size-3.5 shrink-0" /><dt className="sr-only">金钱</dt><dd>金钱：{displayValue(state.money)}</dd></div>
            <div className="flex min-w-0 items-center gap-2"><Backpack className="size-3.5 shrink-0" /><dt className="sr-only">背包</dt><dd className="truncate">背包：{items.length ? items.map(displayValue).join('、') : '空'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="flex min-w-0 gap-3" aria-label="角色状态工作区">
        <nav className="flex w-16 shrink-0 flex-col border-r border-border/60 pr-3" aria-label="角色列表">
          <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto pb-3">
            {roleEntries.map((entry) => <EntitySelector key={entry.id} entry={entry} selected={entry.id === selectedEntry.id} onSelect={() => setSelection({ conversationId: conversation.id, entryId: entry.id })} />)}
          </div>
          <div className="border-t border-border/60 pt-3">
            <EntitySelector entry={playerEntry} selected={playerEntry.id === selectedEntry.id} secondary onSelect={() => setSelection({ conversationId: conversation.id, entryId: playerEntry.id })} />
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          <SelectedEntryDetail entry={selectedEntry} />
        </div>
      </section>

      <Separator />

      <section>
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-1"><SectionTitle icon={Brain}>剧情记忆</SectionTitle><ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" /></CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="rounded-xl bg-accent/50 p-3 text-xs text-accent-foreground"><div className="flex items-start gap-2"><BookMarked className="mt-0.5 size-3.5 shrink-0" /><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap leading-relaxed">{memorySummary.summary || '剧情较短时会保留最近对话；接近上下文上限后，系统会自动整理早期剧情。'}</p>{memoryUpdatedAt(memorySummary.updated_at) && <p className="mt-2 text-[10px] text-accent-foreground/75">摘要更新于 {memoryUpdatedAt(memorySummary.updated_at)}</p>}</div></div></div>
            <div className="mt-4 flex items-center justify-between gap-3 px-1"><SectionTitle icon={NotebookPen}>剧情日志</SectionTitle><Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setLogEditorOpen((open) => !open)} aria-expanded={logEditorOpen} disabled={!canAddLog}><Plus data-icon="inline-start" />添加日志</Button></div>
            {logEditorOpen && <div className="mt-3 flex flex-col gap-2"><Textarea aria-label="日志内容" value={logDraft} onChange={(event) => setLogDraft(event.target.value)} rows={3} maxLength={500} placeholder="记录当前线索、决定或待办…" className="min-h-20 rounded-xl text-sm" disabled={logSaving || !canAddLog} /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => { setLogDraft(''); setLogEditorOpen(false) }} disabled={logSaving}>取消</Button><Button type="button" size="sm" className="rounded-full" onClick={() => void saveLog()} disabled={logSaving || !canAddLog || !logDraft.trim()}>{logSaving ? '正在保存…' : '保存日志'}</Button></div></div>}
            {logs.length ? <ul className="mt-3 flex max-h-52 flex-col gap-2 overflow-y-auto px-1 soft-scroll">{logs.map((log, index) => <li key={`${logMessage(log)}-${index}`} className="flex gap-2 text-sm text-muted-foreground"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/50" /><span className="leading-relaxed">{logMessage(log)}</span></li>)}</ul> : <p className="mt-3 px-1 text-sm text-muted-foreground">还没有剧情日志。</p>}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  )
}

function EntitySelector({ entry, selected, secondary = false, onSelect }: { entry: StatusEntry; selected: boolean; secondary?: boolean; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={cn('flex w-full flex-col items-center gap-1 rounded-xl px-0.5 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground', secondary && !selected && 'opacity-70')}>
    <EntityAvatar entry={entry} size="sm" className={cn('size-9 transition-shadow', selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background')} />
    <span className="line-clamp-2 w-full text-[10px] leading-3">{entry.name}</span>
  </button>
}

function SelectedEntryDetail({ entry }: { entry: StatusEntry }) {
  const flags = flagLabels(entry.flags)
  const relations = relationRows(entry)
  const isPlayer = entry.kind === 'player'

  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 items-start gap-3">
      <EntityAvatar entry={entry} size="lg" className="size-14" />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-base font-semibold text-foreground">{entry.name}</h2><Badge variant="secondary" className="rounded-full text-[10px]">{isPlayer ? '玩家' : '角色'}</Badge></div>
        <p className="mt-1 text-xs text-muted-foreground">{isPlayer ? '玩家基础属性' : '实时角色状态'}</p>
        {flags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{flags.map((flag, index) => <Badge key={`${flag}-${index}`} variant="outline" className="max-w-full rounded-full text-[10px]"><span className="truncate">{flag}</span></Badge>)}</div>}
      </div>
    </div>

    {!isPlayer && relations.length > 0 && <dl className="grid gap-2 border-y border-border/60 py-2 text-xs">{relations.map(([name, value]) => <div key={name} className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-x-3"><dt className="break-words text-muted-foreground">{name}</dt><dd className="min-w-0 break-words text-left font-medium leading-5 text-foreground">{displayValue(value)}</dd></div>)}</dl>}

    <div className="flex flex-col gap-3">
      <SectionTitle icon={isPlayer ? UserRound : Sparkles}>{isPlayer ? '基础属性' : '实时属性'}</SectionTitle>
      <AttributeList attributes={entry.attributes} emptyText={isPlayer ? '这个作品还没有设置玩家属性。' : '这个角色还没有可展示的属性。'} />
    </div>
  </div>
}

function EntityAvatar({ entry, size = 'default', className }: { entry: StatusEntry; size?: 'default' | 'sm' | 'lg'; className?: string }) {
  const avatarUrl = entry.kind === 'player' ? entry.avatar_url : entry.card?.avatar_url
  return <Avatar size={size} className={className}>{avatarUrl && <AvatarImage src={avatarUrl} alt={entry.avatar_alt || `${entry.name} 头像`} />}<AvatarFallback>{entry.kind === 'player' ? <UserRound className="size-4" aria-hidden /> : entry.name.slice(0, 1)}</AvatarFallback></Avatar>
}

function AttributeList({ attributes, emptyText }: { attributes: Record<string, unknown>; emptyText: string }) {
  const rows = Object.entries(attributes)
  const progressRows = rows.filter(([, value]) => progressValue(value) !== null)
  const detailRows = rows.filter(([, value]) => progressValue(value) === null)

  if (!rows.length) return <p className="px-1 text-sm text-muted-foreground">{emptyText}</p>

  return <div className="flex flex-col gap-4 px-1">
    {progressRows.map(([name, value]) => {
      const percent = progressValue(value)
      return <div key={name} className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium text-foreground">{name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{displayValue(value)}</span></div>{percent !== null && <Progress value={percent} className="h-1.5" aria-label={`${name} ${percent} / 100`} />}</div>
    })}
    {detailRows.length > 0 && <dl className="grid gap-1 border-t border-border/60 pt-3 text-sm">{detailRows.map(([name, value]) => <div key={name} className="flex min-w-0 items-center justify-between gap-3 py-1"><dt className="shrink-0 text-muted-foreground">{name}</dt><dd className="min-w-0 truncate text-right font-medium text-foreground" title={displayValue(value)}>{displayValue(value)}</dd></div>)}</dl>}
  </div>
}
