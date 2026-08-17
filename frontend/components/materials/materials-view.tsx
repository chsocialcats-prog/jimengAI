'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Plus,
  Upload,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  Users,
  BookMarked,
  Sparkles,
  ImagePlus,
  LoaderCircle,
  Save,
  X,
  ExternalLink,
  Check,
  Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { InputGroup, InputGroupInput, InputGroupAddon } from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { ApiError, api, type OnlineImageCandidate, type RoleCard, type Worldbook, type WorldbookEntry } from '@/lib/api'
import { useSession } from '@/components/session-provider'

type MaterialType = 'character' | 'worldbook'
type AnyMaterial = (RoleCard & { kind: 'character' }) | (Worldbook & { kind: 'worldbook' })
type WorkReference = { id: number; title: string }
type AttributeRow = { key: string; value: string }
type RelationshipRow = { target: string; description: string }

const tabs = [
  { key: 'character' as const, label: '角色卡', icon: Users },
  { key: 'worldbook' as const, label: '世界书', icon: BookMarked },
]

const blankCard = { name: '', avatarUrl: '', persona: '', personality: '', speaking_style: '', relationships: [] as RelationshipRow[], directives: '', characterAttributes: [] as AttributeRow[] }
const blankWorldbook = { title: '', description: '' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function referencedWorksFromError(error: unknown): WorkReference[] {
  if (!(error instanceof ApiError) || error.code !== 'resource_in_use' || !isPlainObject(error.details)) return []
  const works = error.details.works
  if (!Array.isArray(works)) return []
  return works.filter((work): work is WorkReference => isPlainObject(work) && typeof work.id === 'number' && typeof work.title === 'string')
}

export function MaterialsView() {
  const { session } = useSession()
  const [tab, setTab] = useState<MaterialType>('character')
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<RoleCard[]>([])
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([])
  const [detail, setDetail] = useState<AnyMaterial | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnyMaterial | null>(null)
  const [deleteBlock, setDeleteBlock] = useState<{ material: AnyMaterial; works: WorkReference[] } | null>(null)
  const [editor, setEditor] = useState<AnyMaterial | { kind: MaterialType } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fillMissingImagesOpen, setFillMissingImagesOpen] = useState(false)
  const [fillingMissingImages, setFillingMissingImages] = useState(false)
  const importFileRef = useRef<HTMLInputElement>(null)
  const sillyTavernImportFileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [nextCards, nextWorldbooks] = await Promise.all([api.listCards(), api.listWorldbooks()])
      setCards(nextCards)
      setWorldbooks(nextWorldbooks)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加载素材库')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [session.authenticated])

  const list = useMemo<AnyMaterial[]>(() => {
    const source: AnyMaterial[] = tab === 'character'
      ? cards.map((item) => ({ ...item, kind: 'character' as const }))
      : worldbooks.map((item) => ({ ...item, kind: 'worldbook' as const }))
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return source
    return source.filter((item) => `${item.kind === 'character' ? item.name : item.title} ${item.kind === 'character' ? `${item.persona} ${item.personality}` : item.description}`.toLocaleLowerCase().includes(needle))
  }, [cards, worldbooks, tab, query])

  const activeTab = tabs.find((item) => item.key === tab)!
  const canWrite = session.authenticated
  const missingAvatarCount = cards.filter((card) => card.can_edit && !card.avatar_url.trim()).length

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.kind === 'character') await api.deleteCard(deleteTarget.id)
      else await api.deleteWorldbook(deleteTarget.id)
      toast.success(`已删除「${deleteTarget.kind === 'character' ? deleteTarget.name : deleteTarget.title}」`)
      setDeleteTarget(null)
      setDetail(null)
      await load()
    } catch (error) {
      const works = referencedWorksFromError(error)
      if (works.length) {
        setDeleteBlock({ material: deleteTarget, works })
        setDeleteTarget(null)
        return
      }
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const fillMissingImages = async () => {
    setFillingMissingImages(true)
    try {
      const result = await api.fillMissingCardImages()
      await load()
      setFillMissingImagesOpen(false)
      if (result.updated.length) toast.success(`已为 ${result.updated.length} 个角色补全配图`)
      if (result.failed.length) toast.error(`${result.failed.length} 个角色未能配图：${result.failed[0].error}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '在线配图失败')
    } finally {
      setFillingMissingImages(false)
    }
  }

  const exportItems = () => {
    const payload = tab === 'character' ? cards : worldbooks
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${tab === 'character' ? '角色卡' : '世界书'}-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importCard = async () => {
    if (!importText.trim()) return
    setSaving(true)
    try {
      const bundle = await api.importCardText(importText)
      toast.success(`已导入「${bundle.card.name}」及配套作品`)
      setImportOpen(false)
      setImportText('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setSaving(false)
    }
  }

  const importCardJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const rawCards = Array.isArray(parsed) ? parsed : [(parsed && typeof parsed === 'object' && 'card' in parsed) ? (parsed as { card: unknown }).card : parsed]
      const payloads = rawCards.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object' && typeof candidate.name === 'string' && Boolean(candidate.name.trim())).map((candidate) => ({
        name: String(candidate.name).trim(),
        avatar_url: typeof candidate.avatar_url === 'string' ? candidate.avatar_url : '',
        persona: typeof candidate.persona === 'string' ? candidate.persona : '',
        personality: typeof candidate.personality === 'string' ? candidate.personality : '',
        speaking_style: typeof candidate.speaking_style === 'string' ? candidate.speaking_style : '',
        relationships: isPlainObject(candidate.relationships) ? candidate.relationships : {},
        directives: Array.isArray(candidate.directives) ? candidate.directives.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [],
        initial_state: isPlainObject(candidate.initial_state) ? candidate.initial_state : {},
        character_attributes: isPlainObject(candidate.character_attributes) ? candidate.character_attributes : {},
        source: typeof candidate.source === 'string' ? candidate.source : 'import',
      }))
      if (!payloads.length) throw new Error('文件中没有可导入的角色卡；每张角色卡都需要 name 字段。')
      await Promise.all(payloads.map((payload) => api.createCard(payload)))
      toast.success(`已导入 ${payloads.length} 张角色卡`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法解析角色卡 JSON 文件')
    } finally {
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  const importSillyTavern = async (file: File) => {
    try {
      if (tab === 'character') {
        const result = await api.importSillyTavernCard(file)
        toast.success(`已导入「${result.card.name}」及配套作品`)
        if (result.warnings.length) toast.warning(`已保留但当前不执行：${result.warnings.join('、')}`)
      } else {
        const result = await api.importSillyTavernWorldbook(file)
        toast.success(`已导入世界书「${result.worldbook.title}」`)
        if (result.warnings.length) toast.warning(`已保留但当前不执行：${result.warnings.join('、')}`)
      }
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法导入 SillyTavern 文件')
    } finally {
      if (sillyTavernImportFileRef.current) sillyTavernImportFileRef.current.value = ''
    }
  }

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportSillyTavern = async (material: AnyMaterial, format: 'json' | 'png') => {
    try {
      if (material.kind === 'character') {
        download(await api.exportSillyTavernCard(material.id, format), `${material.name}.${format}`)
      } else {
        download(await api.exportSillyTavernWorldbook(material.id), `${material.title}.json`)
      }
      toast.success('已导出 SillyTavern 文件')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <header className="flex flex-col gap-2"><h1 className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">创作素材库</h1><p className="text-pretty text-sm text-muted-foreground md:text-base">管理角色卡与世界书，可在作品编辑器中关联复用。</p></header>

      <div className="mt-6 overflow-x-auto pb-1"><ToggleGroup value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as MaterialType)} className="w-max rounded-full bg-muted/60 p-1">{tabs.map((item) => <ToggleGroupItem key={item.key} value={item.key} className="gap-2 rounded-full px-4 data-[pressed]:bg-card data-[pressed]:shadow-sm"><item.icon className="size-4" />{item.label}<span className="text-xs text-muted-foreground">{item.key === 'character' ? cards.length : worldbooks.length}</span></ToggleGroupItem>)}</ToggleGroup></div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <InputGroup className="rounded-full bg-card sm:max-w-xs"><InputGroupAddon><Search className="size-4 text-muted-foreground" /></InputGroupAddon><InputGroupInput placeholder={`搜索${activeTab.label}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></InputGroup>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <input ref={sillyTavernImportFileRef} type="file" accept="application/json,.json,image/png,.png" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importSillyTavern(file) }} />
          {tab === 'character' && <><input ref={importFileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCardJson(file) }} /><Button variant="outline" className="rounded-full" disabled={!canWrite || missingAvatarCount === 0} onClick={() => setFillMissingImagesOpen(true)}><ImagePlus data-icon="inline-start" />补全配图 {missingAvatarCount > 0 ? `(${missingAvatarCount})` : ''}</Button><Button variant="outline" className="rounded-full" disabled={!canWrite} onClick={() => setImportOpen(true)}><Upload data-icon="inline-start" />导入文本</Button><Button variant="outline" className="rounded-full" disabled={!canWrite} onClick={() => importFileRef.current?.click()}><Upload data-icon="inline-start" />导入 JSON</Button></>}
          <Button variant="outline" className="rounded-full" disabled={!canWrite} onClick={() => sillyTavernImportFileRef.current?.click()}><Upload data-icon="inline-start" />导入酒馆{tab === 'character' ? '卡' : '书'}</Button>
          <Button variant="outline" className="rounded-full" onClick={exportItems} disabled={list.length === 0}><Download data-icon="inline-start" />导出</Button>
          <Button className="rounded-full" disabled={!canWrite} onClick={() => setEditor({ kind: tab })}><Plus data-icon="inline-start" />新建</Button>
        </div>
      </div>

      {loading ? <div className="mt-16 flex justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取素材…</div> : list.length === 0 ? <Empty className="mt-16"><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>没有找到{activeTab.label}</EmptyTitle><EmptyDescription>{canWrite ? '换个关键词，或新建一个吧。' : '登录后可以创建和管理自己的素材。'}</EmptyDescription></EmptyHeader><EmptyContent>{canWrite && <Button className="rounded-full" onClick={() => setEditor({ kind: tab })}><Plus data-icon="inline-start" />新建{activeTab.label}</Button>}</EmptyContent></Empty> : <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((material) => <MaterialCard key={`${material.kind}-${material.id}`} material={material} onOpen={() => setDetail(material)} onEdit={() => setEditor(material)} onDelete={() => setDeleteTarget(material)} onExport={(format) => void exportSillyTavern(material, format)} />)}</div>}

      <MaterialDetailSheet material={detail} onOpenChange={(open) => !open && setDetail(null)} />
      <MaterialEditor editor={editor} onOpenChange={(open) => !open && setEditor(null)} onSaved={async () => { setEditor(null); await load() }} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent><DialogHeader><DialogTitle>导入文本角色卡</DialogTitle><DialogDescription>粘贴角色卡原文。系统会解析并创建角色卡、配套世界书和一部作品。</DialogDescription></DialogHeader><Textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={10} placeholder="粘贴角色卡文本…" /><DialogFooter><Button variant="ghost" onClick={() => setImportOpen(false)}>取消</Button><Button onClick={() => void importCard()} disabled={saving || !importText.trim()}>{saving ? '正在导入…' : '导入并创建作品'}</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除「{deleteTarget?.kind === 'character' ? deleteTarget.name : deleteTarget?.title}」？</AlertDialogTitle><AlertDialogDescription>若有剧本正在关联此素材，系统会阻止删除并列出具体剧本。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleDelete()}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={fillMissingImagesOpen} onOpenChange={setFillMissingImagesOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>为 {missingAvatarCount} 个角色补全配图？</AlertDialogTitle><AlertDialogDescription>系统会通过百炼文搜图为当前账户未配图的角色选择首个 HTTPS 搜索结果，并写入角色卡头像。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={fillingMissingImages}>取消</AlertDialogCancel><AlertDialogAction disabled={fillingMissingImages} onClick={() => void fillMissingImages()}>{fillingMissingImages ? '正在搜索图片…' : '开始补全'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={!!deleteBlock} onOpenChange={(open) => !open && setDeleteBlock(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>无法删除「{deleteBlock?.material.kind === 'character' ? deleteBlock.material.name : deleteBlock?.material.title}」</AlertDialogTitle><AlertDialogDescription>请先在以下剧本中移除该{deleteBlock?.material.kind === 'character' ? '角色卡' : '世界书'}引用，再删除素材。</AlertDialogDescription></AlertDialogHeader><div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2" role="list">{deleteBlock?.works.map((work) => <div key={work.id} className="flex items-center gap-2 px-2 py-1.5 text-sm" role="listitem"><Link2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{work.title}</span></div>)}</div><AlertDialogFooter><AlertDialogCancel>知道了</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}

function MaterialCard({ material, onOpen, onEdit, onDelete, onExport }: { material: AnyMaterial; onOpen: () => void; onEdit: () => void; onDelete: () => void; onExport: (format: 'json' | 'png') => void }) {
  const title = material.kind === 'character' ? material.name : material.title
  const description = material.kind === 'character' ? material.persona || material.personality || '尚未填写角色设定。' : material.description || '尚未填写世界书简介。'
  const Icon = material.kind === 'character' ? Users : BookMarked
  const referenceCount = material.referencing_works?.length || 0
  return <Card className="group cursor-pointer gap-0 overflow-hidden p-4 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30" onClick={onOpen}><div className="flex items-start gap-3"><Avatar className="size-12">{material.kind === 'character' && material.avatar_url && <AvatarImage src={material.avatar_url} alt={`${material.name} 头像`} />}<AvatarFallback><Icon className="size-5" /></AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="truncate font-medium text-foreground">{title}</h2><p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{description}</p></div>{material.can_edit && <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 rounded-full" aria-label="素材操作" onClick={(event) => event.stopPropagation()}><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={(event) => { event.stopPropagation(); onEdit() }}><Pencil className="size-4" />编辑</DropdownMenuItem>{material.kind === 'character' ? <><DropdownMenuItem onClick={(event) => { event.stopPropagation(); onExport('json') }}><Download className="size-4" />导出酒馆 JSON</DropdownMenuItem><DropdownMenuItem onClick={(event) => { event.stopPropagation(); onExport('png') }}><Download className="size-4" />导出酒馆 PNG</DropdownMenuItem></> : <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onExport('json') }}><Download className="size-4" />导出酒馆世界书</DropdownMenuItem>}<DropdownMenuItem variant="destructive" onClick={(event) => { event.stopPropagation(); onDelete() }}><Trash2 className="size-4" />删除</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}</div><div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="secondary" className="rounded-full text-[11px]">{material.kind === 'character' ? '角色卡' : `${material.entries?.length || 0} 条世界书条目`}</Badge>{referenceCount > 0 && <Badge variant="outline" className="gap-1 rounded-full text-[11px]"><Link2 className="size-3" />被 {referenceCount} 个剧本引用</Badge>}{material.owner_username && <Badge variant="outline" className="rounded-full text-[11px]">{material.owner_username}</Badge>}</div></div></div></Card>
}

function materialValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(materialValue).filter(Boolean).join('、')
  if (isPlainObject(value)) return Object.entries(value).map(([key, item]) => `${key}：${materialValue(item)}`).filter(Boolean).join('；')
  return String(value ?? '').trim()
}

function DetailSection({ eyebrow, title, count, children }: { eyebrow: string; title: string; count?: React.ReactNode; children: React.ReactNode }) {
  return <section className="border-t border-border pt-6"><div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p><h3 className="mt-1 font-serif text-xl font-semibold tracking-tight text-foreground">{title}</h3></div>{count && <span className="shrink-0 font-mono text-xs text-muted-foreground">{count}</span>}</div><div className="mt-4">{children}</div></section>
}

function DetailFacts({ facts }: { facts: Array<[string, unknown]> }) {
  const filledFacts = facts.map(([label, value]) => [label, materialValue(value)] as const).filter(([, value]) => Boolean(value))
  if (!filledFacts.length) return <p className="text-sm leading-6 text-muted-foreground">尚未补充这部分设定。</p>
  return <dl className="grid gap-x-6 md:grid-cols-2">{filledFacts.map(([label, value]) => <div key={label} className="border-t border-border py-3 first:border-t-0 md:[&:nth-child(2)]:border-t-0"><dt className="font-mono text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{value}</dd></div>)}</dl>
}

function DetailIntro({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="border-l-2 border-primary/70 py-1 pl-4"><p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{label}</p><p className="mt-2 whitespace-pre-wrap font-serif text-lg leading-8 text-foreground">{children}</p></section>
}

function MaterialDetailSheet({ material, onOpenChange }: { material: AnyMaterial | null; onOpenChange: (open: boolean) => void }) {
  const [full, setFull] = useState<Worldbook | null>(null)
  const [loadingWorldbook, setLoadingWorldbook] = useState(false)

  useEffect(() => {
    if (material?.kind !== 'worldbook') {
      setFull(null)
      setLoadingWorldbook(false)
      return
    }
    let active = true
    setFull(null)
    setLoadingWorldbook(true)
    void api.getWorldbook(material.id).then((result) => { if (active) setFull(result) }).catch(() => { if (active) setFull(null) }).finally(() => { if (active) setLoadingWorldbook(false) })
    return () => { active = false }
  }, [material])

  const title = material?.kind === 'character' ? material.name : material?.title
  const Icon = material?.kind === 'character' ? Users : BookMarked
  const detailType = material?.kind === 'character' ? 'CHARACTER CARD' : 'WORLD BOOK'
  const entries = full?.entries || []

  return <Sheet open={!!material} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"><SheetHeader className="border-b border-border px-5 py-6 pr-14 sm:px-8"><div className="flex min-w-0 items-center gap-3"><Avatar className="size-11 border border-border"><AvatarImage src={material?.kind === 'character' ? material.avatar_url : undefined} alt={material?.kind === 'character' ? `${material.name} 头像` : ''} /><AvatarFallback><Icon className="size-5" /></AvatarFallback></Avatar><div className="min-w-0"><SheetDescription className="font-mono text-[11px] tracking-[0.12em]">{detailType}</SheetDescription><SheetTitle className="mt-1 truncate font-serif text-2xl font-semibold tracking-tight">{title || '素材详情'}</SheetTitle></div></div><div className="mt-4 flex flex-wrap gap-1.5"><Badge variant="secondary" className="rounded-full text-[11px]">{material?.kind === 'character' ? '角色卡' : `${entries.length || material?.entries?.length || 0} 条世界书条目`}</Badge>{material?.owner_username && <Badge variant="outline" className="rounded-full text-[11px]">创建者：{material.owner_username}</Badge>}{material?.can_edit && <Badge variant="outline" className="rounded-full text-[11px]">可编辑</Badge>}</div></SheetHeader><div className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">{material?.kind === 'character' ? <CharacterDetail material={material} /> : material?.kind === 'worldbook' ? <WorldbookDetail material={material} entries={entries} loading={loadingWorldbook} /> : null}</div></SheetContent></Sheet>
}

function CharacterDetail({ material }: { material: RoleCard }) {
  const directives = material.directives.map(materialValue).filter(Boolean)
  const attributes = Object.entries(material.character_attributes || {})
  const relationships = Object.entries(material.relationships || {})
  return <><DetailIntro label="角色设定">{material.persona || '尚未填写人设简介。'}</DetailIntro><DetailSection eyebrow="人物侧写" title="角色特征"><DetailFacts facts={[["性格", material.personality], ["说话风格", material.speaking_style], ["来源", material.source]]} /></DetailSection>{directives.length > 0 && <DetailSection eyebrow="行为边界" title="固定指令"><ol className="list-decimal space-y-2 pl-5 marker:font-mono marker:text-xs marker:text-muted-foreground">{directives.map((item, index) => <li key={`${item}-${index}`} className="border-t border-border py-2 pl-1 leading-6 text-foreground first:border-t-0">{item}</li>)}</ol></DetailSection>}{attributes.length > 0 && <DetailSection eyebrow="剧情数据" title="角色属性"><DetailFacts facts={attributes} /></DetailSection>}{relationships.length > 0 && <DetailSection eyebrow="人物网络" title="文字关系"><DetailFacts facts={relationships} /></DetailSection>}</>
}

function WorldbookDetail({ material, entries, loading }: { material: Worldbook; entries: WorldbookEntry[]; loading: boolean }) {
  return <><DetailIntro label="世界观概览">{material.description || '尚未填写世界书简介。'}</DetailIntro><DetailSection eyebrow="设定索引" title="世界书条目" count={loading ? '正在读取…' : `${entries.length} 条`}>{loading ? <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取条目…</div> : entries.length ? <div className="space-y-3">{entries.map((entry) => <article key={entry.id} className="border-l-2 border-primary/50 bg-muted/30 px-4 py-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><h4 className="font-serif text-base font-semibold leading-6 text-foreground">{entry.title || '未命名条目'}</h4>{entry.keywords.length > 0 && <div className="flex flex-wrap gap-1.5 sm:justify-end">{entry.keywords.map((keyword) => <Badge key={keyword} variant="outline" className="rounded-full text-[11px]">{keyword}</Badge>)}</div>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{entry.content || '尚未填写正文。'}</p>{entry.priority !== 0 && <p className="mt-3 font-mono text-[11px] text-muted-foreground">优先级 {entry.priority}</p>}</article>)}</div> : <p className="py-5 text-sm leading-6 text-muted-foreground">尚未添加世界书条目。</p>}</DetailSection></>
}

function editorValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return materialValue(value) }
}

function recordRows(record: Record<string, unknown>): AttributeRow[] {
  return Object.entries(record || {}).map(([key, value]) => ({ key, value: editorValue(value) }))
}

function relationshipRows(record: Record<string, unknown>): RelationshipRow[] {
  return Object.entries(record || {}).map(([target, description]) => ({ target, description: editorValue(description) }))
}

function parseEditorValue(value: string): unknown {
  const trimmed = value.trim()
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^[{[]/.test(trimmed)) {
    try { return JSON.parse(trimmed) } catch { return trimmed }
  }
  return trimmed
}

function recordFromRows(rows: AttributeRow[], label: string): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const row of rows) {
    const key = row.key.trim()
    const value = row.value.trim()
    if (!key && !value) continue
    if (!key) throw new Error(`请填写${label}名称，或删除空行`)
    if (Object.hasOwn(record, key)) throw new Error(`${label}名称不能重复：${key}`)
    record[key] = parseEditorValue(value)
  }
  return record
}

function relationshipRecordFromRows(rows: RelationshipRow[]): Record<string, unknown> {
  return recordFromRows(rows.map((row) => ({ key: row.target, value: row.description })), '关系对象')
}

function MaterialEditor({ editor, onOpenChange, onSaved }: { editor: AnyMaterial | { kind: MaterialType } | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const isCard = editor?.kind === 'character'
  const existingCard = editor && editor.kind === 'character' && 'id' in editor ? editor : null
  const existingWorldbook = editor && editor.kind === 'worldbook' && 'id' in editor ? editor : null
  const [card, setCard] = useState(blankCard)
  const [worldbook, setWorldbook] = useState(blankWorldbook)
  const [entries, setEntries] = useState<WorldbookEntry[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editor) return
    if (existingCard) setCard({ name: existingCard.name, avatarUrl: existingCard.avatar_url || '', persona: existingCard.persona, personality: existingCard.personality, speaking_style: existingCard.speaking_style, relationships: relationshipRows(existingCard.relationships || {}), directives: (existingCard.directives || []).join('\n'), characterAttributes: recordRows(existingCard.character_attributes || {}) })
    else setCard(blankCard)
    if (existingWorldbook) {
      setWorldbook({ title: existingWorldbook.title, description: existingWorldbook.description })
      setLoadingDetail(true)
      void api.getWorldbook(existingWorldbook.id).then((result) => setEntries(result.entries || [])).finally(() => setLoadingDetail(false))
    } else { setWorldbook(blankWorldbook); setEntries([]) }
  }, [editor])

  const save = async () => {
    if (!editor) return
    setSaving(true)
    try {
      if (isCard) {
        const relationships = relationshipRecordFromRows(card.relationships)
        const characterAttributes = recordFromRows(card.characterAttributes, '角色属性')
        const payload = { name: card.name.trim(), avatar_url: card.avatarUrl, persona: card.persona, personality: card.personality, speaking_style: card.speaking_style, relationships, directives: card.directives.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), character_attributes: characterAttributes }
        if (!payload.name) throw new Error('角色名不能为空')
        if (existingCard) await api.updateCard(existingCard.id, payload)
        else await api.createCard(payload)
      } else {
        const payload = { title: worldbook.title.trim(), description: worldbook.description }
        if (!payload.title) throw new Error('世界书标题不能为空')
        if (existingWorldbook) await api.updateWorldbook(existingWorldbook.id, payload)
        else await api.createWorldbook(payload)
      }
      toast.success('素材已保存')
      await onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally { setSaving(false) }
  }

  const addEntry = async () => {
    if (!existingWorldbook) { toast.info('请先保存世界书，再添加条目。'); return }
    try {
      const entry = await api.createWorldbookEntry(existingWorldbook.id, { title: '新条目', content: '', keywords: [], priority: 0, enabled: true })
      setEntries((previous) => [...previous, entry])
    } catch (error) { toast.error(error instanceof Error ? error.message : '创建条目失败') }
  }
  const updateEntry = async (entry: WorldbookEntry, changes: Partial<WorldbookEntry>) => {
    if (!existingWorldbook) return
    const next = { ...entry, ...changes }
    setEntries((previous) => previous.map((item) => item.id === entry.id ? next : item))
    try { await api.updateWorldbookEntry(existingWorldbook.id, entry.id, changes) } catch (error) { toast.error(error instanceof Error ? error.message : '保存条目失败') }
  }
  const removeEntry = async (entry: WorldbookEntry) => {
    if (!existingWorldbook) return
    try { await api.deleteWorldbookEntry(existingWorldbook.id, entry.id); setEntries((previous) => previous.filter((item) => item.id !== entry.id)) } catch (error) { toast.error(error instanceof Error ? error.message : '删除条目失败') }
  }
  const addCharacterAttribute = () => setCard((previous) => ({ ...previous, characterAttributes: [...previous.characterAttributes, { key: '', value: '' }] }))
  const updateCharacterAttribute = (index: number, changes: Partial<AttributeRow>) => setCard((previous) => ({ ...previous, characterAttributes: previous.characterAttributes.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row) }))
  const removeCharacterAttribute = (index: number) => setCard((previous) => ({ ...previous, characterAttributes: previous.characterAttributes.filter((_, rowIndex) => rowIndex !== index) }))
  const addRelationship = () => setCard((previous) => ({ ...previous, relationships: [...previous.relationships, { target: '', description: '' }] }))
  const updateRelationship = (index: number, changes: Partial<RelationshipRow>) => setCard((previous) => ({ ...previous, relationships: previous.relationships.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row) }))
  const removeRelationship = (index: number) => setCard((previous) => ({ ...previous, relationships: previous.relationships.filter((_, rowIndex) => rowIndex !== index) }))

  return <Dialog open={!!editor} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{isCard ? `${existingCard ? '编辑' : '新建'}角色卡` : `${existingWorldbook ? '编辑' : '新建'}世界书`}</DialogTitle><DialogDescription>{isCard ? '角色卡可以被多个作品复用。' : '世界书条目会按关键词参与故事上下文。'}</DialogDescription></DialogHeader>
      {isCard && <CardAvatarField url={card.avatarUrl} name={card.name} persona={card.persona} personality={card.personality} onChange={(avatarUrl) => setCard({ ...card, avatarUrl })} />}
      {isCard ? <div className="grid gap-4">
        <div><Label htmlFor="material-name">角色名</Label><Input id="material-name" className="mt-2" value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} /></div>
        <div><Label htmlFor="material-persona">人设</Label><Textarea id="material-persona" className="mt-2" rows={4} value={card.persona} onChange={(event) => setCard({ ...card, persona: event.target.value })} /></div>
        <div><Label htmlFor="material-personality">性格</Label><Textarea id="material-personality" className="mt-2" rows={3} value={card.personality} onChange={(event) => setCard({ ...card, personality: event.target.value })} /></div>
        <div><Label htmlFor="material-speaking">说话风格</Label><Input id="material-speaking" className="mt-2" value={card.speaking_style} onChange={(event) => setCard({ ...card, speaking_style: event.target.value })} /></div>
        <div><Label htmlFor="material-directives">固定指令</Label><Textarea id="material-directives" className="mt-2" rows={4} value={card.directives} placeholder="每行一条，例如：始终保持角色人设" onChange={(event) => setCard({ ...card, directives: event.target.value })} /></div>
        <CharacterAttributeEditor rows={card.characterAttributes} onAdd={addCharacterAttribute} onChange={updateCharacterAttribute} onRemove={removeCharacterAttribute} />
        <RelationshipEditor rows={card.relationships} onAdd={addRelationship} onChange={updateRelationship} onRemove={removeRelationship} />
      </div> : <div className="grid gap-4">
        <div><Label htmlFor="worldbook-title">标题</Label><Input id="worldbook-title" className="mt-2" value={worldbook.title} onChange={(event) => setWorldbook({ ...worldbook, title: event.target.value })} /></div>
        <div><Label htmlFor="worldbook-description">简介</Label><Textarea id="worldbook-description" className="mt-2" rows={3} value={worldbook.description} onChange={(event) => setWorldbook({ ...worldbook, description: event.target.value })} /></div>
        {existingWorldbook && <div className="border-t pt-4"><div className="flex items-center justify-between"><Label>世界书条目</Label><Button variant="outline" size="sm" onClick={() => void addEntry()}><Plus />添加条目</Button></div>{loadingDetail ? <p className="mt-3 text-sm text-muted-foreground">正在加载条目…</p> : <div className="mt-3 grid gap-3">{entries.map((entry) => <EntryEditor key={entry.id} entry={entry} onUpdate={updateEntry} onDelete={removeEntry} />)}</div>}</div>}
      </div>}
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => void save()} disabled={saving}><Save data-icon="inline-start" />{saving ? '正在保存…' : '保存'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function CharacterAttributeEditor({ rows, onAdd, onChange, onRemove }: { rows: AttributeRow[]; onAdd: () => void; onChange: (index: number, changes: Partial<AttributeRow>) => void; onRemove: (index: number) => void }) {
  return <section className="border-t border-border pt-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><Label>角色属性</Label><p className="mt-1 text-xs text-muted-foreground">可填写数值或文本，例如心情、好感度、身份状态。</p></div><Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onAdd}><Plus />添加属性</Button></div><div className="mt-3 flex flex-col gap-2">{rows.map((row, index) => <div key={index} className="flex flex-col gap-2 sm:flex-row"><Input value={row.key} onChange={(event) => onChange(index, { key: event.target.value })} placeholder="属性名，如：好感度" /><Input value={row.value} onChange={(event) => onChange(index, { value: event.target.value })} placeholder="值，如：50" inputMode="decimal" /><Button type="button" variant="ghost" size="icon" className="self-end text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto" onClick={() => onRemove(index)} aria-label="移除角色属性"><X /></Button></div>)}{rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">尚未添加角色属性。</p>}</div></section>
}

function RelationshipEditor({ rows, onAdd, onChange, onRemove }: { rows: RelationshipRow[]; onAdd: () => void; onChange: (index: number, changes: Partial<RelationshipRow>) => void; onRemove: (index: number) => void }) {
  return <section className="border-t border-border pt-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><Label>关系</Label><p className="mt-1 text-xs text-muted-foreground">记录角色与玩家或其他人物的关系说明。</p></div><Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onAdd}><Plus />添加关系</Button></div><div className="mt-3 flex flex-col gap-2">{rows.map((row, index) => <div key={index} className="flex flex-col gap-2 sm:flex-row"><Input value={row.target} onChange={(event) => onChange(index, { target: event.target.value })} placeholder="关系对象，如：玩家" /><Input value={row.description} onChange={(event) => onChange(index, { description: event.target.value })} placeholder="关系说明，如：初次见面，保持警惕" /><Button type="button" variant="ghost" size="icon" className="self-end text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto" onClick={() => onRemove(index)} aria-label="移除关系"><X /></Button></div>)}{rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">尚未添加人物关系。</p>}</div></section>
}

function CardAvatarField({ url, name, persona, personality, onChange }: { url: string; name: string; persona: string; personality: string; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<OnlineImageCandidate[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCandidateUrl, setEditingCandidateUrl] = useState('')
  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      onChange((await api.uploadImage(file)).url)
      toast.success('角色头像已上传')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '角色头像上传失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  const searchOnline = async () => {
    if (!name.trim()) {
      toast.error('请先填写角色名，再搜索图片')
      return
    }
    setSearchOpen(true)
    setSearching(true)
    setCandidates([])
    try {
      const result = await api.searchCardImages(name.trim())
      setCandidates(result.items)
      setSearchQuery(result.query)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '在线图片搜索失败')
      setSearchOpen(false)
    } finally {
      setSearching(false)
    }
  }
  const applyCandidate = (candidate: OnlineImageCandidate) => {
    onChange(candidate.image_url)
    setSearchOpen(false)
    toast.success('已应用在线角色图片，保存角色卡后生效')
  }
  const editCandidate = async (candidate: OnlineImageCandidate) => {
    setEditingCandidateUrl(candidate.image_url)
    try {
      const blob = await api.loadSearchImage(candidate.image_url)
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/gif' ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'jpg'
      setCropFile(new File([blob], `online-avatar-${Date.now()}.${extension}`, { type: blob.type || 'image/jpeg' }))
      setSearchOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取在线图片')
    } finally {
      setEditingCandidateUrl('')
    }
  }
  return <><div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><Avatar className="size-14">{url && <AvatarImage src={url} alt="角色头像预览" />}<AvatarFallback><Users className="size-5" /></AvatarFallback></Avatar><div className="min-w-0 flex-1"><Label>角色头像</Label><p className="mt-1 text-xs text-muted-foreground">支持 PNG、JPEG、WebP、GIF，最大 5 MB。</p></div><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { setCropFile(event.target.files?.[0] || null); event.target.value = '' }} /><Button variant="outline" size="sm" className="rounded-full" onClick={() => void searchOnline()} disabled={searching}><Search />在线找图</Button><Button variant="outline" size="sm" className="rounded-full" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}{uploading ? '正在上传…' : '上传图片'}</Button></div><ImageCropDialog file={cropFile} shape="avatar" open={Boolean(cropFile)} onOpenChange={(open) => !open && setCropFile(null)} onConfirm={(file) => { setCropFile(null); void upload(file) }} onError={(message) => toast.error(message)} /><Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>在线角色图片</DialogTitle><DialogDescription>{searching ? '正在查找现有动漫与游戏角色图片…' : searchQuery ? `搜索词：${searchQuery}` : '选择一张图片作为角色头像。'}</DialogDescription></DialogHeader>{searching ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在搜索…</div> : candidates.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{candidates.map((candidate) => <article key={candidate.image_url} className="overflow-hidden rounded-lg border border-border bg-card"><img src={candidate.thumbnail_url} alt={candidate.title} className="aspect-square w-full object-cover" /><div className="space-y-2 p-2"><p className="line-clamp-2 min-h-10 text-xs leading-5">{candidate.title}</p><a className="flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" href={candidate.page_url} target="_blank" rel="noreferrer"><ExternalLink className="size-3 shrink-0" />{candidate.source}</a><Button size="sm" className="w-full" onClick={() => void editCandidate(candidate)} disabled={Boolean(editingCandidateUrl)}>{editingCandidateUrl === candidate.image_url ? <LoaderCircle className="animate-spin" /> : <Pencil />}编辑图片</Button><Button variant="outline" size="sm" className="w-full" onClick={() => applyCandidate(candidate)} disabled={Boolean(editingCandidateUrl)}><Check />直接应用</Button></div></article>)}</div> : <div className="py-12 text-center text-sm text-muted-foreground">没有找到可直接使用的 HTTPS 图片。请调整角色名或改为本地上传。</div>}<DialogFooter><Button variant="ghost" onClick={() => setSearchOpen(false)}>取消</Button></DialogFooter></DialogContent></Dialog></>
}

