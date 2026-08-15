'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ChevronDown, KeyRound, LoaderCircle, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { api, type ModelProvider, type ProviderCatalogItem, type ProviderDraft, type Settings } from '@/lib/api'
import { useSession } from '@/components/session-provider'

const defaultGeneration = { temperature: 0.8, maxTokens: 4096, contextWindowTokens: 32768, compressionTriggerRatio: 0.75 }

type ProviderForm = {
  provider_id: string
  display_name: string
  base_url: string
  protocol: 'openai-completions'
  model: string
  models: string[]
  timeout_seconds: number
  api_key: string
}

type ProviderEditor =
  | { kind: 'preset'; draft: ProviderForm }
  | { kind: 'custom'; draft: ProviderForm }
  | { kind: 'edit'; providerId: string; draft: ProviderForm }

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function firstSliderValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] || 0 : value
}

function providerForm(provider: ModelProvider | ProviderCatalogItem): ProviderForm {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    base_url: provider.base_url,
    protocol: 'openai-completions',
    model: provider.model,
    models: 'models' in provider ? provider.models : [],
    timeout_seconds: 'timeout_seconds' in provider ? provider.timeout_seconds : 60,
    api_key: '',
  }
}

function emptyProviderForm(): ProviderForm {
  return { provider_id: '', display_name: '', base_url: '', protocol: 'openai-completions', model: '', models: [], timeout_seconds: 60, api_key: '' }
}

function discoveredModelIds(result: { models?: string[]; items?: Array<string | { id?: string }> }) {
  if (Array.isArray(result.models)) return result.models.filter(Boolean)
  return Array.isArray(result.items)
    ? result.items.map((item) => typeof item === 'string' ? item : item.id || '').filter(Boolean)
    : []
}

