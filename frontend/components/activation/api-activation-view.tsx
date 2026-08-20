'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, ChevronLeft, CircleCheck, KeyRound, LoaderCircle, PlugZap, Save, Sparkles, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { isAiConfigurationReady, safeActivationReturnTarget } from '@/lib/ai-activation'
import { api, type ModelProvider, type ProviderCatalogItem } from '@/lib/api'
import { discoveredModelIds, emptyProviderForm, isValidProviderId, mergeDiscoveredModels, providerForm, toProviderDraft, type ProviderEditor, type ProviderForm } from '@/lib/provider-config'
import { refreshApiStatus } from '@/lib/api-status'
import { useSession } from '@/components/session-provider'

type Step = 1 | 2 | 3

const featuredProviderIds = ['deepseek', 'openai', 'qwen', 'glm']

function providerName(providerId: string, catalog: ProviderCatalogItem[]) {
  return catalog.find((provider) => provider.provider_id === providerId)?.display_name || '自定义服务'
}

function editorForProvider(providerId: string, providers: ModelProvider[], catalog: ProviderCatalogItem[]): ProviderEditor | null {
  if (providerId === 'custom') return { kind: 'custom', draft: emptyProviderForm() }
  const existing = providers.find((provider) => provider.provider_id === providerId)
  if (existing) return { kind: 'edit', providerId: existing.provider_id, draft: providerForm(existing) }
  const preset = catalog.find((provider) => provider.provider_id === providerId)
  return preset ? { kind: 'preset', draft: providerForm(preset) } : null
}