function EntryEditor({ entry, onUpdate, onDelete }: { entry: WorldbookEntry; onUpdate: (entry: WorldbookEntry, changes: Partial<WorldbookEntry>) => Promise<void>; onDelete: (entry: WorldbookEntry) => Promise<void> }) {
  const [draft, setDraft] = useState(entry)
  useEffect(() => setDraft(entry), [entry])
  return <div className="rounded-xl border border-border p-3"><div className="flex gap-2"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => void onUpdate(entry, { title: draft.title })} /><Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => void onDelete(entry)} aria-label="删除条目"><X /></Button></div><Input className="mt-2" value={draft.keywords.join('、')} placeholder="关键词，用顿号或逗号分隔" onChange={(event) => setDraft({ ...draft, keywords: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} onBlur={() => void onUpdate(entry, { keywords: draft.keywords })} /><Textarea className="mt-2" rows={3} value={draft.content} placeholder="条目内容" onChange={(event) => setDraft({ ...draft, content: event.target.value })} onBlur={() => void onUpdate(entry, { content: draft.content })} /><div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><label className="flex items-center gap-2"><Switch checked={draft.enabled} onCheckedChange={(enabled) => { setDraft({ ...draft, enabled }); void onUpdate(entry, { enabled }) }} />启用</label><label className="flex items-center gap-2"><Switch checked={Boolean(draft.constant)} onCheckedChange={(constant) => { setDraft({ ...draft, constant }); void onUpdate(entry, { constant }) }} />恒定注入</label><label className="flex items-center gap-2">优先级 <Input className="h-8 w-16" type="number" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} onBlur={() => void onUpdate(entry, { priority: draft.priority })} /></label></div></div>
}
