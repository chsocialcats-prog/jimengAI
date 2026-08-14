'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Info,
  ImageIcon,
  BookOpen,
  Users,
  BookMarked,
  ClipboardList,
  Gauge,
  MessageSquareText,
  GripVertical,
  Plus,
  X,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  LoaderCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { Field, FieldLabel, FieldDescription, FieldGroup } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
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
import { api, type OnboardingField, type ReplyTemplate, type RoleCard, type Work, type Worldbook } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSession } from '@/components/session-provider'

const sections = [
  { id: 'basic', label: '基本信息', icon: Info },
  { id: 'cover', label: '封面', icon: ImageIcon },
  { id: 'opening', label: '开场文本', icon: BookOpen },
  { id: 'characters', label: '角色卡', icon: Users },
  { id: 'worldbooks', label: '世界书', icon: BookMarked },
  { id: 'survey', label: '开场问卷', icon: ClipboardList },
  { id: 'attributes', label: '初始属性', icon: Gauge },
  { id: 'reply', label: '回复设置', icon: MessageSquareText },
] as const

type AttributeRow = { key: string; value: string }
type Draft = {
  title: string
  description: string
  tags: string[]
  coverUrl: string
  opening: string
  cardIds: number[]
  worldbookId: number | null
  onboardingEnabled: boolean
  onboardingIntro: string
  onboardingAllowFreeform: boolean
  onboardingFields: OnboardingField[]
  playerAttributes: AttributeRow[]
  replyTemplates: ReplyTemplate[]
  activeReplyTemplateId: string
  archived: boolean
}

const suggestedTags = ['奇幻', '校园', '悬疑', '科幻', '治愈', '恋爱', '冒险']

function emptyDraft(): Draft {
  return {
    title: '', description: '', tags: [], coverUrl: '', opening: '', cardIds: [], worldbookId: null,
    onboardingEnabled: false, onboardingIntro: '', onboardingAllowFreeform: false, onboardingFields: [], playerAttributes: [],
    replyTemplates: [], activeReplyTemplateId: '', archived: false,
  }
}

function draftFromWork(work: Work): Draft {
  return {
    title: work.title,
    description: work.description,
    tags: work.tags || [],
    coverUrl: work.cover_url || '',
    opening: work.opening || '',
    cardIds: work.card_ids || [],
    worldbookId: work.worldbook_id || null,
    onboardingEnabled: Boolean(work.onboarding?.enabled),
    onboardingIntro: work.onboarding?.intro || '',
    onboardingAllowFreeform: Boolean(work.onboarding?.allow_freeform),
    onboardingFields: work.onboarding?.fields || [],
    playerAttributes: Object.entries(work.player_attributes || {}).map(([key, value]) => ({ key, value: String(value) })),
    replyTemplates: work.reply_templates || [],
    activeReplyTemplateId: work.active_reply_template_id || '',
    archived: Boolean(work.is_archive),
  }
}

