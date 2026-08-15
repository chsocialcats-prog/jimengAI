'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bot, Eraser, Eye, LoaderCircle, SendHorizontal, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ApiUser, WebAssistantMessage } from '@/lib/api'
import { api } from '@/lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type StoredMessage = WebAssistantMessage & { id: string }

const MAX_VISIBLE_MESSAGES = 24
const COUNT_QUESTION = /多少|几(?:个|部|本|张)?|数量|总数|统计/

async function siteDataReply(content: string) {
  if (!COUNT_QUESTION.test(content)) return null

  const requested = {
    works: /剧本|作品|故事/.test(content),
    cards: /角色卡|角色/.test(content),
    worldbooks: /世界书|世界观|设定集/.test(content),
  }
  if (!requested.works && !requested.cards && !requested.worldbooks) return null

  const [works, cards, worldbooks] = await Promise.all([
    requested.works ? api.listWorks() : Promise.resolve(null),
    requested.cards ? api.listCards() : Promise.resolve(null),
    requested.worldbooks ? api.listWorldbooks() : Promise.resolve(null),
  ])
  const totals = [
    works && `${works.length} 部作品`,
    cards && `${cards.length} 张角色卡`,
    worldbooks && `${worldbooks.length} 本世界书`,
  ].filter((value): value is string => Boolean(value))
  return `我已读取当前可访问的站内资料（只读）：平台目前共有${totals.join('、')}。`
}

function greeting(): StoredMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content: '我在。需要一起整理剧情，还是处理别的想法？',
  }
}

function storageKey(userId: number) {
  return `zhimeng-web-assistant-messages-v1-${userId}`
}

function makeMessage(role: WebAssistantMessage['role'], content: string): StoredMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, content }
}

function loadMessages(userId: number): StoredMessage[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return [greeting()]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [greeting()]
    const messages = parsed
      .filter((item): item is StoredMessage => Boolean(
        item && typeof item === 'object' &&
        ((item as StoredMessage).role === 'user' || (item as StoredMessage).role === 'assistant') &&
        typeof (item as StoredMessage).content === 'string' &&
        typeof (item as StoredMessage).id === 'string',
      ))
      .slice(-MAX_VISIBLE_MESSAGES)
    return messages.length ? messages : [greeting()]
  } catch {
    return [greeting()]
  }
}

export function WebAssistantSheet({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: ApiUser
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<StoredMessage[]>(() => [greeting()])
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const key = useMemo(() => storageKey(user.id), [user.id])
  const pagePath = useMemo(() => {
    const query = searchParams.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    setMessages(loadMessages(user.id))
    setDraft('')
  }, [user.id])

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_VISIBLE_MESSAGES)))
    } catch {
      // Storage may be unavailable in private browsing; chat still works for this page.
    }
  }, [key, messages])

  useEffect(() => {
    if (!open) return
    messageEndRef.current?.scrollIntoView({ block: 'end' })
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, messages, isSending])

  const send = async () => {
    const content = draft.trim()
    if (!content || isSending) return

    const userMessage = makeMessage('user', content)
    const nextMessages = [...messages, userMessage].slice(-MAX_VISIBLE_MESSAGES)
    setMessages(nextMessages)
    setDraft('')
    setIsSending(true)
    try {
      const directReply = await siteDataReply(content)
      const message = directReply ?? (await api.chatWithAssistant(
        nextMessages
          .filter((message) => message.id !== 'welcome')
          .slice(-12)
          .map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        pagePath,
      )).message
      setMessages((current) => [...current, makeMessage('assistant', message)].slice(-MAX_VISIBLE_MESSAGES))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '助手暂时无法回复')
    } finally {
      setIsSending(false)
    }
  }

  const clearMessages = () => {
    setMessages([greeting()])
    setDraft('')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-hidden p-0 sm:max-w-[28rem]" aria-describedby="web-assistant-description">
        <SheetHeader className="border-b border-border/70 px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <SheetTitle className="font-rounded text-base font-bold">网页 AI 助手</SheetTitle>
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex text-muted-foreground" tabIndex={0} aria-label="站内资料只读" />}>
                    <Eye className="size-3.5" aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>站内资料只读</TooltipContent>
                </Tooltip>
              </div>
              <SheetDescription id="web-assistant-description" className="truncate text-xs">剧情、设定与灵感</SheetDescription>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-sm" className="absolute right-12 top-4 rounded-full" aria-label="清空助手对话" onClick={clearMessages} />}
            >
              <Eraser className="size-4" />
            </TooltipTrigger>
            <TooltipContent>清空对话</TooltipContent>
          </Tooltip>
        </SheetHeader>

        <div className="soft-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-5">
          <div className="space-y-4">
            {messages.map((message) => (
              <article key={message.id} className={`flex items-start gap-2.5 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {message.role === 'assistant' ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <Bot className="size-4" aria-hidden="true" />
                  </span>
                ) : (
                  <Avatar className="size-7">
                    {user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${user.username} 的头像`} />}
                    <AvatarFallback>{user.username.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                )}
                <p className={`max-w-[82%] whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'rounded-2xl rounded-tr-md bg-primary text-primary-foreground' : 'rounded-2xl rounded-tl-md bg-muted text-foreground'}`}>
                  {message.content}
                </p>
              </article>
            ))}
            {isSending && (
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><Bot className="size-4" aria-hidden="true" /></span>
                <span className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-muted px-3 py-2.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />正在思考</span>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>
        </div>

        <div className="border-t border-border/70 bg-background/90 p-4 supports-backdrop-filter:backdrop-blur-sm">
          <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-1.5 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              placeholder="给助手留言…"
              aria-label="给网页 AI 助手发送消息"
              disabled={isSending}
              className="min-h-10 max-h-32 resize-none border-0 bg-transparent py-2 shadow-none focus-visible:border-0 focus-visible:ring-0"
              rows={1}
            />
            <Button size="icon" className="mb-0.5 shrink-0 rounded-lg" aria-label="发送消息" disabled={!draft.trim() || isSending} onClick={() => void send()}>
              {isSending ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
