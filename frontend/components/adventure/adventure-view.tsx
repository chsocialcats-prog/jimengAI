'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Square,
  Flag,
  Copy,
  ChevronRight,
  Sparkles,
  Save,
  Menu,
  LoaderCircle,
  GitBranch,
  RotateCcw,
  Trash2,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { StatusPanel } from './status-panel'
import { ModelReasoningSelector } from './model-reasoning-selector'
import { ThemeToggle } from '@/components/theme-toggle'
import { api, streamChat, type AdventureState, type Conversation, type MemorySummary, type ModelProvider, type Snapshot, type StoryMessage } from '@/lib/api'
import { useSession } from '@/components/session-provider'
import { defaultReplyLength, loadReplyLength, saveReplyLength, type ReplyLengthKey } from '@/lib/reply-length'
import { defaultReasoningEffort, loadReasoningEffort, saveReasoningEffort, type ReasoningEffortKey } from '@/lib/reasoning-effort'

const emptyState: AdventureState = {
  attributes: {},
  items: [],
  money: 0,
  relations: {},
  quests: [],
  flags: [],
  characters: {},
  logs: [],
}

const emptyMemorySummary: MemorySummary = {
  summary: '',
  covered_until_sequence: -1,
  updated_at: null,
}

const actionSuggestions = ['观察周围', '与角色交谈', '继续前进']

