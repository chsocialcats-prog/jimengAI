'use client'

import { CalendarDays, CirclePlus, Palette, Sparkles, Sprout, X } from 'lucide-react'
import type { DailyCheckinStatus, DailyFortune } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type DailyFortuneDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  checkin: DailyCheckinStatus | null
}

const luckyColorTokens: Record<string, string> = {
  樱粉: 'bg-primary',
  薰衣草: 'bg-accent',
  晨雾蓝: 'bg-chart-3',
  新芽绿: 'bg-chart-4',
  蜜杏: 'bg-chart-5',
}

const rankTokens: Record<DailyFortune['rank'], string> = {
  大吉: 'border-primary/25 bg-primary/10 px-5 py-2 text-lg font-extrabold text-primary ring-primary/10 sm:text-xl',
  中吉: 'border-border bg-secondary/80 px-4 py-1.5 text-base font-bold text-secondary-foreground sm:text-lg',
  小吉: 'border-accent/20 bg-accent/30 px-3.5 py-1.5 text-sm font-semibold text-accent-foreground sm:text-base',
  平: 'border-border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground',
}

export function DailyFortuneDialog({ open, onOpenChange, checkin }: DailyFortuneDialogProps) {
  const fortune = checkin?.fortune
  if (!fortune) return null

  const alreadyCheckedIn = Boolean(checkin?.already_checked_in)
  const pointsText = alreadyCheckedIn ? `本日已获 +${checkin.points_awarded} 积分` : `+${checkin?.points_awarded} 积分`
  const rankToken = rankTokens[fortune.rank] || rankTokens.平

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-6 sm:max-w-[34rem] sm:p-8">
        <DialogClose
          aria-label="关闭今日灵签"
          render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" />}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>

        <DialogHeader className="items-center gap-2 px-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
            <Sparkles className="size-5" />
          </span>
          <DialogTitle className="font-rounded text-xl font-bold">
            {alreadyCheckedIn ? '今日灵签' : '签到成功'}
          </DialogTitle>
          <DialogDescription>{alreadyCheckedIn ? '今天的灵感提示仍在这里。' : '今天也为故事留下一笔。'}</DialogDescription>
        </DialogHeader>

        <div className={`mx-auto mt-5 inline-flex items-center rounded-full border font-rounded ring-1 ${rankToken}`}>
          {fortune.rank}
        </div>

        <blockquote className="my-6 border-y border-border/70 px-3 py-5 text-center font-rounded text-base leading-7 text-foreground sm:text-lg">
          “{fortune.verse}”
        </blockquote>

        <div className="mb-6 flex flex-wrap justify-center gap-2" aria-label="签到状态">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <CalendarDays className="size-3.5 text-primary" aria-hidden="true" />
            连续签到 {checkin?.streak_days} 天
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <CirclePlus className="size-3.5 text-primary" aria-hidden="true" />
            {pointsText}
          </span>
        </div>

        <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border/70 text-center">
          <div className="min-w-0 px-2 py-4 sm:px-3">
            <dt className="mb-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Palette className="size-3" aria-hidden="true" />
              幸运色
            </dt>
            <dd className="flex items-center justify-center gap-1.5 text-sm font-medium">
              <span className={`size-2.5 shrink-0 rounded-full ${luckyColorTokens[fortune.lucky_color] || 'bg-muted-foreground'}`} aria-hidden="true" />
              <span className="truncate">{fortune.lucky_color}</span>
            </dd>
          </div>
          <div className="min-w-0 px-2 py-4 sm:px-3">
            <dt className="mb-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" aria-hidden="true" />
              宜
            </dt>
            <dd className="truncate text-sm font-medium">{fortune.do}</dd>
          </div>
          <div className="min-w-0 px-2 py-4 sm:px-3">
            <dt className="mb-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Sprout className="size-3" aria-hidden="true" />
              避
            </dt>
            <dd className="truncate text-sm font-medium">{fortune.avoid}</dd>
          </div>
        </dl>

        <DialogClose render={<Button className="mt-7 w-full" />}>
          收下这份运势
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
