'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  BookOpen,
  Database,
  Download,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Search,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { api, type AdminResource, type AdminResourceKind, type AdminResourceListItem } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const kindLabels: Record<AdminResourceKind, string> = {
  card: '角色卡',
  worldbook: '世界书',
  worldbook_entry: '世界书条目',
  work: '作品',
  conversation: '会话',
  message: '消息',
  snapshot: '存档',
  state: '实时状态',
}

const kindIcons: Record<AdminResourceKind, typeof BookOpen> = {
  card: UsersRound,
  worldbook: BookOpen,
  worldbook_entry: BookOpen,
  work: FileText,
  conversation: MessageSquareText,
  message: MessageSquareText,
  snapshot: FileText,
  state: Activity,
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function fieldValue(value: unknown, json = false) {
  if (!json) return textValue(value)
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function resourceTitle(item: AdminResourceListItem | AdminResource) {
  const extended = item as Record<string, unknown>
  return textValue(item.label) || textValue(extended.name) || textValue(extended.title) || `资源 #${item.id}`
}

function resourceDescription(item: AdminResourceListItem | AdminResource) {
  return textValue(item.preview) || textValue(item.description) || '没有描述'
}

type EditFieldConfig = {
  primary: string
  primaryLabel: string
  secondary: string
  secondaryLabel: string
  primaryJson?: boolean
  primaryNumber?: boolean
  secondaryJson?: boolean
}

function editFields(kind: AdminResourceKind): EditFieldConfig {
  if (kind === 'card') return { primary: 'name', primaryLabel: '角色名', secondary: 'persona', secondaryLabel: '人设' }
  if (kind === 'worldbook') return { primary: 'title', primaryLabel: '标题', secondary: 'description', secondaryLabel: '简介' }
  if (kind === 'worldbook_entry') return { primary: 'title', primaryLabel: '条目名', secondary: 'content', secondaryLabel: '内容' }
  if (kind === 'work') return { primary: 'title', primaryLabel: '作品名', secondary: 'description', secondaryLabel: '简介' }
  if (kind === 'conversation') return { primary: 'title', primaryLabel: '会话名', secondary: 'status', secondaryLabel: '状态' }
  if (kind === 'message') return { primary: 'content', primaryLabel: '消息内容', secondary: '', secondaryLabel: '' }
  if (kind === 'state') return { primary: 'money', primaryLabel: '金钱', secondary: 'attributes', secondaryLabel: '属性 JSON', secondaryJson: true, primaryNumber: true }
  return { primary: 'name', primaryLabel: '存档名', secondary: 'note', secondaryLabel: '备注' }
}

export function AdminDataPanel() {
  const [kind, setKind] = useState<AdminResourceKind>('card')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<AdminResourceListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AdminResource | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.listAdminResources({ kind, q: query, page_size: 50 })
      setItems(result.items || [])
      setTotal(result.total)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取跨账号数据')
    } finally {
      setLoading(false)
    }
  }, [kind, query])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (item: AdminResourceListItem) => {
    setLoadingDetail(true)
    try {
      const result = await api.getAdminResource(kind, item.id)
      setSelected(result.resource)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取数据详情')
    } finally {
      setLoadingDetail(false)
    }
  }

  const remove = async () => {
    if (!selected || !window.confirm(`永久删除“${resourceTitle(selected)}”？这个动作不能自动恢复。`)) return
    try {
      await api.deleteAdminResource(kind, selected.id)
      setSelected(null)
      await load()
      toast.success('数据已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除数据失败')
    }
  }

  const download = async () => {
    if (!selected) return
    try {
      const blob = await api.exportAdminResource(kind, selected.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `admin-${kind}-${selected.id}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出数据失败')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-primary uppercase">Data desk</p>
          <h2 className="mt-1 font-serif text-2xl font-bold">跨账号数据</h2>
          <p className="mt-1 text-sm text-muted-foreground">查看、修订、导出或删除业务数据；所有变更都会写入审计日志。</p>
        </div>
        <Badge variant="outline" className="w-fit rounded-full px-3 py-1">共 {total} 条</Badge>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(Object.keys(kindLabels) as AdminResourceKind[]).map((value) => {
              const Icon = kindIcons[value]
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors',
                    kind === value ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {kindLabels[value]}
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void load() }}
                placeholder="按名称或内容搜索"
                className="h-9 rounded-xl pl-9"
              />
            </div>
            <Button variant="outline" className="h-9 rounded-xl" onClick={() => void load()}><Search />搜索</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-border/60"><CardTitle>{kindLabels[kind]}清单</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取…</div>
          ) : items.length ? (
            <div className="divide-y divide-border/60">
              {items.map((item) => {
                const Icon = kindIcons[item.kind]
                return (
                  <button key={`${item.kind}-${item.id}`} type="button" className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/35" onClick={() => void open(item)}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="truncate font-medium">{resourceTitle(item)}</span><Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">{item.owner_username || '无主数据'}</Badge></span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{resourceDescription(item)}</span>
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:block">#{item.id}</span>
                    <Pencil className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )
              })}
            </div>
          ) : (
            <Empty className="border-0 py-16"><EmptyHeader><EmptyMedia variant="icon"><Database className="size-4" /></EmptyMedia><EmptyTitle>没有找到数据</EmptyTitle><EmptyDescription>换一种资源类型或搜索词试试。</EmptyDescription></EmptyHeader></Empty>
          )}
        </CardContent>
      </Card>

      <ResourceSheet
        resource={selected}
        kind={kind}
        loading={loadingDetail}
        onOpenChange={(openState) => { if (!openState) setSelected(null) }}
        onSave={async (payload) => {
          if (!selected) return
          const result = await api.updateAdminResource(kind, selected.id, payload)
          setSelected(result.resource)
          await load()
          toast.success('数据已保存')
        }}
        onDelete={() => void remove()}
        onExport={() => void download()}
      />
    </div>
  )
}

function ResourceSheet({
  resource,
  kind,
  loading,
  onOpenChange,
  onSave,
  onDelete,
  onExport,
}: {
  resource: AdminResource | null
  kind: AdminResourceKind
  loading: boolean
  onOpenChange: (open: boolean) => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
  onDelete: () => void
  onExport: () => void
}) {
  const fields = useMemo(() => editFields(kind), [kind])
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPrimary(resource ? fieldValue(resource[fields.primary], fields.primaryJson) : '')
    setSecondary(resource && fields.secondary ? fieldValue(resource[fields.secondary], fields.secondaryJson) : '')
  }, [resource, fields])

  const entries: Array<Record<string, unknown>> = resource && Array.isArray(resource.entries)
    ? (resource.entries as Array<Record<string, unknown>>)
    : []
  const messages = resource && Array.isArray(resource.messages) ? resource.messages : []

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { [fields.primary]: fields.primaryNumber ? Number(primary) : primary }
      if (fields.secondary) {
        if (fields.secondaryJson) {
          try {
            payload[fields.secondary] = JSON.parse(secondary)
          } catch {
            throw new Error('属性 JSON 格式无效')
          }
        } else {
          payload[fields.secondary] = secondary
        }
      }
      await onSave(payload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存数据失败')
    } finally {
      setSaving(false)
    }
  }

  const textareaField = ['description', 'persona', 'content', 'note'].includes(fields.secondary)

  return (
    <Sheet open={Boolean(resource) || loading} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 px-5 py-6 pr-14 sm:px-7">
          <SheetDescription className="text-xs tracking-[0.12em] uppercase">{kindLabels[kind]} · {resource ? `#${resource.id}` : '读取中'}</SheetDescription>
          <SheetTitle className="mt-1 truncate font-serif text-2xl">{resource ? resourceTitle(resource) : '数据详情'}</SheetTitle>
          {resource && <div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline" className="rounded-full">创建者：{resource.owner_username || '无主数据'}</Badge><Badge variant="secondary" className="rounded-full">站长可见</Badge></div>}
        </SheetHeader>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取详情…</div>
        ) : resource ? (
          <div className="space-y-5 px-5 py-6 sm:px-7">
            <div className="space-y-4 rounded-2xl border border-border/70 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="admin-resource-primary">{fields.primaryLabel}</label>
                <Input id="admin-resource-primary" value={primary} onChange={(event) => setPrimary(event.target.value)} className="h-10 rounded-xl" />
              </div>
              {fields.secondary && <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="admin-resource-secondary">{fields.secondaryLabel}</label>
                {textareaField ? (
                  <textarea id="admin-resource-secondary" value={secondary} onChange={(event) => setSecondary(event.target.value)} rows={6} className="w-full resize-y rounded-xl border border-input bg-transparent px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
                ) : (
                  <select id="admin-resource-secondary" value={secondary} onChange={(event) => setSecondary(event.target.value)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><option value="active">活跃</option><option value="archived">已归档</option></select>
                )}
              </div>}
              <Button className="w-full rounded-xl" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Pencil />}保存修改</Button>
            </div>

            {entries.length > 0 && <section><p className="mb-2 text-sm font-semibold">世界书条目</p><div className="space-y-2">{entries.map((entry) => <div key={String(entry.id)} className="rounded-xl bg-muted/55 p-3"><p className="font-medium">{textValue(entry.title) || '未命名条目'}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{textValue(entry.content)}</p></div>)}</div></section>}
            {messages.length > 0 && <section><p className="mb-2 text-sm font-semibold">消息快照</p><p className="rounded-xl bg-muted/55 p-3 text-xs leading-5 text-muted-foreground">此会话包含 {messages.length} 条消息；可以切换到“消息”分类逐条修订。</p></section>}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-5 sm:flex-row"><Button variant="outline" className="flex-1 rounded-xl" onClick={onExport}><Download />导出 JSON</Button><Button variant="destructive" className="flex-1 rounded-xl" onClick={onDelete}><Trash2 />永久删除</Button></div>
            <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><X className="mt-0.5 size-3.5 shrink-0" />删除会记录审计；有引用关系的角色卡和世界书需要先处理引用。</div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