export function ApiActivationView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, loading: sessionLoading } = useSession()
  const returnTo = safeActivationReturnTarget(searchParams.get('return_to'))
  const [step, setStep] = useState<Step>(1)
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>([])
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [editor, setEditor] = useState<ProviderEditor | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [verified, setVerified] = useState(false)

  const featuredProviders = useMemo(
    () => featuredProviderIds.map((providerId) => catalog.find((provider) => provider.provider_id === providerId)).filter((provider): provider is ProviderCatalogItem => Boolean(provider)),
    [catalog],
  )
  const otherProviders = useMemo(() => catalog.filter((provider) => !featuredProviderIds.includes(provider.provider_id)), [catalog])
  const draft = editor?.draft

  useEffect(() => {
    if (sessionLoading) return
    if (!session.authenticated) {
      router.replace('/login')
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError('')
    void Promise.all([api.getSettings(), api.listProviderCatalog()])
      .then(([settings, providerCatalog]) => {
        if (cancelled) return
        if (isAiConfigurationReady(settings)) {
          router.replace(returnTo || '/')
          return
        }
        const nextCatalog = providerCatalog.items || []
        const nextProviders = settings.providers || []
        setCatalog(nextCatalog)
        setProviders(nextProviders)
        setEditor(editorForProvider('deepseek', nextProviders, nextCatalog))
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '无法读取模型配置')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [loadAttempt, returnTo, router, session.authenticated, sessionLoading])

  const chooseProvider = (providerId: string) => {
    const nextEditor = editorForProvider(providerId, providers, catalog)
    if (!nextEditor) return
    setEditor(nextEditor)
    setVerified(false)
    setStep(2)
  }

  const updateDraft = (patch: Partial<ProviderForm>) => {
    setEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current)
    if ('api_key' in patch || 'base_url' in patch || 'timeout_seconds' in patch) setVerified(false)
  }

  const testConnection = async () => {
    if (!editor) return
    const current = editor.draft
    if (!current.api_key.trim()) {
      toast.error('请先填写 API 密钥')
      return
    }
    if (!current.base_url.trim()) {
      toast.error('请先填写 API 地址')
      return
    }
    if (editor.kind === 'custom' && (!current.display_name.trim() || !isValidProviderId(current.provider_id))) {
      toast.error('请填写显示名称，并使用有效的 Provider ID')
      return
    }
    setTesting(true)
    try {
      const response = await api.previewModels({
        ...(editor.kind === 'edit' ? { provider_id: editor.providerId } : {}),
        base_url: current.base_url.trim(),
        api_key: current.api_key.trim(),
        timeout_seconds: current.timeout_seconds,
      })
      const models = discoveredModelIds(response)
      if (!models.length) {
        setVerified(false)
        toast.error('服务未返回可用模型，无法完成激活')
        return
      }
      const nextModels = mergeDiscoveredModels(current.models, models)
      updateDraft({ models: nextModels, model: models.includes(current.model) ? current.model : models[0] })
      setVerified(true)
      toast.success(`已验证连接，发现 ${models.length} 个模型`)
    } catch (error) {
      setVerified(false)
      toast.error(error instanceof Error ? error.message : '检测连接失败')
    } finally {
      setTesting(false)
    }
  }

  const saveAndActivate = async () => {
    if (!editor || !verified) return
    const current = editor.draft
    if (!current.display_name.trim() || !current.base_url.trim() || !current.model.trim() || !current.api_key.trim()) {
      toast.error('请完成连接信息与默认模型选择')
      return
    }
    if (editor.kind === 'custom' && !isValidProviderId(current.provider_id)) {
      toast.error('Provider ID 必须以小写字母开头，只能包含小写字母、数字和连字符')
      return
    }
    setSaving(true)
    try {
      const payload = toProviderDraft(current)
      if (editor.kind === 'edit') {
        await api.updateProvider(editor.providerId, {
          display_name: payload.display_name,
          base_url: payload.base_url,
          protocol: payload.protocol,
          model: payload.model,
          models: payload.models,
          timeout_seconds: payload.timeout_seconds,
          api_key: payload.api_key,
          activate: true,
        })
      } else {
        await api.createProvider(payload)
      }
      if (session.user) void refreshApiStatus(session.user.id, { force: true })
      setStep(3)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存提供方失败')
    } finally {
      setSaving(false)
    }
  }

  const finish = () => router.replace(returnTo || '/')

  if (sessionLoading || loading) {
    return <div className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在准备连接…</div>
  }

  if (loadError) {
    return <main className="flex min-h-svh items-center justify-center bg-background p-6"><div className="w-full max-w-md border-y border-border py-8"><span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary"><PlugZap className="size-5" /></span><h1 className="mt-5 font-rounded text-2xl font-extrabold">无法读取连接选项</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{loadError}</p><Button className="mt-6" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重新读取</Button><button type="button" className="ml-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={finish}>先去浏览</button></div></main>
  }

  return (
    <main className="min-h-svh bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
        <aside className="flex flex-col lg:min-h-[40rem]">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="size-5" /></span>
            <span className="font-rounded text-lg font-extrabold">织梦</span>
          </div>
          <div className="mt-10 hidden lg:block">
            <p className="font-rounded text-2xl font-extrabold leading-snug">让第一个故事从可靠的连接开始。</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">完成这次激活后，模型设置会独立保存在你的本地账户中。</p>
          </div>
          <ol className="mt-8 grid grid-cols-3 gap-2 lg:mt-12 lg:grid-cols-1 lg:gap-0 lg:border-l lg:border-border">
            {[
              ['01', '选择服务'],
              ['02', '验证连接'],
              ['03', '开始创作'],
            ].map(([number, label], index) => {
              const current = step === index + 1
              const complete = step > index + 1
              return <li key={number} className="relative flex min-w-0 items-center gap-2 lg:-ml-px lg:py-3 lg:pl-5"><span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${current ? 'bg-primary text-primary-foreground' : complete ? 'bg-secondary text-primary' : 'bg-muted text-muted-foreground'}`}>{complete ? <Check className="size-3.5" /> : number}</span><span className={`truncate text-xs font-medium lg:text-sm ${current ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span></li>
            })}
          </ol>
          <button type="button" className="mt-auto hidden w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:block" onClick={finish}>暂不配置，先去浏览</button>
        </aside>

        <section className="min-w-0 lg:border-l lg:border-border lg:pl-16">
          <div className="mb-7 flex items-center justify-between gap-4 sm:mb-9">
            <div><p className="text-xs font-semibold text-primary">API 激活</p><h1 className="mt-1 font-rounded text-2xl font-extrabold sm:text-3xl">{step === 1 ? '选择你的 AI 服务' : step === 2 ? '验证这条连接' : '连接已准备好'}</h1></div>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">{step} / 3</span>
          </div>
          <Progress value={step * 100 / 3} aria-label={`激活进度，第 ${step} 步，共 3 步`} className="mb-8 gap-0" />

          {step === 1 && <ProviderChoice featuredProviders={featuredProviders} otherProviders={otherProviders} onChoose={chooseProvider} />}
          {step === 2 && draft && editor && <ConnectionForm editor={editor} providerLabel={providerName(draft.provider_id, catalog)} verified={verified} testing={testing} saving={saving} onBack={() => { setStep(1); setVerified(false) }} onUpdate={updateDraft} onTest={() => void testConnection()} onSave={() => void saveAndActivate()} />}
          {step === 3 && <ActivationComplete providerName={draft ? providerName(draft.provider_id, catalog) : '当前服务'} onFinish={finish} />}
          <button type="button" className="mt-8 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:hidden" onClick={finish}>暂不配置，先去浏览</button>
        </section>
      </div>
    </main>
  )
}

function ProviderChoice({ featuredProviders, otherProviders, onChoose }: { featuredProviders: ProviderCatalogItem[]; otherProviders: ProviderCatalogItem[]; onChoose: (providerId: string) => void }) {
  return <div>
    <p className="max-w-xl text-sm leading-6 text-muted-foreground">从常用服务开始，或接入任意 OpenAI 兼容接口。稍后仍可在设置中添加和切换更多连接。</p>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {featuredProviders.map((provider) => <button key={provider.provider_id} type="button" onClick={() => onChoose(provider.provider_id)} className="group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/45 hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><PlugZap className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{provider.display_name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{provider.model}</span></span><span className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5">›</span></button>)}
      <button type="button" onClick={() => onChoose('custom')} className="group flex min-h-24 items-start gap-3 rounded-lg border border-dashed border-border bg-transparent p-4 text-left transition-colors hover:border-primary/45 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground"><WandSparkles className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">自定义兼容服务</span><span className="mt-1 block text-xs text-muted-foreground">填写自己的 API 地址与模型</span></span><span className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5">›</span></button>
    </div>
    {otherProviders.length > 0 && <label className="mt-5 block"><span className="mb-2 block text-sm font-medium">其他已内置的服务</span><select defaultValue="" className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" onChange={(event) => { if (event.target.value) onChoose(event.target.value) }}><option value="" disabled>选择其他服务</option>{otherProviders.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.display_name}</option>)}</select></label>}
  </div>
}

function ConnectionForm({ editor, providerLabel, verified, testing, saving, onBack, onUpdate, onTest, onSave }: { editor: ProviderEditor; providerLabel: string; verified: boolean; testing: boolean; saving: boolean; onBack: () => void; onUpdate: (patch: Partial<ProviderForm>) => void; onTest: () => void; onSave: () => void }) {
  const { draft } = editor
  const isCustom = editor.kind === 'custom'
  return <div>
    <div className="flex items-center gap-3 border-y border-border py-4"><span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary"><KeyRound className="size-5" /></span><div className="min-w-0"><p className="text-sm font-semibold">{isCustom ? '自定义 OpenAI 兼容服务' : providerLabel}</p><p className="mt-0.5 text-xs text-muted-foreground">密钥只用于当前账户的模型请求，保存后不会回显。</p></div></div>
    <FieldGroup className="mt-6 gap-5">
      {isCustom && <><Field><FieldLabel htmlFor="activation-provider-name">显示名称</FieldLabel><Input id="activation-provider-name" className="h-11" value={draft.display_name} placeholder="例如：团队模型网关" onChange={(event) => onUpdate({ display_name: event.target.value })} /></Field><Field><FieldLabel htmlFor="activation-provider-id">Provider ID</FieldLabel><Input id="activation-provider-id" className="h-11" value={draft.provider_id} placeholder="team-gateway" onChange={(event) => onUpdate({ provider_id: event.target.value })} /><FieldDescription>使用小写字母、数字和连字符标识这条连接。</FieldDescription></Field></>}
      <Field><FieldLabel htmlFor="activation-api-key">API 密钥</FieldLabel><Input id="activation-api-key" className="h-11" type="password" autoComplete="off" value={draft.api_key} placeholder="输入 API 密钥" onChange={(event) => onUpdate({ api_key: event.target.value })} /></Field>
    </FieldGroup>
    <details className="group mt-6 border-y border-border py-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden"><ChevronDown className="size-4 transition-transform group-open:rotate-180" />连接详情</summary><div className="mt-5 space-y-5"><Field><FieldLabel htmlFor="activation-base-url">API 地址</FieldLabel><Input id="activation-base-url" className="h-11" value={draft.base_url} placeholder="https://gateway.example/v1" onChange={(event) => onUpdate({ base_url: event.target.value })} /></Field><Field><FieldLabel htmlFor="activation-timeout">请求超时（秒）</FieldLabel><Input id="activation-timeout" className="h-11" type="number" min="1" max="300" value={draft.timeout_seconds} onChange={(event) => onUpdate({ timeout_seconds: Math.max(1, Math.min(300, Number(event.target.value) || 60)) })} /></Field></div></details>
    <div className="mt-6 rounded-lg border border-border bg-muted/45 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">检测可用模型</p><p className="mt-1 text-xs leading-5 text-muted-foreground">检测成功后才能完成激活，并会更新默认模型列表。</p></div><Button type="button" variant="outline" size="sm" disabled={testing || saving} onClick={onTest}>{testing ? <LoaderCircle className="animate-spin" /> : <PlugZap />}{testing ? '正在检测' : '检测连接'}</Button></div>{verified && <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"><CircleCheck className="size-4" />连接已验证</p>}</div>
    <Field className="mt-6"><FieldLabel htmlFor="activation-model">默认模型</FieldLabel><select id="activation-model" value={draft.model} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" onChange={(event) => onUpdate({ model: event.target.value })}>{draft.models.length === 0 && <option value="">请先检测连接</option>}{draft.models.map((model) => <option key={model} value={model}>{model}</option>)}</select></Field>
    <Separator className="mt-8" />
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={onBack} disabled={testing || saving}><ChevronLeft />更换服务</Button><Button type="button" onClick={onSave} disabled={!verified || testing || saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? '正在保存' : '保存并完成激活'}</Button></div>
  </div>
}

function ActivationComplete({ providerName, onFinish }: { providerName: string; onFinish: () => void }) {
  return <div className="py-6 sm:py-10"><span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="size-7" /></span><h2 className="mt-6 font-rounded text-2xl font-extrabold">{providerName} 已连接</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">模型已经设为当前故事连接。之后可随时在设置中添加、编辑或切换服务。</p><Button className="mt-8" size="lg" onClick={onFinish}>开始使用<Check data-icon="inline-end" /></Button></div>
}