function normalizeAttributeValue(value: string): string | number {
  const trimmed = value.trim()
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

export function EditorView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session } = useSession()
  const rawWorkId = searchParams.get('work')
  const workId = rawWorkId && /^\d+$/.test(rawWorkId) ? Number(rawWorkId) : null
  const [active, setActive] = useState<string>('basic')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [cards, setCards] = useState<RoleCard[]>([])
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([])
  const [loadedWork, setLoadedWork] = useState<Work | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (!session.authenticated) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const [nextCards, nextWorldbooks, work] = await Promise.all([
        api.listCards(),
        api.listWorldbooks(),
        workId ? api.getWork(workId) : Promise.resolve(null),
      ])
      setCards(nextCards)
      setWorldbooks(nextWorldbooks)
      setLoadedWork(work)
      setDraft(work ? draftFromWork(work) : emptyDraft())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法打开作品编辑器')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [workId, session.authenticated])

  const selectedCards = useMemo(() => draft.cardIds.map((id) => cards.find((card) => card.id === id)).filter((card): card is RoleCard => Boolean(card)), [cards, draft.cardIds])
  const editable = !loadedWork || loadedWork.can_edit

  const updateDraft = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }))
  const toggleTag = (tag: string) => updateDraft({ tags: draft.tags.includes(tag) ? draft.tags.filter((item) => item !== tag) : [...draft.tags, tag].slice(0, 5) })
  const toggleCard = (cardId: number) => updateDraft({ cardIds: draft.cardIds.includes(cardId) ? draft.cardIds.filter((id) => id !== cardId) : [...draft.cardIds, cardId] })
  const moveCard = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= draft.cardIds.length) return
    const ids = [...draft.cardIds]
    ;[ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]
    updateDraft({ cardIds: ids })
  }
  const addOnboardingField = () => updateDraft({ onboardingFields: [...draft.onboardingFields, { key: `field_${draft.onboardingFields.length + 1}`, label: '', type: 'text', required: false, placeholder: '' }] })
  const updateOnboardingField = (index: number, changes: Partial<OnboardingField>) => updateDraft({ onboardingFields: draft.onboardingFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...changes } : field) })
  const addAttribute = () => updateDraft({ playerAttributes: [...draft.playerAttributes, { key: '', value: '' }] })
  const updateAttribute = (index: number, changes: Partial<AttributeRow>) => updateDraft({ playerAttributes: draft.playerAttributes.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row) })
  const addTemplate = () => {
    const id = `template-${Date.now()}`
    updateDraft({ replyTemplates: [...draft.replyTemplates, { id, name: '新回复模板', content: '' }], activeReplyTemplateId: draft.activeReplyTemplateId || id })
  }
  const updateTemplate = (index: number, changes: Partial<ReplyTemplate>) => updateDraft({ replyTemplates: draft.replyTemplates.map((template, templateIndex) => templateIndex === index ? { ...template, ...changes } : template) })

  const uploadCover = async (file?: File) => {
    if (!file) return
    setCoverUploading(true)
    try {
      const uploaded = await api.uploadImage(file)
      updateDraft({ coverUrl: uploaded.url })
      toast.success('封面已上传')
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : '封面上传失败')
    } finally {
      setCoverUploading(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  const save = async () => {
    if (!draft.title.trim()) { toast.error('请填写作品标题'); return }
    const attributes = draft.playerAttributes.reduce<Record<string, string | number>>((result, row) => {
      if (row.key.trim()) result[row.key.trim()] = normalizeAttributeValue(row.value)
      return result
    }, {})
    const fields = draft.onboardingFields
      .filter((field) => field.label.trim())
      .map((field, index) => ({ ...field, key: field.key.trim() || `field_${index + 1}`, label: field.label.trim(), options: field.type === 'select' ? (field.options || []).filter(Boolean) : undefined }))
    const templates = draft.replyTemplates.filter((template) => template.name.trim() || template.content.trim())
    const activeTemplateId = templates.some((template) => template.id === draft.activeReplyTemplateId) ? draft.activeReplyTemplateId : ''
    const payload = {
      title: draft.title.trim(),
      description: draft.description,
      tags: draft.tags,
      cover_url: draft.coverUrl,
      opening: draft.opening,
      card_ids: draft.cardIds,
      worldbook_id: draft.worldbookId,
      onboarding: { enabled: draft.onboardingEnabled, intro: draft.onboardingIntro, allow_freeform: draft.onboardingAllowFreeform, fields },
      player_attributes: attributes,
      reply_templates: templates,
      active_reply_template_id: activeTemplateId,
      is_archive: draft.archived,
    }
    setSaving(true)
    try {
      const saved = workId ? await api.updateWork(workId, payload) : await api.createWork(payload)
      setLoadedWork(saved)
      setDraft(draftFromWork(saved))
      toast.success('作品已保存')
      if (!workId) router.replace(`/editor?work=${saved.id}`)
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '保存作品失败')
    } finally { setSaving(false) }
  }

  const deleteWork = async () => {
    if (!workId) return
    try {
      await api.deleteWork(workId)
      toast.success('作品已删除')
      router.push('/')
    } catch (deleteError) { toast.error(deleteError instanceof Error ? deleteError.message : '删除失败') }
  }

  if (!session.authenticated) return <EditorEmpty title="登录后开始创作" description="创建和修改作品需要登录本地账户。" actionHref="/login" actionLabel="前往登录" />
  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在打开编辑器…</div>
  if (error) return <EditorEmpty title="无法打开编辑器" description={error} actionHref="/" actionLabel="返回作品库" />
  if (!editable) return <EditorEmpty title="该作品仅可浏览" description="只有作品创建者可以修改其内容。" actionHref="/" actionLabel="返回作品库" />

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="rounded-full" render={<Link href="/" aria-label="返回作品库" />} nativeButton={false}><ArrowLeft className="size-5" /></Button><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate font-serif text-xl font-semibold md:text-2xl">{workId ? '编辑作品' : '新建作品'}</h1>{draft.archived && <Badge variant="secondary" className="rounded-full">已归档</Badge>}</div><p className="truncate text-xs text-muted-foreground">{workId ? '修改后点击保存，变更会写入当前账户的数据。' : '填写基本设定后保存，即可创建作品。'}</p></div><Button className="rounded-full" onClick={() => void save()} disabled={saving}><Save data-icon="inline-start" />{saving ? '正在保存…' : '保存'}</Button></div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row"><aside className="lg:w-52 lg:shrink-0"><nav className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">{sections.map((section) => { const isActive = active === section.id; return <button key={section.id} onClick={() => { setActive(section.id); document.getElementById(`sec-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className={cn('flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors lg:w-full', isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}><section.icon className="size-4 shrink-0" />{section.label}</button> })}</nav></aside>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <SectionCard id="basic" title="基本信息" desc="作品的标题、简介与题材标签" icon={Info}><FieldGroup><Field><FieldLabel htmlFor="title">作品标题</FieldLabel><Input id="title" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></Field><Field><FieldLabel htmlFor="description">作品简介</FieldLabel><Textarea id="description" rows={3} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} /><FieldDescription>简介会展示在作品库卡片中。</FieldDescription></Field><Field><FieldLabel>题材标签</FieldLabel><div className="flex flex-wrap gap-2">{suggestedTags.map((tag) => <button key={tag} type="button" onClick={() => toggleTag(tag)} className={cn('rounded-full border px-3 py-1 text-sm transition-colors', draft.tags.includes(tag) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40')}>{tag}</button>)}</div><FieldDescription>最多选择 5 个标签。</FieldDescription></Field><Field orientation="horizontal"><div><FieldLabel>归档作品</FieldLabel><FieldDescription>归档后不再显示“进入冒险”操作，仍可恢复编辑。</FieldDescription></div><Switch checked={draft.archived} onCheckedChange={(archived) => updateDraft({ archived })} /></Field></FieldGroup></SectionCard>

          <SectionCard id="cover" title="封面" desc="上传本地图片或填写图片地址，展示在作品库" icon={ImageIcon}><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="relative aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"><img src={draft.coverUrl || '/images/covers/sakura-station.png'} alt="当前封面预览" className="size-full object-cover" /></div><div className="flex min-w-0 flex-1 flex-col gap-2"><Label htmlFor="cover-url">封面图片地址</Label><Input id="cover-url" value={draft.coverUrl} onChange={(event) => updateDraft({ coverUrl: event.target.value })} placeholder="留空将使用默认封面" /><div className="flex items-center gap-2"><input ref={coverInputRef} id="cover-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { setCoverCropFile(event.target.files?.[0] || null); event.target.value = '' }} /><Button variant="outline" size="sm" className="w-fit rounded-full" onClick={() => coverInputRef.current?.click()} disabled={coverUploading}>{coverUploading ? <LoaderCircle className="animate-spin" /> : <ImageIcon />}{coverUploading ? '正在上传…' : '上传封面'}</Button><p className="text-xs text-muted-foreground">支持 PNG、JPEG、WebP、GIF，最大 5 MB。</p></div></div></div></SectionCard>

          <SectionCard id="opening" title="开场文本" desc="玩家进入冒险后看到的第一段旁白" icon={BookOpen}><Textarea rows={7} className="leading-relaxed" value={draft.opening} onChange={(event) => updateDraft({ opening: event.target.value })} placeholder="故事从这里开始…" /></SectionCard>

          <SectionCard id="characters" title="角色卡" desc="选择并排列本作采用的角色卡；顺序会影响 AI 上下文" icon={Users}><div className="grid gap-3 md:grid-cols-2">{cards.length ? cards.map((card) => { const checked = draft.cardIds.includes(card.id); return <label key={card.id} className={cn('flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors', checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50')}><input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleCard(card.id)} /><Avatar className="size-10">{card.avatar_url && <AvatarImage src={card.avatar_url} alt={`${card.name} 头像`} />}<AvatarFallback>{card.name.slice(0, 1)}</AvatarFallback></Avatar><span className="min-w-0"><span className="block font-medium">{card.name}</span><span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{card.persona || card.personality || '未填写简介'}</span></span></label> }) : <p className="text-sm text-muted-foreground">还没有角色卡。请先在素材库中创建。</p>}</div>{selectedCards.length > 0 && <div className="mt-5"><p className="mb-2 text-sm font-medium">上下文顺序</p><div className="flex flex-col gap-2">{selectedCards.map((card, index) => <div key={card.id} className="flex items-center gap-2 rounded-xl bg-secondary/50 p-2"><GripVertical className="size-4 text-muted-foreground" /><span className="flex-1 text-sm">{index + 1}. {card.name}</span><Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => moveCard(index, -1)} aria-label="上移角色卡"><ChevronUp /></Button><Button variant="ghost" size="icon-sm" disabled={index === selectedCards.length - 1} onClick={() => moveCard(index, 1)} aria-label="下移角色卡"><ChevronDown /></Button></div>)}</div></div>}</SectionCard>

          <SectionCard id="worldbooks" title="世界书" desc="关联一份世界书，按关键词补充设定" icon={BookMarked}><label className="grid gap-2"><span className="text-sm font-medium">关联世界书</span><select value={draft.worldbookId ? String(draft.worldbookId) : ''} onChange={(event) => updateDraft({ worldbookId: event.target.value ? Number(event.target.value) : null })} className="h-10 rounded-xl border border-input bg-transparent px-3 text-sm"><option value="">不关联世界书</option>{worldbooks.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label><p className="mt-3 text-xs text-muted-foreground">世界书条目可在素材库中单独维护。</p></SectionCard>

          <SectionCard id="survey" title="开场问卷" desc="在创建新存档时向玩家收集可选设定" icon={ClipboardList}>
            <Field orientation="horizontal"><div><FieldLabel>启用开场问卷</FieldLabel><FieldDescription>每个新存档都会显示这里设置的字段。</FieldDescription></div><Switch checked={draft.onboardingEnabled} onCheckedChange={(onboardingEnabled) => updateDraft({ onboardingEnabled })} /></Field>
            {draft.onboardingEnabled && <div className="mt-5 grid gap-4">
              <Field><FieldLabel>引导文案</FieldLabel><Textarea rows={2} value={draft.onboardingIntro} onChange={(event) => updateDraft({ onboardingIntro: event.target.value })} placeholder="请先设定你在这个故事中的身份。" /></Field>
              <Field orientation="horizontal"><div><FieldLabel>允许玩家补充设定</FieldLabel><FieldDescription>在预设问题之外，给玩家留一段自由填写空间。</FieldDescription></div><Switch checked={draft.onboardingAllowFreeform} onCheckedChange={(onboardingAllowFreeform) => updateDraft({ onboardingAllowFreeform })} /></Field>
              <div className="flex items-center justify-between"><h3 className="text-sm font-medium">问题字段</h3><Button variant="outline" size="sm" onClick={addOnboardingField}><Plus />添加字段</Button></div>
              {draft.onboardingFields.map((field, index) => <OnboardingFieldEditor key={`${field.key}-${index}`} field={field} onChange={(changes) => updateOnboardingField(index, changes)} onRemove={() => updateDraft({ onboardingFields: draft.onboardingFields.filter((_, fieldIndex) => fieldIndex !== index) })} />)}
            </div>}
          </SectionCard>

          <SectionCard id="attributes" title="初始属性" desc="设置玩家进入冒险时的初始数值或文本状态" icon={Gauge}><div className="flex flex-col gap-3">{draft.playerAttributes.map((row, index) => <div key={index} className="flex gap-2"><Input value={row.key} onChange={(event) => updateAttribute(index, { key: event.target.value })} placeholder="属性名，如：体力" /><Input value={row.value} onChange={(event) => updateAttribute(index, { value: event.target.value })} placeholder="初始值，如：100" /><Button variant="ghost" size="icon" className="text-destructive" onClick={() => updateDraft({ playerAttributes: draft.playerAttributes.filter((_, rowIndex) => rowIndex !== index) })} aria-label="移除属性"><X /></Button></div>)}<Button variant="outline" className="w-full" onClick={addAttribute}><Plus />添加属性</Button></div></SectionCard>

          <SectionCard id="reply" title="回复设置" desc="为这个作品保存可复用的回复模板" icon={MessageSquareText}><div className="flex flex-col gap-4">{draft.replyTemplates.map((template, index) => <div key={template.id} className="rounded-2xl border border-border p-4"><div className="flex gap-2"><Input value={template.name} onChange={(event) => updateTemplate(index, { name: event.target.value })} placeholder="模板名称" /><Button variant="ghost" size="icon" className="text-destructive" onClick={() => updateDraft({ replyTemplates: draft.replyTemplates.filter((_, templateIndex) => templateIndex !== index), activeReplyTemplateId: draft.activeReplyTemplateId === template.id ? '' : draft.activeReplyTemplateId })} aria-label="删除模板"><X /></Button></div><Textarea className="mt-3" rows={4} value={template.content} onChange={(event) => updateTemplate(index, { content: event.target.value })} placeholder="例如：以第三人称、每次 3-5 段的格式回复…" /><label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" name="active-template" checked={draft.activeReplyTemplateId === template.id} onChange={() => updateDraft({ activeReplyTemplateId: template.id })} />作为当前模板</label></div>)}<Button variant="outline" className="w-full" onClick={addTemplate}><Plus />添加回复模板</Button></div></SectionCard>

          <div className="flex items-center justify-between gap-3 pt-2">{workId ? <Button variant="ghost" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 data-icon="inline-start" />删除作品</Button> : <span />}{<Button className="rounded-full" onClick={() => void save()} disabled={saving}><Save data-icon="inline-start" />{saving ? '正在保存…' : '保存全部更改'}</Button>}</div>
        </div>
      </div>
      <ImageCropDialog file={coverCropFile} shape="cover" open={Boolean(coverCropFile)} onOpenChange={(open) => !open && setCoverCropFile(null)} onConfirm={(file) => { setCoverCropFile(null); void uploadCover(file) }} onError={(message) => toast.error(message)} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除这部作品？</AlertDialogTitle><AlertDialogDescription>作品及关联的内容将无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteWork()}>删除作品</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}

function SectionCard({ id, title, desc, icon: Icon, children }: { id: string; title: string; desc: string; icon: typeof Info; children: React.ReactNode }) {
  return <Card id={`sec-${id}`} className="scroll-mt-20 gap-4 p-5 md:p-6"><div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4.5" /></div><div><h2 className="font-medium">{title}</h2><p className="text-sm text-muted-foreground">{desc}</p></div></div><Separator />{children}</Card>
}

function OnboardingFieldEditor({ field, onChange, onRemove }: { field: OnboardingField; onChange: (changes: Partial<OnboardingField>) => void; onRemove: () => void }) {
  return <div className="rounded-xl border border-border p-3"><div className="grid gap-2 sm:grid-cols-2"><Input value={field.label} onChange={(event) => onChange({ label: event.target.value })} placeholder="字段名称" /><select value={field.type} onChange={(event) => onChange({ type: event.target.value as OnboardingField['type'], options: event.target.value === 'select' ? field.options || [] : undefined })} className="h-10 rounded-xl border border-input bg-transparent px-3 text-sm"><option value="text">短文本</option><option value="textarea">长文本</option><option value="select">单选</option></select><Input value={field.placeholder || ''} onChange={(event) => onChange({ placeholder: event.target.value })} placeholder="填写提示" /><Input value={field.key} onChange={(event) => onChange({ key: event.target.value.replace(/[^A-Za-z0-9_]/g, '_') })} placeholder="字段 key" /></div>{field.type === 'select' && <Input className="mt-2" value={(field.options || []).join('、')} onChange={(event) => onChange({ options: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="选项，用顿号或逗号分隔" />}<div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><Switch checked={Boolean(field.required)} onCheckedChange={(required) => onChange({ required })} />必填</label><Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}><X />删除</Button></div></div>
}

function EditorEmpty({ title, description, actionHref, actionLabel }: { title: string; description: string; actionHref: string; actionLabel: string }) {
  return <div className="flex min-h-[60vh] items-center justify-center p-6"><Empty className="max-w-md rounded-3xl border border-dashed border-border bg-card/50 py-14"><EmptyHeader><EmptyMedia variant="icon"><BookOpen /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader><EmptyContent><Button className="rounded-full" render={<Link href={actionHref} />} nativeButton={false}>{actionLabel}</Button></EmptyContent></Empty></div>
}
