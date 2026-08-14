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
  LoaderCircle,
  Save,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
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
import { api, type RoleCard, type Worldbook, type WorldbookEntry } from '@/lib/api'
import { useSession } from '@/components/session-provider'

type MaterialType = 'character' | 'worldbook'
type AnyMaterial = (RoleCard & { kind: 'character' }) | (Worldbook & { kind: 'worldbook' })

const tabs = [
  { key: 'character' as const, label: '角色卡', icon: Users },
  { key: 'worldbook' as const, label: '世界书', icon: BookMarked },
]

const blankCard = { name: '', avatarUrl: '', persona: '', personality: '', speaking_style: '', relationships: '{}', directives: '', characterAttributes: '{}' }
const blankWorldbook = { title: '', description: '' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function MaterialsView() {
  const { session } = useSession()
  const [tab, setTab] = useState<MaterialType>('character')
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<RoleCard[]>([])
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([])
  const [detail, setDetail] = useState<AnyMaterial | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnyMaterial | null>(null)
  const [editor, setEditor] = useState<AnyMaterial | { kind: MaterialType } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const importFileRef = useRef<HTMLInputElement>(null)

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
      toast.error(error instanceof Error ? error.message : '删除失败')
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <header className="flex flex-col gap-2"><h1 className="font-serif text-2xl font-semibold tracking-tight md:text-3xl">创作素材库</h1><p className="text-pretty text-sm text-muted-foreground md:text-base">管理角色卡与世界书，可在作品编辑器中关联复用。</p></header>

      <div className="mt-6 overflow-x-auto pb-1"><ToggleGroup value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as MaterialType)} className="w-max rounded-full bg-muted/60 p-1">{tabs.map((item) => <ToggleGroupItem key={item.key} value={item.key} className="gap-2 rounded-full px-4 data-[pressed]:bg-card data-[pressed]:shadow-sm"><item.icon className="size-4" />{item.label}<span className="text-xs text-muted-foreground">{item.key === 'character' ? cards.length : worldbooks.length}</span></ToggleGroupItem>)}</ToggleGroup></div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <InputGroup className="rounded-full bg-card sm:max-w-xs"><InputGroupAddon><Search className="size-4 text-muted-foreground" /></InputGroupAddon><InputGroupInput placeholder={`搜索${activeTab.label}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></InputGroup>
        <div className="flex items-center gap-2 sm:ml-auto">
          {tab === 'character' && <><input ref={importFileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCardJson(file) }} /><Button variant="outline" className="rounded-full" disabled={!canWrite} onClick={() => setImportOpen(true)}><Upload data-icon="inline-start" />导入文本</Button><Button variant="outline" className="rounded-full" disabled={!canWrite} onClick={() => importFileRef.current?.click()}><Upload data-icon="inline-start" />导入 JSON</Button></>}
          <Button variant="outline" className="rounded-full" onClick={exportItems} disabled={list.length === 0}><Download data-icon="inline-start" />导出</Button>
          <Button className="rounded-full" disabled={!canWrite} onClick={() => setEditor({ kind: tab })}><Plus data-icon="inline-start" />新建</Button>
        </div>
      </div>

      {loading ? <div className="mt-16 flex justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取素材…</div> : list.length === 0 ? <Empty className="mt-16"><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>没有找到{activeTab.label}</EmptyTitle><EmptyDescription>{canWrite ? '换个关键词，或新建一个吧。' : '登录后可以创建和管理自己的素材。'}</EmptyDescription></EmptyHeader><EmptyContent>{canWrite && <Button className="rounded-full" onClick={() => setEditor({ kind: tab })}><Plus data-icon="inline-start" />新建{activeTab.label}</Button>}</EmptyContent></Empty> : <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((material) => <MaterialCard key={`${material.kind}-${material.id}`} material={material} onOpen={() => setDetail(material)} onEdit={() => setEditor(material)} onDelete={() => setDeleteTarget(material)} />)}</div>}

      <MaterialDetailSheet material={detail} onOpenChange={(open) => !open && setDetail(null)} />
      <MaterialEditor editor={editor} onOpenChange={(open) => !open && setEditor(null)} onSaved={async () => { setEditor(null); await load() }} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent><DialogHeader><DialogTitle>导入文本角色卡</DialogTitle><DialogDescription>粘贴角色卡原文。系统会解析并创建角色卡、配套世界书和一部作品。</DialogDescription></DialogHeader><Textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={10} placeholder="粘贴角色卡文本…" /><DialogFooter><Button variant="ghost" onClick={() => setImportOpen(false)}>取消</Button><Button onClick={() => void importCard()} disabled={saving || !importText.trim()}>{saving ? '正在导入…' : '导入并创建作品'}</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除「{deleteTarget?.kind === 'character' ? deleteTarget.name : deleteTarget?.title}」？</AlertDialogTitle><AlertDialogDescription>若有作品正在关联此素材，系统会阻止删除并提示关联关系。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleDelete()}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}

function MaterialCard({ material, onOpen, onEdit, onDelete }: { material: AnyMaterial; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const title = material.kind === 'character' ? material.name : material.title
  const description = material.kind === 'character' ? material.persona || material.personality || '尚未填写角色设定。' : material.description || '尚未填写世界书简介。'
  const Icon = material.kind === 'character' ? Users : BookMarked
  return <Card className="group cursor-pointer gap-0 overflow-hidden p-4 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30" onClick={onOpen}><div className="flex items-start gap-3"><Avatar className="size-12">{material.kind === 'character' && material.avatar_url && <AvatarImage src={material.avatar_url} alt={`${material.name} 头像`} />}<AvatarFallback><Icon className="size-5" /></AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="truncate font-medium text-foreground">{title}</h2><p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{description}</p></div>{material.can_edit && <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 rounded-full" aria-label="素材操作" onClick={(event) => event.stopPropagation()}><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={(event) => { event.stopPropagation(); onEdit() }}><Pencil className="size-4" />编辑</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={(event) => { event.stopPropagation(); onDelete() }}><Trash2 className="size-4" />删除</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}</div><div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="secondary" className="rounded-full text-[11px]">{material.kind === 'character' ? '角色卡' : `${material.entries?.length || 0} 条世界书条目`}</Badge>{material.owner_username && <Badge variant="outline" className="rounded-full text-[11px]">{material.owner_username}</Badge>}</div></div></div></Card>
}

function MaterialDetailSheet({ material, onOpenChange }: { material: AnyMaterial | null; onOpenChange: (open: boolean) => void }) {
  const [full, setFull] = useState<Worldbook | null>(null)
  useEffect(() => { if (material?.kind === 'worldbook') void api.getWorldbook(material.id).then(setFull).catch(() => setFull(null)); else setFull(null) }, [material])
  const title = material?.kind === 'character' ? material.name : material?.title
  return <Sheet open={!!material} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{title || '素材详情'}</SheetTitle><SheetDescription>{material?.kind === 'character' ? '角色卡详情' : '世界书详情'}</SheetDescription></SheetHeader>{material?.kind === 'character' ? <div className="mt-6 flex flex-col gap-5"><DetailBlock title="人设">{material.persona || '未填写'}</DetailBlock><DetailBlock title="性格">{material.personality || '未填写'}</DetailBlock><DetailBlock title="说话风格">{material.speaking_style || '未填写'}</DetailBlock><DetailBlock title="固定指令">{material.directives?.join('；') || '未填写'}</DetailBlock><DetailBlock title="角色属性">{Object.entries(material.character_attributes || {}).map(([key, value]) => `${key}：${String(value)}`).join('；') || '未填写'}</DetailBlock><DetailBlock title="关系">{Object.entries(material.relationships || {}).map(([key, value]) => `${key}：${String(value)}`).join('；') || '未填写'}</DetailBlock></div> : material?.kind === 'worldbook' ? <div className="mt-6 flex flex-col gap-5"><DetailBlock title="简介">{material.description || '未填写'}</DetailBlock><Separator /><div><h3 className="text-sm font-medium">世界书条目</h3><div className="mt-3 flex flex-col gap-3">{(full?.entries || []).length ? full!.entries!.map((entry) => <div key={entry.id} className="rounded-2xl bg-secondary/50 p-3"><p className="font-medium">{entry.title}</p><p className="mt-1 text-xs text-muted-foreground">关键词：{entry.keywords.join('、') || '无'} · 优先级 {entry.priority}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{entry.content}</p></div>) : <p className="text-sm text-muted-foreground">没有世界书条目。</p>}</div></div></div> : null}</SheetContent></Sheet>
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) { return <div><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{children}</p></div> }

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
    if (existingCard) setCard({ name: existingCard.name, avatarUrl: existingCard.avatar_url || '', persona: existingCard.persona, personality: existingCard.personality, speaking_style: existingCard.speaking_style, relationships: JSON.stringify(existingCard.relationships || {}, null, 2), directives: (existingCard.directives || []).join('\n'), characterAttributes: JSON.stringify(existingCard.character_attributes || {}, null, 2) })
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
        let relationships: Record<string, unknown> = {}
        let characterAttributes: Record<string, unknown> = {}
        try { relationships = card.relationships.trim() ? JSON.parse(card.relationships) : {}; if (!isPlainObject(relationships)) throw new Error('关系字段必须是有效 JSON 对象') } catch { throw new Error('关系字段必须是有效 JSON 对象') }
        try { characterAttributes = card.characterAttributes.trim() ? JSON.parse(card.characterAttributes) : {}; if (!isPlainObject(characterAttributes)) throw new Error('角色属性必须是有效 JSON 对象') } catch { throw new Error('角色属性必须是有效 JSON 对象') }
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

  return <Dialog open={!!editor} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{isCard ? `${existingCard ? '编辑' : '新建'}角色卡` : `${existingWorldbook ? '编辑' : '新建'}世界书`}</DialogTitle><DialogDescription>{isCard ? '角色卡可以被多个作品复用。' : '世界书条目会按关键词参与故事上下文。'}</DialogDescription></DialogHeader>{isCard && <CardAvatarField url={card.avatarUrl} onChange={(avatarUrl) => setCard({ ...card, avatarUrl })} />}{isCard ? <div className="grid gap-4"><div><Label htmlFor="material-name">角色名</Label><Input id="material-name" className="mt-2" value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} /></div><div><Label htmlFor="material-persona">人设</Label><Textarea id="material-persona" className="mt-2" rows={4} value={card.persona} onChange={(event) => setCard({ ...card, persona: event.target.value })} /></div><div><Label htmlFor="material-personality">性格</Label><Textarea id="material-personality" className="mt-2" rows={3} value={card.personality} onChange={(event) => setCard({ ...card, personality: event.target.value })} /></div><div><Label htmlFor="material-speaking">说话风格</Label><Input id="material-speaking" className="mt-2" value={card.speaking_style} onChange={(event) => setCard({ ...card, speaking_style: event.target.value })} /></div><div><Label htmlFor="material-directives">固定指令</Label><Textarea id="material-directives" className="mt-2" rows={4} value={card.directives} placeholder="每行一条，例如：始终保持角色人设" onChange={(event) => setCard({ ...card, directives: event.target.value })} /></div><div><Label htmlFor="material-character-attributes">角色属性（JSON）</Label><Textarea id="material-character-attributes" className="mt-2 font-mono text-xs" rows={4} value={card.characterAttributes} placeholder={'{\n  "心情": 50,\n  "好感度": 0\n}'} onChange={(event) => setCard({ ...card, characterAttributes: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">用于维护 AI 角色自己的状态。</p></div><div><Label htmlFor="material-relationships">关系（JSON）</Label><Textarea id="material-relationships" className="mt-2 font-mono text-xs" rows={4} value={card.relationships} onChange={(event) => setCard({ ...card, relationships: event.target.value })} /></div></div> : <div className="grid gap-4"><div><Label htmlFor="worldbook-title">标题</Label><Input id="worldbook-title" className="mt-2" value={worldbook.title} onChange={(event) => setWorldbook({ ...worldbook, title: event.target.value })} /></div><div><Label htmlFor="worldbook-description">简介</Label><Textarea id="worldbook-description" className="mt-2" rows={3} value={worldbook.description} onChange={(event) => setWorldbook({ ...worldbook, description: event.target.value })} /></div>{existingWorldbook && <div className="border-t pt-4"><div className="flex items-center justify-between"><Label>世界书条目</Label><Button variant="outline" size="sm" onClick={() => void addEntry()}><Plus />添加条目</Button></div>{loadingDetail ? <p className="mt-3 text-sm text-muted-foreground">正在加载条目…</p> : <div className="mt-3 grid gap-3">{entries.map((entry) => <EntryEditor key={entry.id} entry={entry} onUpdate={updateEntry} onDelete={removeEntry} />)}</div>}</div>}</div>}<DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => void save()} disabled={saving}><Save data-icon="inline-start" />{saving ? '正在保存…' : '保存'}</Button></DialogFooter></DialogContent></Dialog>
}

function CardAvatarField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
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
  return <><div className="flex items-center gap-3 rounded-xl border border-border p-3"><Avatar className="size-14">{url && <AvatarImage src={url} alt="角色头像预览" />}<AvatarFallback><Users className="size-5" /></AvatarFallback></Avatar><div className="min-w-0 flex-1"><Label>角色头像</Label><p className="mt-1 text-xs text-muted-foreground">支持 PNG、JPEG、WebP、GIF，最大 5 MB。</p></div><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { setCropFile(event.target.files?.[0] || null); event.target.value = '' }} /><Button variant="outline" size="sm" className="rounded-full" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}{uploading ? '正在上传…' : '上传图片'}</Button></div><ImageCropDialog file={cropFile} shape="avatar" open={Boolean(cropFile)} onOpenChange={(open) => !open && setCropFile(null)} onConfirm={(file) => { setCropFile(null); void upload(file) }} onError={(message) => toast.error(message)} /></>
}

function EntryEditor({ entry, onUpdate, onDelete }: { entry: WorldbookEntry; onUpdate: (entry: WorldbookEntry, changes: Partial<WorldbookEntry>) => Promise<void>; onDelete: (entry: WorldbookEntry) => Promise<void> }) {
  const [draft, setDraft] = useState(entry)
  useEffect(() => setDraft(entry), [entry])
  return <div className="rounded-xl border border-border p-3"><div className="flex gap-2"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={() => void onUpdate(entry, { title: draft.title })} /><Button variant="ghost" size="icon" className="shrink-0 text-destructive" onClick={() => void onDelete(entry)} aria-label="删除条目"><X /></Button></div><Input className="mt-2" value={draft.keywords.join('、')} placeholder="关键词，用顿号或逗号分隔" onChange={(event) => setDraft({ ...draft, keywords: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} onBlur={() => void onUpdate(entry, { keywords: draft.keywords })} /><Textarea className="mt-2" rows={3} value={draft.content} placeholder="条目内容" onChange={(event) => setDraft({ ...draft, content: event.target.value })} onBlur={() => void onUpdate(entry, { content: draft.content })} /><div className="mt-2 flex items-center justify-between text-sm"><label className="flex items-center gap-2"><Switch checked={draft.enabled} onCheckedChange={(enabled) => { setDraft({ ...draft, enabled }); void onUpdate(entry, { enabled }) }} />启用</label><label className="flex items-center gap-2">优先级 <Input className="h-8 w-16" type="number" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} onBlur={() => void onUpdate(entry, { priority: draft.priority })} /></label></div></div>
}
