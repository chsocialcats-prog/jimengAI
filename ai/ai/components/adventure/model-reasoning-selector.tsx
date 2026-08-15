'use client'

import { useMemo, useState } from 'react'
import { Bot, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, type ModelProvider } from '@/lib/api'
import { reasoningEffortPresets, type ReasoningEffortKey } from '@/lib/reasoning-effort'

type SelectorPanel = 'menu' | 'model' | 'reasoning'

type ModelOption = {
  provider: ModelProvider
  model: string
}

function providerModels(provider: ModelProvider): ModelOption[] {
  return [...new Set([provider.model, ...provider.models].filter((model): model is string => Boolean(model?.trim())))]
    .map((model) => ({ provider, model }))
}

export function ModelReasoningSelector({
  providers,
  providersLoading,
  reasoningEffort,
  disabled,
  onReasoningEffortChange,
  onProvidersRefresh,
}: {
  providers: ModelProvider[]
  providersLoading: boolean
  reasoningEffort: ReasoningEffortKey
  disabled?: boolean
  onReasoningEffortChange: (effort: ReasoningEffortKey) => void
  onProvidersRefresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<SelectorPanel>('menu')
  const [savingModel, setSavingModel] = useState(false)
  const activeProvider = providers.find((provider) => provider.is_active) || providers[0]
  const modelOptions = useMemo(
    () => providers.filter((provider) => provider.api_key_set && !provider.api_key_unreadable).flatMap(providerModels),
    [providers],
  )
  const reasoningSupported = activeProvider?.provider_id === 'deepseek'
  const currentModel = activeProvider?.model || '未配置模型'
  const currentReasoning = reasoningSupported ? reasoningEffortPresets[reasoningEffort].label : '不支持'
  const triggerLabel = `${currentModel} · ${currentReasoning}`

  const close = () => {
    setOpen(false)
    setPanel('menu')
  }

  const selectModel = async (option: ModelOption) => {
    if (savingModel) return
    setSavingModel(true)
    try {
      await api.updateProvider(option.provider.provider_id, { model: option.model, activate: true })
      await onProvidersRefresh()
      toast.success(`已切换到 ${option.model}`)
      close()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换模型失败')
    } finally {
      setSavingModel(false)
    }
  }

  const selectReasoning = (effort: ReasoningEffortKey) => {
    onReasoningEffortChange(effort)
    close()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setPanel('menu')
      }}
    >
      <PopoverTrigger
        aria-label={`选择模型和推理等级，当前为 ${triggerLabel}`}
        disabled={disabled || providersLoading}
        className="flex h-7 min-w-0 max-w-[min(13rem,38vw)] items-center gap-1 rounded-full border border-border/80 bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:h-8 sm:max-w-60 sm:px-2.5"
      >
        {providersLoading ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : <Bot className="size-3.5 shrink-0" />}
        <span className="truncate font-medium text-foreground">{triggerLabel}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 gap-1.5 rounded-2xl p-1.5">
        {panel === 'menu' && <div className="space-y-0.5">
          <SelectorRow icon={<Bot />} label="模型" value={currentModel} onClick={() => setPanel('model')} />
          <SelectorRow icon={<Brain />} label="推理等级" value={currentReasoning} disabled={!reasoningSupported} onClick={() => setPanel('reasoning')} />
          {!reasoningSupported && <p className="px-3 pb-2 pt-1 text-xs leading-5 text-muted-foreground">当前提供方不支持 DeepSeek 推理等级。</p>}
        </div>}
        {panel === 'model' && <div className="space-y-1">
          <PanelHeader title="选择模型" onBack={() => setPanel('menu')} />
          <div className="max-h-72 overflow-y-auto px-1 pb-1">
            {modelOptions.length ? modelOptions.map((option) => {
              const selected = option.provider.provider_id === activeProvider?.provider_id && option.model === activeProvider.model
              return <button key={`${option.provider.provider_id}:${option.model}`} type="button" disabled={savingModel} onClick={() => void selectModel(option)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Bot className="size-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{option.model}</span><span className="block truncate text-xs text-muted-foreground">{option.provider.display_name}</span></span>
                {savingModel && selected ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" /> : selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
              </button>
            }) : <p className="px-2 py-5 text-center text-sm text-muted-foreground">请先在设置中配置可用模型。</p>}
          </div>
        </div>}
        {panel === 'reasoning' && <div className="space-y-1">
          <PanelHeader title="推理等级" onBack={() => setPanel('menu')} />
          <div className="space-y-0.5 px-1 pb-1">
            {(Object.keys(reasoningEffortPresets) as ReasoningEffortKey[]).map((effort) => {
              const selected = effort === reasoningEffort
              return <button key={effort} type="button" onClick={() => selectReasoning(effort)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Brain className="size-3.5" /></span>
                <span className="flex-1 text-sm font-medium">{reasoningEffortPresets[effort].label}</span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            })}
          </div>
        </div>}
      </PopoverContent>
    </Popover>
  )
}

function SelectorRow({
  icon,
  label,
  value,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  disabled?: boolean
  onClick: () => void
}) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
    <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
    <span className="flex-1 text-sm">{label}</span>
    <span className="max-w-32 truncate text-sm text-muted-foreground">{value}</span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
  </button>
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <div className="flex h-8 items-center gap-1 px-1"><button type="button" aria-label="返回" onClick={onBack} className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ChevronLeft className="size-4" /></button><span className="text-sm font-medium">{title}</span></div>
}