export function SettingsView() {
  const { session } = useSession()
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>([])
  const [editor, setEditor] = useState<ProviderEditor | null>(null)
  const [modelDraft, setModelDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingProvider, setSavingProvider] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null)
  const [savingGeneration, setSavingGeneration] = useState(false)
  const [temperature, setTemperature] = useState(defaultGeneration.temperature)
  const [maxTokens, setMaxTokens] = useState(defaultGeneration.maxTokens)
  const [contextWindowTokens, setContextWindowTokens] = useState(defaultGeneration.contextWindowTokens)
  const [compressionTriggerRatio, setCompressionTriggerRatio] = useState(defaultGeneration.compressionTriggerRatio)

  const addablePresets = useMemo(() => {
    const existing = new Set(providers.map((provider) => provider.provider_id))
    return catalog.filter((provider) => !existing.has(provider.provider_id))
  }, [catalog, providers])

  const applySettings = (settings: Settings) => {
    const generation = settings.generation || {}
    setProviders(settings.providers || [])
    setTemperature(generation.temperature ?? defaultGeneration.temperature)
    setMaxTokens(generation.max_tokens ?? defaultGeneration.maxTokens)
    setContextWindowTokens(generation.context_window_tokens ?? defaultGeneration.contextWindowTokens)
    setCompressionTriggerRatio(generation.compression_trigger_ratio ?? defaultGeneration.compressionTriggerRatio)
  }

  const load = async () => {
    setLoading(true)
    try {
      const [settings, providerCatalog] = await Promise.all([api.getSettings(), api.listProviderCatalog()])
      applySettings(settings)
      setCatalog(providerCatalog.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法读取设置')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!session.authenticated) {
      setLoading(false)
      return
    }
    void load()
  }, [session.authenticated])

  const updateEditor = (patch: Partial<ProviderForm>) => {
    setEditor((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current)
  }

  const selectPreset = (providerId: string) => {
    const preset = catalog.find((provider) => provider.provider_id === providerId)
    if (!preset) return
    setModelDraft('')
    setEditor({ kind: 'preset', draft: providerForm(preset) })
  }

  const addModel = () => {
    const value = modelDraft.trim()
    if (!value || !editor || editor.draft.models.includes(value)) return
    updateEditor({ models: [...editor.draft.models, value] })
    setModelDraft('')
  }

  const fetchModels = async () => {
    if (!editor) return
    if (!editor.draft.base_url.trim()) {
      toast.error('请先填写 API 地址')
      return
    }
    setTestingProvider(true)
    try {
      const response = await api.previewModels({
        ...(editor.kind === 'edit' ? { provider_id: editor.providerId } : {}),
        base_url: editor.draft.base_url.trim(),
        ...(editor.draft.api_key.trim() ? { api_key: editor.draft.api_key.trim() } : {}),
        timeout_seconds: editor.draft.timeout_seconds,
      })
      const models = discoveredModelIds(response)
      if (!models.length) {
        toast.message('服务未返回可用模型，请手动添加模型 ID')
        return
      }
      updateEditor({ models: [...new Set([...editor.draft.models, ...models])], model: editor.draft.model || models[0] })
      toast.success(`已添加 ${models.length} 个模型`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取模型失败')
    } finally {
      setTestingProvider(false)
    }
  }

  const saveProvider = async () => {
    if (!editor) return
    const draft = editor.draft
    if (!draft.display_name.trim() || !draft.base_url.trim() || !draft.model.trim()) {
      toast.error('请填写显示名称、API 地址和默认模型')
      return
    }
    if (editor.kind === 'custom' && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(draft.provider_id)) {
      toast.error('Provider ID 必须以小写字母开头，只能包含小写字母、数字和连字符')
      return
    }
    setSavingProvider(true)
    try {
      const payload: ProviderDraft = {
        provider_id: draft.provider_id.trim(), display_name: draft.display_name.trim(), base_url: draft.base_url.trim(),
        protocol: 'openai-completions', model: draft.model.trim(), models: draft.models, timeout_seconds: draft.timeout_seconds,
        ...(draft.api_key.trim() ? { api_key: draft.api_key.trim() } : {}),
      }
      if (editor.kind === 'edit') {
        await api.updateProvider(editor.providerId, {
          display_name: payload.display_name, base_url: payload.base_url, protocol: payload.protocol, model: payload.model,
          models: payload.models, timeout_seconds: payload.timeout_seconds, activate: true,
          ...(payload.api_key ? { api_key: payload.api_key } : {}),
        })
      } else {
        await api.createProvider(payload)
      }
      await load()
      setEditor(null)
      setModelDraft('')
      toast.success('提供方已保存并设为当前连接')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存提供方失败')
    } finally {
      setSavingProvider(false)
    }
  }

  const activateProvider = async (providerId: string) => {
    try {
      await api.activateProvider(providerId)
      const result = await api.listProviders()
      setProviders(result.items || [])
      toast.success('已切换当前模型连接')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换连接失败')
    }
  }

  const deleteProvider = async (provider: ModelProvider) => {
    if (!window.confirm(`删除“${provider.display_name}”会移除其配置和已保存的 API 密钥，是否继续？`)) return
    setDeletingProvider(provider.provider_id)
    try {
      await api.deleteProvider(provider.provider_id)
      const result = await api.listProviders()
      setProviders(result.items || [])
      if (editor?.kind === 'edit' && editor.providerId === provider.provider_id) setEditor(null)
      toast.success('提供方已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除提供方失败')
    } finally {
      setDeletingProvider(null)
    }
  }

  const saveGeneration = async () => {
    setSavingGeneration(true)
    try {
      await api.saveSettings({ generation: { temperature, max_tokens: maxTokens, context_window_tokens: contextWindowTokens, compression_trigger_ratio: compressionTriggerRatio } })
      toast.success('生成参数已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存生成参数失败')
    } finally {
      setSavingGeneration(false)
    }
  }

  if (!session.authenticated) {
    return <div className="mx-auto max-w-2xl px-4 py-10"><Empty className="rounded-xl border border-dashed border-border bg-card/50 py-14"><EmptyHeader><EmptyMedia variant="icon"><KeyRound /></EmptyMedia><EmptyTitle>登录后配置模型</EmptyTitle><EmptyDescription>API Key 和生成参数按账户独立保存。</EmptyDescription></EmptyHeader><EmptyContent><Button render={<Link href="/login" />} nativeButton={false}>前往登录</Button></EmptyContent></Empty></div>
  }
  if (loading) return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取设置…</div>

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <header className="mb-7"><h1 className="font-serif text-2xl font-bold text-foreground md:text-3xl">设置</h1><p className="mt-1 text-sm text-muted-foreground">配置当前账户的 AI 连接与故事生成参数。</p></header>
      <section aria-labelledby="providers-title">
        <div className="mb-4"><h2 id="providers-title" className="text-lg font-semibold">模型</h2><p className="mt-1 text-sm text-muted-foreground">填入各提供方的 API 密钥即可使用其模型。</p></div>
        <div className="space-y-3">
          {providers.map((provider) => {
            const isEditing = editor?.kind === 'edit' && editor.providerId === provider.provider_id
            return <div key={provider.provider_id} className="rounded-2xl border border-border bg-card px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-base font-medium">{provider.display_name}</span><span className={`size-2.5 rounded-full ${provider.api_key_set && !provider.api_key_unreadable ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} title={provider.api_key_set ? '已配置 API 密钥' : '尚未配置 API 密钥'} aria-label={provider.api_key_set ? '已配置 API 密钥' : '尚未配置 API 密钥'} />{provider.is_active && <Badge variant="secondary" className="rounded-md">当前</Badge>}{provider.is_custom && <Badge variant="outline" className="rounded-md">自定义</Badge>}</div><p className="mt-1 truncate text-xs text-muted-foreground">{provider.model}</p></div>
                <div className="flex shrink-0 items-center gap-1.5">{!provider.is_active && <Button variant="ghost" size="sm" onClick={() => void activateProvider(provider.provider_id)}>使用</Button>}<Button variant="outline" size="sm" onClick={() => { setModelDraft(''); setEditor({ kind: 'edit', providerId: provider.provider_id, draft: providerForm(provider) }) }}>编辑</Button>{provider.removable && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title="删除提供方" aria-label="删除提供方" disabled={deletingProvider === provider.provider_id} onClick={() => void deleteProvider(provider)}>{deletingProvider === provider.provider_id ? <LoaderCircle className="animate-spin" /> : <Trash2 />}</Button>}</div>
              </div>
              {isEditing && <ProviderEditorForm editor={editor} catalog={catalog} modelDraft={modelDraft} saving={savingProvider} testing={testingProvider} onChoosePreset={selectPreset} onUpdate={updateEditor} onModelDraft={setModelDraft} onAddModel={addModel} onRemoveModel={(model) => updateEditor({ models: editor.draft.models.filter((item) => item !== model) })} onFetch={() => void fetchModels()} onCancel={() => { setEditor(null); setModelDraft('') }} onSave={() => void saveProvider()} />}
            </div>
          })}
        </div>
        {!editor && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Button variant="outline" className="h-12 rounded-xl border-dashed" disabled={!addablePresets.length} onClick={() => { const first = addablePresets[0]; if (first) { setModelDraft(''); setEditor({ kind: 'preset', draft: providerForm(first) }) } }}><Plus />添加提供方</Button><Button variant="outline" className="h-12 rounded-xl border-dashed" onClick={() => { setModelDraft(''); setEditor({ kind: 'custom', draft: emptyProviderForm() }) }}><Plus />添加自定义提供方</Button></div>}
        {editor && editor.kind !== 'edit' && <div className="mt-3 rounded-2xl bg-muted/65 p-5 sm:p-6"><ProviderEditorForm editor={editor} catalog={addablePresets} modelDraft={modelDraft} saving={savingProvider} testing={testingProvider} onChoosePreset={selectPreset} onUpdate={updateEditor} onModelDraft={setModelDraft} onAddModel={addModel} onRemoveModel={(model) => updateEditor({ models: editor.draft.models.filter((item) => item !== model) })} onFetch={() => void fetchModels()} onCancel={() => { setEditor(null); setModelDraft('') }} onSave={() => void saveProvider()} /></div>}
      </section>
      <Card className="mt-8 rounded-xl"><CardHeader><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><SlidersHorizontal className="size-4.5" /></span><div><CardTitle>生成参数</CardTitle><CardDescription>控制故事回复的长度和上下文压缩；推理等级在对话输入框中按会话设置。</CardDescription></div></div></CardHeader><CardContent><FieldGroup>
        <Field><div className="flex items-center justify-between"><FieldLabel>温度</FieldLabel><span className="font-mono text-sm text-muted-foreground">{temperature.toFixed(1)}</span></div><Slider value={[temperature]} onValueChange={(value) => setTemperature(firstSliderValue(value))} min={0} max={2} step={0.1} /><FieldDescription>数值越高，剧情越发散；越低越稳定。</FieldDescription></Field>
        <Field><FieldLabel htmlFor="max-tokens">最大回复长度</FieldLabel><Input id="max-tokens" type="number" min="1" max="32768" step="256" value={maxTokens} onChange={(event) => setMaxTokens(clamp(Number(event.target.value) || defaultGeneration.maxTokens, 1, 32768))} /></Field>
        <Field><FieldLabel htmlFor="context-window">上下文窗口</FieldLabel><Input id="context-window" type="number" min="2048" max="131072" step="1024" value={contextWindowTokens} onChange={(event) => setContextWindowTokens(clamp(Number(event.target.value) || defaultGeneration.contextWindowTokens, 2048, 131072))} /></Field>
        <Field><div className="flex items-center justify-between"><FieldLabel>压缩触发比例</FieldLabel><span className="font-mono text-sm text-muted-foreground">{compressionTriggerRatio.toFixed(2)}</span></div><Slider value={[compressionTriggerRatio]} onValueChange={(value) => setCompressionTriggerRatio(firstSliderValue(value))} min={0.5} max={0.95} step={0.01} /></Field>
      </FieldGroup></CardContent></Card>
      <Alert className="mt-5 rounded-lg"><KeyRound className="size-4" /><AlertTitle>密钥安全</AlertTitle><AlertDescription>密钥只会用于当前账户的模型请求，已保存的完整值不会返回到页面。</AlertDescription></Alert>
      <div className="mt-6 flex justify-end"><Button onClick={() => void saveGeneration()} disabled={savingGeneration}><Save data-icon="inline-start" />{savingGeneration ? '正在保存…' : '保存生成参数'}</Button></div>
    </div>
  )
}

function ProviderEditorForm(props: {
  editor: ProviderEditor
  catalog: ProviderCatalogItem[]
  modelDraft: string
  saving: boolean
  testing: boolean
  onChoosePreset: (providerId: string) => void
  onUpdate: (patch: Partial<ProviderForm>) => void
  onModelDraft: (value: string) => void
  onAddModel: () => void
  onRemoveModel: (model: string) => void
  onFetch: () => void
  onCancel: () => void
  onSave: () => void
}) {
  const { editor, catalog, modelDraft, saving, testing, onChoosePreset, onUpdate, onModelDraft, onAddModel, onRemoveModel, onFetch, onCancel, onSave } = props
  const { draft } = editor
  const custom = editor.kind === 'custom'
  const editing = editor.kind === 'edit'
  const title = custom ? '自定义提供方' : editing ? `${draft.display_name} 设置` : '添加提供方'
  return <div className={editing ? 'mt-5 border-t border-border pt-5' : ''}>
    <div className="mb-5 flex items-center gap-2"><h3 className="text-base font-medium">{title}</h3>{custom && <Badge variant="outline" className="rounded-md">自定义</Badge>}</div>
    <FieldGroup className="gap-4">
      {!editing && !custom && <Field><FieldLabel htmlFor="provider-preset">提供方</FieldLabel><select id="provider-preset" value={draft.provider_id} onChange={(event) => onChoosePreset(event.target.value)} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">{catalog.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.display_name}</option>)}</select></Field>}
      {custom && <Field><FieldLabel htmlFor="provider-id">Provider ID</FieldLabel><Input id="provider-id" value={draft.provider_id} placeholder="acme-gateway" onChange={(event) => onUpdate({ provider_id: event.target.value })} /><FieldDescription>以小写字母开头，用于标识这个提供方。</FieldDescription></Field>}
      <Field><FieldLabel htmlFor="provider-name">显示名称</FieldLabel><Input id="provider-name" value={draft.display_name} placeholder="显示名称" onChange={(event) => onUpdate({ display_name: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor="provider-key">API 密钥</FieldLabel><Input id="provider-key" type="password" value={draft.api_key} placeholder={editing ? '已保存，留空则保持不变' : '输入 API 密钥'} autoComplete="off" onChange={(event) => onUpdate({ api_key: event.target.value })} /><FieldDescription>{editing ? '已保存的密钥不会回显。' : '留空时可在保存后再补充密钥。'}</FieldDescription></Field>
    </FieldGroup>
    <details open className="group mt-5 border-t border-border pt-4"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden"><ChevronDown className="size-4 transition-transform group-open:rotate-180" />自定义设置</summary><div className="mt-4 space-y-4">
      <Field><FieldLabel htmlFor="provider-url">API 地址</FieldLabel><Input id="provider-url" value={draft.base_url} placeholder="https://gateway.example/v1" onChange={(event) => onUpdate({ base_url: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor="provider-protocol">API 协议</FieldLabel><select id="provider-protocol" value="openai-completions" disabled className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-100"><option value="openai-completions">openai-completions</option></select></Field>
      <Field><FieldLabel htmlFor="provider-model">默认模型</FieldLabel><Input id="provider-model" value={draft.model} placeholder="模型 ID" list="provider-models" onChange={(event) => onUpdate({ model: event.target.value })} /><datalist id="provider-models">{draft.models.map((model) => <option key={model} value={model} />)}</datalist></Field>
      <div className="border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">模型目录</p><p className="mt-0.5 text-xs text-muted-foreground">可查询接口或手动补充模型 ID。</p></div><Button variant="ghost" size="sm" disabled={testing} onClick={onFetch}>{testing ? <LoaderCircle className="animate-spin" /> : <Check />}{testing ? '正在获取' : '获取可用模型'}</Button></div>{draft.models.length ? <div className="mt-3 flex flex-wrap gap-2">{draft.models.map((model) => <Badge key={model} variant="secondary" className="gap-1 rounded-md pr-1"><span className="max-w-42 truncate">{model}</span><button type="button" className="rounded p-0.5 hover:bg-background" aria-label={`删除模型 ${model}`} onClick={() => onRemoveModel(model)}>×</button></Badge>)}</div> : <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">模型选择器中将不显示任何模型，仍可直接填写模型 ID。</p>}<div className="mt-3 flex gap-2"><Input value={modelDraft} placeholder="添加模型 ID" onChange={(event) => onModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAddModel() } }} /><Button type="button" variant="outline" size="icon" title="添加模型" aria-label="添加模型" onClick={onAddModel}><Plus /></Button></div></div>
      <Field><FieldLabel htmlFor="provider-timeout">请求超时（秒）</FieldLabel><Input id="provider-timeout" type="number" min="1" max="300" value={draft.timeout_seconds} onChange={(event) => onUpdate({ timeout_seconds: clamp(Number(event.target.value) || 60, 1, 300) })} /></Field>
    </div></details>
    <div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>取消</Button><Button onClick={onSave} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? '正在保存…' : custom ? '创建提供方' : '保存'}</Button></div>
  </div>
}