function latestActionOptions(messages: StoryMessage[]) {
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const options = latestAssistant?.metadata?.options
  if (!Array.isArray(options)) return actionSuggestions
  const visible = options.filter((option): option is string => typeof option === 'string' && Boolean(option.trim())).slice(0, 4)
  return visible.length ? visible : actionSuggestions
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function AdventureView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session } = useSession()
  const rawId = searchParams.get('conversation') || ''
  const conversationId = Number(rawId)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<StoryMessage[]>([])
  const [state, setState] = useState<AdventureState>(emptyState)
  const [memorySummary, setMemorySummary] = useState<MemorySummary>(emptyMemorySummary)
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [correctTarget, setCorrectTarget] = useState<StoryMessage | null>(null)
  const [correction, setCorrection] = useState('')
  const [correctionKind, setCorrectionKind] = useState('memory')
  const [replyLength, setReplyLength] = useState<ReplyLengthKey>(defaultReplyLength)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortKey>(defaultReasoningEffort)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [providersLoading, setProvidersLoading] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [onboardingValues, setOnboardingValues] = useState<Record<string, string>>({})
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotNote, setSnapshotNote] = useState('')
  const [snapshotSaving, setSnapshotSaving] = useState(false)
  const [branchSnapshot, setBranchSnapshot] = useState<Snapshot | null>(null)
  const [branchTitle, setBranchTitle] = useState('')
  const [branchSaving, setBranchSaving] = useState(false)
  const [snapshotToDelete, setSnapshotToDelete] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadAdventure = async () => {
    if (!Number.isInteger(conversationId) || conversationId <= 0 || !session.authenticated) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [nextConversation, nextMessages, nextState, nextMemorySummary] = await Promise.all([
        api.getConversation(conversationId),
        api.getMessages(conversationId),
        api.getState(conversationId),
        api.getMemorySummary(conversationId),
      ])
      setConversation(nextConversation)
      setMessages(nextMessages)
      setState(nextState)
      setMemorySummary(nextMemorySummary)
      setReplyLength(loadReplyLength(nextConversation.id))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取冒险数据')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAdventure()
  }, [conversationId, session.authenticated])

  const refreshProviders = async () => {
    const settings = await api.getSettings()
    setProviders(settings.providers || [])
  }

  useEffect(() => {
    if (!conversation || !session.authenticated) {
      setProviders([])
      return
    }
    let cancelled = false
    const loadProviders = async () => {
      setProvidersLoading(true)
      try {
        const settings = await api.getSettings()
        if (cancelled) return
        setProviders(settings.providers || [])
        setReasoningEffort(loadReasoningEffort(conversation.id, settings.generation?.reasoning_effort))
      } catch {
        if (!cancelled) setProviders([])
      } finally {
        if (!cancelled) setProvidersLoading(false)
      }
    }
    void loadProviders()
    return () => { cancelled = true }
  }, [conversation?.id, session.authenticated])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, generating])

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || generating || !conversation) return
    const temporaryUserId = -Date.now()
    const temporaryAssistantId = temporaryUserId - 1
    const now = new Date().toISOString()
    setMessages((previous) => [
      ...previous,
      { id: temporaryUserId, conversation_id: conversationId, role: 'user', content: trimmed, sequence: previous.length, metadata: {}, token_count: 0, created_at: now },
      { id: temporaryAssistantId, conversation_id: conversationId, role: 'assistant', content: '', sequence: previous.length + 1, metadata: { status: 'streaming' }, token_count: 0, created_at: now },
    ])
    setInput('')
    setGenerating(true)
    await streamChat(conversationId, trimmed, {
      onDelta: (content) => {
        setMessages((previous) => previous.map((message) => message.id === temporaryAssistantId ? { ...message, content: message.content + content } : message))
      },
      onState: (event) => {
        if (event.current_state) setState(event.current_state)
      },
      onError: (message) => toast.error(message),
      onFinish: () => setGenerating(false),
    }, { reply_length: replyLength, reasoning_effort: reasoningEffort })
    try {
      const [nextMessages, nextConversation, nextState, nextMemorySummary] = await Promise.all([
        api.getMessages(conversationId),
        api.getConversation(conversationId),
        api.getState(conversationId),
        api.getMemorySummary(conversationId),
      ])
      setMessages(nextMessages)
      setConversation(nextConversation)
      setState(nextState)
      setMemorySummary(nextMemorySummary)
    } catch {
      // The partial response remains visible if the post-stream refresh is interrupted.
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      void submit(input)
    }
  }

  const stop = async () => {
    if (!conversation) return
    try {
      await api.stopConversation(conversation.id)
      toast('正在停止生成…')
    } catch (stopError) {
      toast.error(stopError instanceof Error ? stopError.message : '无法停止生成')
    }
  }

  const addManualLog = async (content: string) => {
    if (!conversation) return
    try {
      const nextState = await api.updateState(conversation.id, {
        logs: [{ type: 'manual', message: content.trim() }],
      })
      setState(nextState)
      toast.success('已添加剧情日志')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '添加剧情日志失败')
      throw saveError
    }
  }

  const saveCorrection = async () => {
    if (!correctTarget || !correction.trim()) return
    try {
      await api.addCorrection(conversationId, correctionKind, correction.trim())
      toast.success(correctionKind === 'persona' ? '已记录角色设定修正' : '已记录剧情纠正，将影响后续剧情')
      setCorrectTarget(null)
      setCorrection('')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '保存纠正失败')
    }
  }

  const openCorrection = (kind: 'memory' | 'persona', target: StoryMessage | null = null) => {
    setCorrectionKind(kind)
    setCorrectTarget(target || { id: -1, conversation_id: conversationId, role: 'assistant', content: '', sequence: 0, metadata: {}, token_count: 0, created_at: '' })
    setCorrection('')
  }

  const openOnboarding = () => {
    if (!conversation) return
    const values = { ...conversation.onboarding_answers }
    for (const field of conversation.onboarding_config?.fields || []) values[field.key] ??= field.default || ''
    setOnboardingValues(values)
    setOnboardingOpen(true)
  }

  const saveOnboarding = async () => {
    if (!conversation) return
    const missing = (conversation.onboarding_config?.fields || []).find((field) => field.required && !onboardingValues[field.key]?.trim())
    if (missing) { toast.error(`请填写「${missing.label}」`); return }
    setOnboardingSaving(true)
    try {
      const updated = await api.completeOnboarding(conversation.id, onboardingValues)
      setConversation(updated)
      setOnboardingOpen(false)
      toast.success('开局设定已更新')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '保存开局设定失败')
    } finally { setOnboardingSaving(false) }
  }

  const openSnapshots = async () => {
    if (!conversation) return
    setSnapshotsOpen(true)
    setSnapshotsLoading(true)
    setBranchSnapshot(null)
    setSnapshotName(`手动存档 ${new Date().toLocaleString('zh-CN')}`)
    setSnapshotNote('')
    try { setSnapshots(await api.listSnapshots(conversation.id)) } catch (loadError) { toast.error(loadError instanceof Error ? loadError.message : '无法读取存档点') } finally { setSnapshotsLoading(false) }
  }

  const createSnapshot = async () => {
    if (!conversation || !snapshotName.trim()) return
    setSnapshotSaving(true)
    try {
      const created = await api.createSnapshot(conversation.id, snapshotName.trim(), snapshotNote.trim())
      setSnapshots((previous) => [created, ...previous])
      setSnapshotName(`手动存档 ${new Date().toLocaleString('zh-CN')}`)
      setSnapshotNote('')
      toast.success('已创建手动存档')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '创建存档失败')
    } finally { setSnapshotSaving(false) }
  }

  const restoreSnapshot = async (snapshot: Snapshot) => {
    if (!conversation) return
    try {
      const restored = await api.restoreSnapshot(conversation.id, snapshot.id)
      setState(restored.state)
      setConversation(restored.conversation)
      setMessages(restored.messages)
      try {
        setMemorySummary(await api.getMemorySummary(conversation.id))
      } catch {
        setMemorySummary(emptyMemorySummary)
      }
      setSnapshotsOpen(false)
      toast.success('已恢复到所选存档点')
    } catch (restoreError) { toast.error(restoreError instanceof Error ? restoreError.message : '恢复存档失败') }
  }

  const deleteSnapshot = async (snapshot: Snapshot) => {
    if (!conversation) return
    try {
      await api.deleteSnapshot(conversation.id, snapshot.id)
      setSnapshots((previous) => previous.filter((item) => item.id !== snapshot.id))
      if (branchSnapshot?.id === snapshot.id) setBranchSnapshot(null)
      toast.success('存档点已删除')
    } catch (deleteError) { toast.error(deleteError instanceof Error ? deleteError.message : '删除存档失败') }
  }

  const createBranch = async () => {
    if (!conversation || !branchSnapshot || !branchTitle.trim()) return
    setBranchSaving(true)
    try {
      const branch = await api.createConversationBranch(conversation.id, { title: branchTitle.trim(), branch_label: branchSnapshot.name, snapshot_id: branchSnapshot.id })
      toast.success('已从这个存档点创建分支')
      router.push(`/adventure?conversation=${branch.id}`)
    } catch (branchError) { toast.error(branchError instanceof Error ? branchError.message : '创建分支失败') } finally { setBranchSaving(false) }
  }

  if (!session.authenticated) {
    return <AdventureEmpty title="登录后继续冒险" description="冒险会话和存档仅对当前本地账户可见。" actionHref="/login" actionLabel="前往登录" />
  }
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return <AdventureEmpty title="请选择一个存档" description="从作品库创建新的冒险，或在存档页继续已有故事。" actionHref="/saves" actionLabel="查看我的存档" />
  }
  if (loading) {
    return <div className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在载入冒险…</div>
  }
  if (error || !conversation) {
    return <AdventureEmpty title="无法打开这个冒险" description={error || '会话不存在或你没有访问权限。'} actionHref="/saves" actionLabel="返回存档" />
  }

  return (
    <div className="flex h-[calc(100dvh-0px)] flex-col bg-background md:h-screen">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur-sm">
        <Button variant="ghost" size="icon" className="rounded-full" render={<Link href="/saves" aria-label="返回我的存档" />} nativeButton={false}><ArrowLeft /></Button>
        <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold text-foreground">{conversation.title}</h1><p className="truncate text-xs text-muted-foreground">{conversation.status === 'archived' ? '已归档 · 只读前请恢复' : '正在冒险 · 自动保存已开启'}</p></div>
        <Badge variant="secondary" className="hidden gap-1 rounded-full sm:inline-flex"><Save className="size-3" />已自动保存</Badge>
        <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon" className="rounded-full" onClick={() => void openSnapshots()} aria-label="管理存档点"><Save /></Button>} /><TooltipContent>管理存档点</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon" className="hidden rounded-full sm:inline-flex" onClick={openOnboarding} aria-label="编辑开局设定"><Settings2 /></Button>} /><TooltipContent>编辑开局设定</TooltipContent></Tooltip>
        <ThemeToggle />
        <Sheet>
          <SheetTrigger render={<Button variant="outline" size="icon" className="rounded-full lg:hidden" aria-label="打开状态面板"><Menu /></Button>} />
          <SheetContent side="right" className="w-[88%] max-w-sm overflow-y-auto p-0 sm:w-96"><SheetHeader className="border-b border-border/60"><SheetTitle>冒险状态</SheetTitle></SheetHeader><StatusPanel state={state} conversation={conversation} memorySummary={memorySummary} onAddLog={addManualLog} /></SheetContent>
        </Sheet>
        <Tooltip><TooltipTrigger render={<Button variant="outline" size="icon" className="hidden rounded-full lg:inline-flex" onClick={() => setPanelOpen((value) => !value)} aria-label={panelOpen ? '收起状态面板' : '展开状态面板'}>{panelOpen ? <PanelRightClose /> : <PanelRightOpen />}</Button>} /><TooltipContent>{panelOpen ? '收起状态面板' : '展开状态面板'}</TooltipContent></Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 md:px-6">
              {messages.map((message) => <MessageBlock key={message.id} message={message} onCorrect={() => openCorrection('memory', message)} />)}
              {generating && messages.at(-1)?.content === '' && (
                <div className="flex flex-col gap-2"><div className="flex items-center gap-2 text-sm text-primary"><Spinner /><span>正在续写剧情…</span></div><div className="flex flex-col gap-2 rounded-3xl rounded-tl-md bg-card p-5 shadow-sm"><div className="h-3 w-[92%] animate-pulse rounded-full bg-muted" /><div className="h-3 w-[78%] animate-pulse rounded-full bg-muted" /><div className="h-3 w-[85%] animate-pulse rounded-full bg-muted" /></div></div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border/60 bg-card/80 backdrop-blur-sm">
            <div className="mx-auto w-full max-w-2xl px-4 py-3 md:px-6">
              {!generating && conversation.status === 'active' && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {latestActionOptions(messages).map((option) => <button key={option} type="button" onClick={() => void submit(option)} className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-primary/10"><Sparkles className="size-3.5 text-primary" /><span>{option}</span><ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></button>)}
                </div>
              )}
              <InputGroup className="rounded-3xl">
                <InputGroupTextarea placeholder={conversation.status === 'archived' ? '该会话已归档，请先恢复后继续。' : '描述你的行动或对话…（Enter 发送，Shift+Enter 换行）'} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} disabled={generating || conversation.status !== 'active'} className="min-h-[52px]" />
                <InputGroupAddon align="block-end" className="flex-wrap justify-between gap-x-2 gap-y-1.5">
                  <div className="flex min-w-0 items-center gap-2"><button type="button" className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={() => openCorrection('persona')} disabled={generating}>修正人设</button><span className="shrink-0 text-border">·</span><button type="button" className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={() => openCorrection('memory')} disabled={generating}>修正记忆</button><select aria-label="回复长度" value={replyLength} onChange={(event) => setReplyLength(saveReplyLength(conversation.id, event.target.value))} disabled={generating} className="max-w-20 bg-transparent text-xs text-muted-foreground outline-none"><option value="short">简短</option><option value="standard">标准</option><option value="detailed">详细</option><option value="long">超长</option></select></div>
                  <div className="ml-auto flex shrink-0 items-center gap-2"><ModelReasoningSelector providers={providers} providersLoading={providersLoading} reasoningEffort={reasoningEffort} disabled={generating || conversation.status !== 'active'} onReasoningEffortChange={(effort) => setReasoningEffort(saveReasoningEffort(conversation.id, effort))} onProvidersRefresh={refreshProviders} />{generating ? <InputGroupButton variant="outline" className="rounded-full" onClick={() => void stop()}><Square data-icon="inline-start" />停止</InputGroupButton> : <InputGroupButton variant="default" className="rounded-full" disabled={!input.trim() || conversation.status !== 'active'} onClick={() => void submit(input)}><Send data-icon="inline-start" />发送</InputGroupButton>}</div>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
        </div>
        {panelOpen && <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border/60 bg-secondary/30 lg:block xl:w-96"><StatusPanel state={state} conversation={conversation} memorySummary={memorySummary} onAddLog={addManualLog} /></aside>}
      </div>

      <Dialog open={!!correctTarget} onOpenChange={(open) => !open && setCorrectTarget(null)}>
        <DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>{correctionKind === 'persona' ? '修正角色设定' : '补充剧情纠正'}</DialogTitle><DialogDescription>{correctionKind === 'persona' ? '记录角色必须保持的人设、关系或说话方式，之后的回复会优先遵循。' : '记录要保留或避免的剧情信息，系统会在后续生成时参考，不会改写已经保存的消息。'}</DialogDescription></DialogHeader><Textarea value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder={correctionKind === 'persona' ? '例如：角色只会用敬语称呼玩家，当前关系仍然陌生。' : '例如：角色的名字应为……，后续不要再……'} rows={6} className="rounded-2xl" /><DialogFooter><Button variant="ghost" className="rounded-full" onClick={() => setCorrectTarget(null)}>取消</Button><Button className="rounded-full" onClick={() => void saveCorrection()} disabled={!correction.trim()}>保存纠正</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>开局设定</DialogTitle><DialogDescription>{conversation.onboarding_config?.intro || '这份设定会在之后的剧情中持续生效。'}</DialogDescription></DialogHeader><div className="grid gap-4">{(conversation.onboarding_config?.fields || []).map((field) => <label key={field.key} className="grid gap-2 text-sm font-medium"><span>{field.label}{field.required && <span className="ml-1 text-primary">*</span>}</span>{field.type === 'textarea' ? <Textarea rows={3} value={onboardingValues[field.key] || ''} placeholder={field.placeholder} onChange={(event) => setOnboardingValues((previous) => ({ ...previous, [field.key]: event.target.value }))} /> : field.type === 'select' ? <select value={onboardingValues[field.key] || ''} onChange={(event) => setOnboardingValues((previous) => ({ ...previous, [field.key]: event.target.value }))} className="h-10 rounded-xl border border-input bg-transparent px-3 text-sm font-normal"><option value="">请选择</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <Input value={onboardingValues[field.key] || ''} placeholder={field.placeholder} onChange={(event) => setOnboardingValues((previous) => ({ ...previous, [field.key]: event.target.value }))} />}</label>)}{conversation.onboarding_config?.allow_freeform && <label className="grid gap-2 text-sm font-medium"><span>补充设定</span><Textarea rows={3} value={onboardingValues.freeform || ''} placeholder="补充希望保留的背景、关系或叙事偏好。" onChange={(event) => setOnboardingValues((previous) => ({ ...previous, freeform: event.target.value }))} /></label>}</div><DialogFooter><Button variant="ghost" onClick={() => setOnboardingOpen(false)} disabled={onboardingSaving}>取消</Button><Button onClick={() => void saveOnboarding()} disabled={onboardingSaving}>{onboardingSaving ? '正在保存…' : '保存设定'}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={snapshotsOpen} onOpenChange={setSnapshotsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>存档点与分支</DialogTitle><DialogDescription>手动存档会保留当前剧情消息和角色状态；从任意存档点可以开启新的故事分支。</DialogDescription></DialogHeader><div className="grid gap-3 rounded-2xl bg-secondary/45 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-2"><Input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} placeholder="存档名称" /><Input value={snapshotNote} onChange={(event) => setSnapshotNote(event.target.value)} placeholder="备注（可选）" /></div><Button className="rounded-full sm:self-center" onClick={() => void createSnapshot()} disabled={snapshotSaving || !snapshotName.trim()}><Save data-icon="inline-start" />{snapshotSaving ? '正在保存…' : '创建存档'}</Button></div>{snapshotsLoading ? <div className="py-10 text-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />正在读取存档点…</div> : snapshots.length ? <div className="flex flex-col gap-2">{snapshots.map((snapshot) => <div key={snapshot.id} className="rounded-2xl border border-border p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{snapshot.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatTime(snapshot.created_at)}{snapshot.note ? ` · ${snapshot.note}` : ''}</p></div><div className="flex shrink-0 gap-1"><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => void restoreSnapshot(snapshot)} aria-label="恢复存档"><RotateCcw /></Button>} /><TooltipContent>恢复</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => { setBranchSnapshot(snapshot); setBranchTitle(`${conversation.title} · ${snapshot.name}`) }} aria-label="创建分支"><GitBranch /></Button>} /><TooltipContent>从此处分支</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full text-destructive hover:text-destructive" onClick={() => setSnapshotToDelete(snapshot)} aria-label="删除存档"><Trash2 /></Button>} /><TooltipContent>删除存档</TooltipContent></Tooltip></div></div>{branchSnapshot?.id === snapshot.id && <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row"><Input value={branchTitle} onChange={(event) => setBranchTitle(event.target.value)} placeholder="分支名称" /><Button size="sm" className="rounded-full" onClick={() => void createBranch()} disabled={branchSaving || !branchTitle.trim()}><GitBranch data-icon="inline-start" />{branchSaving ? '正在创建…' : '创建分支'}</Button><Button variant="ghost" size="sm" className="rounded-full" onClick={() => setBranchSnapshot(null)} disabled={branchSaving}>取消</Button></div>}</div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">还没有手动存档点。</p>}<DialogFooter><Button variant="ghost" onClick={() => setSnapshotsOpen(false)}>关闭</Button></DialogFooter></DialogContent>
      </Dialog>

      <AlertDialog open={!!snapshotToDelete} onOpenChange={(open) => !open && setSnapshotToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这个存档点？</AlertDialogTitle><AlertDialogDescription>删除后无法恢复，但不会影响当前会话的进度。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (snapshotToDelete) void deleteSnapshot(snapshotToDelete); setSnapshotToDelete(null) }}>删除存档</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}

