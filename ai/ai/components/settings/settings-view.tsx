'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { KeyRound, SlidersHorizontal, Check, LoaderCircle, Save, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { api, type Settings } from '@/lib/api'
import { useSession } from '@/components/session-provider'

const defaultGeneration = {
  temperature: 0.8,
  maxTokens: 4096,
  reasoningEffort: 'high',
  contextWindowTokens: 32768,
  compressionTriggerRatio: 0.75,
}

function firstSliderValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] || 0 : value
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

type SettingSetters = {
  setBaseUrl: (value: string) => void
  setModel: (value: string) => void
  setKeyConfigured: (value: boolean) => void
  setTimeoutValue: (value: number) => void
  setTemperature: (value: number) => void
  setMaxTokens: (value: number) => void
  setReasoningEffort: (value: string) => void
  setContextWindowTokens: (value: number) => void
  setCompressionTriggerRatio: (value: number) => void
}

export function SettingsView() {
  const { session } = useSession()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [timeout, setTimeoutValue] = useState(60)
  const [temperature, setTemperature] = useState(defaultGeneration.temperature)
  const [maxTokens, setMaxTokens] = useState(defaultGeneration.maxTokens)
  const [reasoningEffort, setReasoningEffort] = useState(defaultGeneration.reasoningEffort)
  const [contextWindowTokens, setContextWindowTokens] = useState(defaultGeneration.contextWindowTokens)
  const [compressionTriggerRatio, setCompressionTriggerRatio] = useState(defaultGeneration.compressionTriggerRatio)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[]>([])

  const setters: SettingSetters = {
    setBaseUrl,
    setModel,
    setKeyConfigured,
    setTimeoutValue,
    setTemperature,
    setMaxTokens,
    setReasoningEffort,
    setContextWindowTokens,
    setCompressionTriggerRatio,
  }

  useEffect(() => {
    if (!session.authenticated) {
      setLoading(false)
      return
    }
    void (async () => {
      setLoading(true)
      try {
        applySettings(await api.getSettings(), setters)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '无法读取设置')
      } finally {
        setLoading(false)
      }
    })()
  }, [session.authenticated])

  const save = async () => {
    setSaving(true)
    try {
      const payload: Settings = {
        deepseek: {
          base_url: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
          timeout_seconds: timeout,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        },
        generation: {
          temperature,
          max_tokens: maxTokens,
          reasoning_effort: reasoningEffort,
          context_window_tokens: contextWindowTokens,
          compression_trigger_ratio: compressionTriggerRatio,
        },
      }
      const saved = await api.saveSettings(payload)
      setApiKey('')
      applySettings(saved, setters)
      toast.success('设置已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存设置失败')
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const result = await api.previewModels({
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
        timeout_seconds: timeout,
      })
      const discovered = Array.isArray(result.models)
        ? result.models
        : Array.isArray(result.items)
          ? result.items.map((item) => typeof item === 'string' ? item : item.id || '').filter(Boolean)
          : []
      setModels(discovered)
      toast.success(discovered.length ? `已发现 ${discovered.length} 个模型` : '连接测试成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '连接测试失败')
    } finally {
      setTesting(false)
    }
  }

  if (!session.authenticated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Empty className="rounded-3xl border border-dashed border-border bg-card/50 py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon"><KeyRound /></EmptyMedia>
            <EmptyTitle>登录后配置模型</EmptyTitle>
            <EmptyDescription>API Key 和生成参数按账户独立保存。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="rounded-full" render={<Link href="/login" />} nativeButton={false}>前往登录</Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取设置…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <header className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-foreground md:text-3xl">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">配置当前账户的 AI 连接与故事生成参数。</p>
      </header>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ServerCog className="size-4.5" /></span>
              <div>
                <CardTitle>模型连接</CardTitle>
                <CardDescription>兼容 OpenAI 风格接口的模型服务。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="base-url">服务地址</FieldLabel>
                <Input id="base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="api-key">API Key</FieldLabel>
                <Input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={keyConfigured ? '已保存，留空则保持不变' : '输入 API Key'} autoComplete="off" />
                <FieldDescription>{keyConfigured ? '已保存的密钥不会回显；如不修改，请保持为空。' : '密钥会加密保存在本地账户中。'}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="model">默认模型</FieldLabel>
                <Input id="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" list="model-list" />
                <datalist id="model-list">{models.map((item) => <option key={item} value={item} />)}</datalist>
              </Field>
              <Field>
                <FieldLabel htmlFor="timeout">请求超时（秒）</FieldLabel>
                <Input id="timeout" type="number" min="1" max="300" value={timeout} onChange={(event) => setTimeoutValue(clamp(Number(event.target.value) || 60, 1, 300))} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" className="rounded-full" onClick={() => void testConnection()} disabled={testing}>{testing ? <LoaderCircle className="animate-spin" /> : <Check />}测试连接</Button>
                {models.length > 0 && <Badge variant="secondary" className="rounded-full">发现 {models.length} 个模型</Badge>}
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><SlidersHorizontal className="size-4.5" /></span>
              <div>
                <CardTitle>生成参数</CardTitle>
                <CardDescription>控制故事回复的长度、推理和上下文压缩。</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <div className="flex items-center justify-between"><FieldLabel>温度</FieldLabel><span className="font-mono text-sm text-muted-foreground">{temperature.toFixed(1)}</span></div>
                <Slider value={[temperature]} onValueChange={(value) => setTemperature(firstSliderValue(value))} min={0} max={2} step={0.1} />
                <FieldDescription>数值越高，剧情越发散；越低越稳定。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="max-tokens">最大回复长度</FieldLabel>
                <Input id="max-tokens" type="number" min="1" max="32768" step="256" value={maxTokens} onChange={(event) => setMaxTokens(clamp(Number(event.target.value) || defaultGeneration.maxTokens, 1, 32768))} />
                <FieldDescription>默认 4096 tokens。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="reasoning-effort">推理强度</FieldLabel>
                <select id="reasoning-effort" value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} className="h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm">
                  <option value="off">关闭</option>
                  <option value="high">高</option>
                  <option value="max">最大</option>
                </select>
                <FieldDescription>高强度推理会增加模型思考深度和回复耗时。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="context-window">上下文窗口</FieldLabel>
                <Input id="context-window" type="number" min="2048" max="131072" step="1024" value={contextWindowTokens} onChange={(event) => setContextWindowTokens(clamp(Number(event.target.value) || defaultGeneration.contextWindowTokens, 2048, 131072))} />
                <FieldDescription>默认 32768 tokens，包含当前提示词和生成预算。</FieldDescription>
              </Field>
              <Field>
                <div className="flex items-center justify-between"><FieldLabel>压缩触发比例</FieldLabel><span className="font-mono text-sm text-muted-foreground">{compressionTriggerRatio.toFixed(2)}</span></div>
                <Slider value={[compressionTriggerRatio]} onValueChange={(value) => setCompressionTriggerRatio(firstSliderValue(value))} min={0.5} max={0.95} step={0.01} />
                <FieldDescription>默认 0.75；接近上下文窗口上限时，系统会压缩较早剧情。</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Alert>
          <KeyRound className="size-4" />
          <AlertTitle>密钥安全</AlertTitle>
          <AlertDescription>密钥只会用于当前账户的模型请求，界面不会读取或展示已保存的完整值。</AlertDescription>
        </Alert>

        <div className="flex justify-end">
          <Button className="rounded-full" onClick={() => void save()} disabled={saving}><Save data-icon="inline-start" />{saving ? '正在保存…' : '保存设置'}</Button>
        </div>
      </div>
    </div>
  )
}

function applySettings(settings: Settings, setters: SettingSetters) {
  const generation = settings.generation || {}
  setters.setBaseUrl(settings.deepseek?.base_url || '')
  setters.setModel(settings.deepseek?.model || '')
  setters.setKeyConfigured(Boolean(settings.api_key_set))
  setters.setTimeoutValue(settings.deepseek?.timeout_seconds || 60)
  setters.setTemperature(generation.temperature ?? defaultGeneration.temperature)
  setters.setMaxTokens(generation.max_tokens ?? defaultGeneration.maxTokens)
  setters.setReasoningEffort(generation.reasoning_effort || defaultGeneration.reasoningEffort)
  setters.setContextWindowTokens(generation.context_window_tokens ?? defaultGeneration.contextWindowTokens)
  setters.setCompressionTriggerRatio(generation.compression_trigger_ratio ?? defaultGeneration.compressionTriggerRatio)
}
