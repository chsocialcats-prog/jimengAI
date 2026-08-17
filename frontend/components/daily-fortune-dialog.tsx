'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Briefcase, CalendarDays, CirclePlus, Flag, Flower2, Gift, Heart, House, Lamp, Landmark, LoaderCircle, Moon, Palette, RefreshCw, Sparkles, Sprout, X, type LucideIcon } from 'lucide-react'
import type { DailyCheckinCalendar, DailyCheckinStatus, DailyFortune } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type DailyFortuneDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  checkin: DailyCheckinStatus | null
  calendar: DailyCheckinCalendar | null
  calendarLoading: boolean
  calendarError: string
  onRetryCalendar: () => void
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

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

const festivalIcons: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  house: House,
  lamp: Lamp,
  'flower-2': Flower2,
  briefcase: Briefcase,
  flag: Flag,
  heart: Heart,
  moon: Moon,
  landmark: Landmark,
  gift: Gift,
}

const petals = [
  { left: '10%', delay: '0ms', drift: '-20px', rotation: '145deg' },
  { left: '28%', delay: '140ms', drift: '18px', rotation: '235deg' },
  { left: '54%', delay: '70ms', drift: '-12px', rotation: '170deg' },
  { left: '78%', delay: '220ms', drift: '22px', rotation: '250deg' },
  { left: '91%', delay: '20ms', drift: '-16px', rotation: '200deg' },
] as const

function calendarCells(month: string | undefined) {
  const matched = /^(\d{4})-(\d{2})$/.exec(month || '')
  if (!matched) return []
  const year = Number(matched[1])
  const monthIndex = Number(matched[2])
  if (monthIndex < 1 || monthIndex > 12) return []

  const leadingDays = (new Date(year, monthIndex - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex, 0).getDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1
    return day >= 1 && day <= daysInMonth ? `${matched[1]}-${matched[2]}-${String(day).padStart(2, '0')}` : null
  })
}

function calendarTitle(month: string | undefined) {
  const matched = /^(\d{4})-(\d{2})$/.exec(month || '')
  return matched ? `${matched[1]} 年 ${Number(matched[2])} 月` : '本月签到日历'
}