function AdventureEmpty({ title, description, actionHref, actionLabel }: { title: string; description: string; actionHref: string; actionLabel: string }) {
  return <div className="flex min-h-svh items-center justify-center bg-background p-6"><Empty className="max-w-md rounded-3xl border border-dashed border-border bg-card/50 py-14"><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader><EmptyContent><Button className="rounded-full" render={<Link href={actionHref} />} nativeButton={false}>{actionLabel}</Button></EmptyContent></Empty></div>
}

function MessageBlock({ message, onCorrect }: { message: StoryMessage; onCorrect: () => void }) {
  if (message.role === 'system') return <div className="flex items-center gap-3 py-1"><Separator className="flex-1" /><span className="shrink-0 text-xs text-muted-foreground">{message.content}</span><Separator className="flex-1" /></div>
  if (message.role === 'user') return <div className="flex flex-col items-end gap-1"><div className="max-w-[85%] rounded-3xl rounded-tr-md bg-primary px-4 py-3 text-primary-foreground shadow-sm"><p className="whitespace-pre-wrap leading-relaxed">{message.content}</p></div><span className="pr-2 text-xs text-muted-foreground">{formatTime(message.created_at)}</span></div>

  return <div className="group flex flex-col gap-2"><div className="min-h-12 rounded-3xl rounded-tl-md bg-card p-5 shadow-sm"><p className="whitespace-pre-wrap font-serif text-[15px] leading-loose text-foreground">{message.content || '…'}</p></div><div className="flex items-center gap-1 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><span className="mr-1 flex items-center gap-2 text-xs text-muted-foreground">{message.token_count > 0 && <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">{message.token_count} tokens</Badge>}<span>{formatTime(message.created_at)}</span></span><div className="ml-auto flex items-center gap-0.5"><MetaAction icon={Flag} label="纠正后续剧情" onClick={onCorrect} /><MetaAction icon={Copy} label="复制" onClick={() => { void navigator.clipboard?.writeText(message.content); toast.success('已复制到剪贴板') }} /></div></div></div>
}

function MetaAction({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={onClick} aria-label={label}><Icon className="size-3.5" /></Button>} /><TooltipContent>{label}</TooltipContent></Tooltip>
}
