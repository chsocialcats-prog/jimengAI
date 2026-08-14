'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Sparkles, UserRound } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { api, type OnboardingField, type Work } from '@/lib/api'
import { useSession } from '@/components/session-provider'
import { workCover } from '@/components/library/work-card'

function initialValues(fields: OnboardingField[]) {
  return fields.reduce<Record<string, string>>((values, field) => {
    values[field.key] = field.default || ''
    return values
  }, {})
}

export function StartAdventureDialog({
  work,
  open,
  onOpenChange,
}: {
  work: Work | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { session } = useSession()
  const fields = useMemo(() => (
    work?.onboarding?.enabled ? work.onboarding.fields || [] : []
  ), [work])
  const allowFreeform = Boolean(work?.onboarding?.enabled && work.onboarding?.allow_freeform)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setStep('form')
    setValues(initialValues(fields))
    setErrors({})
  }, [fields, open])

  const close = () => onOpenChange(false)

  const setValue = (key: string, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: false }))
  }

  const validate = () => {
    const next: Record<string, boolean> = {}
    fields.forEach((field) => {
      if (field.required && !values[field.key]?.trim()) next[field.key] = true
    })
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const goConfirm = () => {
    if (!validate()) {
      toast.error('请先填写必填项')
      return
    }
    setStep('confirm')
  }

  const createAdventure = async () => {
    if (!work) return
    if (!session.authenticated) {
      toast.info('请先登录，再创建自己的冒险存档。')
      close()
      router.push('/login')
      return
    }
    setCreating(true)
    try {
      const conversation = await api.createConversation(work.id, work.title)
      await api.completeOnboarding(conversation.id, values)
      toast.success('新存档已创建')
      close()
      router.push(`/adventure?conversation=${conversation.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法创建存档')
    } finally {
      setCreating(false)
    }
  }

  if (!work) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <div className="relative h-32 w-full shrink-0 overflow-hidden">
          <img src={workCover(work)} alt="" className="size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          <div className="absolute bottom-3 left-5 right-5">
            <Badge variant="secondary" className="mb-1 rounded-full">开始新冒险</Badge>
            <p className="font-serif text-lg font-semibold text-foreground text-balance">{work.title}</p>
          </div>
        </div>

        <div className="flex max-h-[calc(90vh-8rem)] flex-col overflow-y-auto px-5 pb-5 pt-4">
          {step === 'form' ? (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <UserRound className="size-4 text-primary" />
                  {fields.length ? '设定你的身份' : '准备开始'}
                </DialogTitle>
                <DialogDescription className="leading-relaxed">
                  {work.onboarding?.intro || (fields.length ? '填写设定后，将创建一个独立的冒险存档。' : '将为你创建一个独立的冒险存档。')}
                </DialogDescription>
              </DialogHeader>

              {fields.length > 0 && (
                <FieldGroup className="mt-4">
                  {fields.map((field) => (
                    <Field key={field.key} data-invalid={errors[field.key] || undefined}>
                      <FieldLabel htmlFor={`onboarding-${field.key}`}>
                        {field.label}
                        {field.required && <span className="ml-1 text-primary">*</span>}
                      </FieldLabel>

                      {field.type === 'textarea' ? (
                        <Textarea
                          id={`onboarding-${field.key}`}
                          value={values[field.key] || ''}
                          placeholder={field.placeholder}
                          rows={3}
                          aria-invalid={errors[field.key] || undefined}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        />
                      ) : field.type === 'select' ? (
                        <Select value={values[field.key] || ''} onValueChange={(value) => { if (value) setValue(field.key, value) }}>
                          <SelectTrigger id={`onboarding-${field.key}`} aria-invalid={errors[field.key] || undefined}>
                            <SelectValue placeholder="请选择" />
                          </SelectTrigger>
                          <SelectContent>
                            {(field.options || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`onboarding-${field.key}`}
                          value={values[field.key] || ''}
                          placeholder={field.placeholder}
                          aria-invalid={errors[field.key] || undefined}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        />
                      )}
                      {errors[field.key] ? <FieldError>此项为必填</FieldError> : null}
                    </Field>
                  ))}
                </FieldGroup>
              )}

              {allowFreeform && (
                <Field className="mt-4">
                  <FieldLabel htmlFor="onboarding-freeform">补充设定</FieldLabel>
                  <Textarea
                    id="onboarding-freeform"
                    value={values.freeform || ''}
                    placeholder="可补充希望保留的背景、关系或叙事偏好。"
                    rows={3}
                    onChange={(event) => setValue('freeform', event.target.value)}
                  />
                </Field>
              )}

              <DialogFooter className="mt-5">
                <Button variant="ghost" onClick={close}>取消</Button>
                <Button onClick={goConfirm} className="rounded-full">
                  下一步
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-primary" />
                  确认并创建存档
                </DialogTitle>
                <DialogDescription className="leading-relaxed">
                  创建后将开启一个全新存档，原有进度不会受到影响。
                </DialogDescription>
              </DialogHeader>

              {fields.length > 0 && (
                <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-border bg-secondary/40 p-4">
                  {fields.map((field) => (
                    <div key={field.key} className="flex items-start justify-between gap-4 text-sm">
                      <span className="shrink-0 text-muted-foreground">{field.label}</span>
                      <span className="text-right font-medium text-foreground text-pretty">{values[field.key]?.trim() || '—'}</span>
                    </div>
                  ))}
                </div>
              )}

              {allowFreeform && values.freeform?.trim() && (
                <div className="mt-4 rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
                  <p className="text-muted-foreground">补充设定</p>
                  <p className="mt-1 whitespace-pre-wrap font-medium text-foreground">{values.freeform.trim()}</p>
                </div>
              )}

              <DialogFooter className="mt-5">
                <Button variant="ghost" onClick={() => setStep('form')} disabled={creating}>
                  <ArrowLeft data-icon="inline-start" />
                  返回修改
                </Button>
                <Button onClick={createAdventure} className="rounded-full" disabled={creating}>
                  <Sparkles data-icon="inline-start" />
                  {creating ? '正在创建…' : '创建并开始'}
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