export function DailyFortuneDialog({ open, onOpenChange, checkin, calendar, calendarLoading, calendarError, onRetryCalendar }: DailyFortuneDialogProps) {
  const [view, setView] = useState<'fortune' | 'calendar'>('fortune')
  const [showCelebration, setShowCelebration] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const cells = useMemo(() => calendarCells(calendar?.month), [calendar?.month])
  const checkinDates = useMemo(() => new Set(calendar?.checkin_dates || []), [calendar?.checkin_dates])
  const festivalsByDate = useMemo(() => new Map((calendar?.festivals || []).map((festival) => [festival.date, festival])), [calendar?.festivals])
  const festival = checkin?.fortune?.festival
  const FestivalFortuneIcon = festival ? festivalIcons[festival.icon] || Sparkles : Sparkles

  useEffect(() => {
    if (!open) {
      setShowCelebration(false)
      return
    }
    setView('fortune')
    setShowCelebration(Boolean(festival))
  }, [open, festival?.id])

  useLayoutEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: 0 }))
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const fortune = checkin?.fortune
  if (!fortune) return null

  const alreadyCheckedIn = Boolean(checkin?.already_checked_in)
  const pointsText = alreadyCheckedIn ? `本日已获 +${checkin.points_awarded} 积分` : `+${checkin?.points_awarded} 积分`
  const rankToken = rankTokens[fortune.rank] || rankTokens.平

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={() => document.getElementById('daily-fortune-close')} className="max-w-[34rem] gap-0 overflow-hidden p-0">
        {showCelebration && festival && <div className="festival-celebration" aria-hidden="true">
          {petals.map((petal, index) => <span key={index} className="festival-petal" style={{ left: petal.left, animationDelay: petal.delay, '--festival-drift': petal.drift, '--festival-rotation': petal.rotation } as CSSProperties} />)}
        </div>}
        <DialogClose
          id="daily-fortune-close"
          aria-label="关闭今日灵签"
          render={<Button variant="ghost" size="icon-sm" className="absolute right-3 top-3 z-20" />}
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>

        <div ref={scrollContainerRef} className="relative z-10 max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:p-8">
        <DialogHeader className="items-center gap-2 px-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
            {view === 'fortune' ? <FestivalFortuneIcon className="size-5" /> : <CalendarDays className="size-5" />}
          </span>
          <DialogTitle className="font-rounded text-xl font-bold">
            {view === 'fortune' ? festival ? '节日灵签' : alreadyCheckedIn ? '今日灵签' : '签到成功' : '签到日历'}
          </DialogTitle>
          {view === 'fortune' && festival && <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"><FestivalFortuneIcon className="size-3" aria-hidden="true" />{festival.name}专属灵签</span>}
          <DialogDescription>{view === 'fortune' ? festival ? `今天是${festival.name}，这份大吉送给你。` : alreadyCheckedIn ? '今天的灵感提示仍在这里。' : '今天也为故事留下一笔。' : '查看本月留下的故事印记。'}</DialogDescription>
        </DialogHeader>

        <div className="mx-auto mt-5 grid w-full max-w-64 grid-cols-2 rounded-lg bg-muted p-1" role="tablist" aria-label="签到内容视图">
          <button type="button" role="tab" id="fortune-tab" aria-selected={view === 'fortune'} aria-controls="fortune-panel" onClick={() => setView('fortune')} className={`h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${view === 'fortune' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>今日灵签</button>
          <button type="button" role="tab" id="calendar-tab" aria-selected={view === 'calendar'} aria-controls="calendar-panel" onClick={() => setView('calendar')} className={`h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${view === 'calendar' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>签到日历</button>
        </div>

        {view === 'fortune' ? <div id="fortune-panel" role="tabpanel" aria-labelledby="fortune-tab">
          <div className="mt-5 flex justify-center">
            <div className={`inline-flex items-center rounded-full border font-rounded ring-1 ${rankToken}`}>
              {fortune.rank}
            </div>
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
        </div> : <div id="calendar-panel" role="tabpanel" aria-labelledby="calendar-tab" className="mt-6">
          {calendarLoading ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在读取本月签到记录…</div> : calendarError ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"><p className="text-sm text-muted-foreground">{calendarError}</p><Button variant="outline" size="sm" onClick={onRetryCalendar}><RefreshCw data-icon="inline-start" />重试</Button></div> : calendar ? <div>
            <div className="mb-4 flex items-center justify-between"><h3 className="font-rounded text-lg font-bold">{calendarTitle(calendar.month)}</h3><span className="text-xs text-muted-foreground">本月已签到 {checkinDates.size} 天</span></div>
            <div className="grid grid-cols-7 text-center" role="grid" aria-label={`${calendarTitle(calendar.month)}签到记录`}>
              {weekdays.map((weekday) => <span key={weekday} role="columnheader" className="pb-2 text-xs font-medium text-muted-foreground">{weekday}</span>)}
              {cells.map((date, index) => {
                if (!date) return <span key={`empty-${index}`} aria-hidden="true" className="h-10" />
                const isToday = date === checkin?.date
                const isFuture = Boolean(checkin?.date && date > checkin.date)
                const isCheckedIn = checkinDates.has(date)
                const dayFestival = festivalsByDate.get(date)
                const FestivalIcon = dayFestival ? festivalIcons[dayFestival.icon] || Sparkles : null
                const label = `${date.slice(5).replace('-', ' 月 ')} 日${isToday ? '，今天' : ''}${isCheckedIn ? '，已签到' : ''}${dayFestival ? `，${dayFestival.name}` : ''}`
                return <span key={date} role="gridcell" aria-label={label} title={dayFestival?.name} className={`relative flex h-10 items-center justify-center text-sm ${isToday ? 'rounded-lg ring-2 ring-primary/40' : ''} ${isFuture ? 'text-muted-foreground/45' : ''}`}><span className={isToday ? 'font-bold text-primary' : ''}>{Number(date.slice(-2))}</span>{FestivalIcon && <FestivalIcon className="absolute right-1 top-1 size-3 text-primary" aria-hidden="true" />}{isCheckedIn && <span className="absolute bottom-1 size-1 rounded-full bg-primary" aria-hidden="true" />}</span>
              })}
            </div>
          </div> : <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">暂无本月签到记录</div>}
        </div>}

        <DialogClose render={<Button variant={view === 'fortune' ? 'default' : 'outline'} className="mt-7 w-full" />}>
          {view === 'fortune' ? '收下这份运势' : '关闭'}
        </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
