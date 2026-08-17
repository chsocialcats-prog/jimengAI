'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, CalendarCheck, Dices, LoaderCircle, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api, type DailyCheckinCalendar, type DailyCheckinStatus } from '@/lib/api'
import { DailyFortuneDialog } from '@/components/daily-fortune-dialog'
import { useSession } from '@/components/session-provider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WebAssistantSheet } from '@/components/web-assistant-sheet'

type Edge = 'left' | 'right' | 'top' | 'bottom'

type StoredPosition = {
  edge: Edge
  offset: number
}

type Point = {
  x: number
  y: number
}

type DragState = {
  pointerId: number
  dragging: boolean
  point: Point
}

const LAUNCHER_SIZE = 58
const ACTION_SIZE = 40
const SAFE_MARGIN = 16
const DRAG_THRESHOLD = 6
const ACTION_INSET = 75
const ACTION_GAP = 62
const LAUNCHER_ALIGNMENT_NUDGE = 5
const STORAGE_KEY = 'zhimeng-floating-quick-actions-position-v1'

const actions = [
  { id: 'daily-checkin', label: '每日签到', icon: CalendarCheck },
  { id: 'assistant', label: 'AI 助手', icon: Bot },
  { id: 'random-script', label: '随机剧本', icon: Dices },
] as const

type ActionId = typeof actions[number]['id']

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isEdge(value: unknown): value is Edge {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom'
}

function edgeLimit(edge: Edge) {
  const viewportLength = edge === 'left' || edge === 'right' ? window.innerHeight : window.innerWidth
  const inset = SAFE_MARGIN + LAUNCHER_SIZE / 2
  return { min: inset, max: Math.max(inset, viewportLength - inset) }
}

function clampPosition(position: StoredPosition): StoredPosition {
  const limit = edgeLimit(position.edge)
  return { edge: position.edge, offset: clamp(position.offset, limit.min, limit.max) }
}

function defaultPosition(): StoredPosition {
  return { edge: 'left', offset: window.innerHeight / 2 }
}

function restorePosition(): StoredPosition {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return clampPosition(defaultPosition())
    const value = JSON.parse(raw) as Partial<StoredPosition>
    if (!isEdge(value.edge) || typeof value.offset !== 'number' || !Number.isFinite(value.offset)) return clampPosition(defaultPosition())
    return clampPosition({ edge: value.edge, offset: value.offset })
  } catch {
    return clampPosition(defaultPosition())
  }
}

function savePosition(position: StoredPosition) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Private browsing or storage policy can disable local persistence.
  }
}

function snapToEdge(point: Point): StoredPosition {
  const candidates: Array<{ edge: Edge; distance: number }> = [
    { edge: 'left', distance: point.x },
    { edge: 'right', distance: window.innerWidth - point.x },
    { edge: 'top', distance: point.y },
    { edge: 'bottom', distance: window.innerHeight - point.y },
  ]
  const edge = candidates.reduce((nearest, candidate) => candidate.distance < nearest.distance ? candidate : nearest).edge
  return clampPosition({ edge, offset: edge === 'left' || edge === 'right' ? point.y : point.x })
}

function clampDragPoint(point: Point): Point {
  const inset = SAFE_MARGIN + LAUNCHER_SIZE / 2
  return {
    x: clamp(point.x, inset, Math.max(inset, window.innerWidth - inset)),
    y: clamp(point.y, inset, Math.max(inset, window.innerHeight - inset)),
  }
}

function anchorStyle(position: StoredPosition, dragPoint: Point | null): CSSProperties {
  if (dragPoint) return { left: dragPoint.x, top: dragPoint.y }

  if (position.edge === 'left') return { left: 0, top: position.offset }
  if (position.edge === 'right') return { right: 0, top: position.offset }
  if (position.edge === 'top') return { left: position.offset, top: 0 }
  return { left: position.offset, bottom: 0 }
}

function revealedTransform(edge: Edge, axisOffset: Point) {
  if (edge === 'left') return `translate(0, -50%) translateY(${axisOffset.y}px)`
  if (edge === 'right') return `translate(-100%, -50%) translateY(${axisOffset.y}px)`
  if (edge === 'top') return `translate(-50%, 0) translateX(${axisOffset.x}px)`
  return `translate(-50%, -100%) translateX(${axisOffset.x}px)`
}

function rootPoint(position: StoredPosition, dragPoint: Point | null): Point {
  if (dragPoint) return dragPoint
  if (position.edge === 'left') return { x: 0, y: position.offset }
  if (position.edge === 'right') return { x: window.innerWidth, y: position.offset }
  if (position.edge === 'top') return { x: position.offset, y: 0 }
  return { x: position.offset, y: window.innerHeight }
}

function actionLayout(edge: Edge, position: StoredPosition, dragPoint: Point | null) {
  const root = rootPoint(position, dragPoint)
  const groupInset = SAFE_MARGIN + ACTION_SIZE / 2 + ACTION_GAP
  if (edge === 'left' || edge === 'right') {
    const center = clamp(root.y, groupInset, Math.max(groupInset, window.innerHeight - groupInset))
    const x = edge === 'left' ? ACTION_INSET : -ACTION_INSET
    const axisOffset = { x: 0, y: center - root.y }
    return {
      axisOffset,
      points: [-ACTION_GAP, 0, ACTION_GAP].map((y) => ({ x, y: axisOffset.y + y })),
    }
  }
  const center = clamp(root.x, groupInset, Math.max(groupInset, window.innerWidth - groupInset))
  const y = edge === 'top' ? ACTION_INSET : -ACTION_INSET
  const axisOffset = { x: center - root.x, y: 0 }
  return {
    axisOffset,
    points: [-ACTION_GAP, 0, ACTION_GAP].map((x) => ({ x: axisOffset.x + x, y })),
  }
}

function tooltipSide(edge: Edge) {
  if (edge === 'left') return 'right' as const
  if (edge === 'right') return 'left' as const
  if (edge === 'top') return 'bottom' as const
  return 'top' as const
}

export function FloatingQuickActions() {
  const router = useRouter()
  const { session, user } = useSession()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const [position, setPosition] = useState<StoredPosition | null>(null)
  const [dragPoint, setDragPoint] = useState<Point | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [coarsePointer, setCoarsePointer] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const [randomizing, setRandomizing] = useState(false)
  const [dailyCheckin, setDailyCheckin] = useState<DailyCheckinStatus | null>(null)
  const [dailyCalendar, setDailyCalendar] = useState<DailyCheckinCalendar | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [fortuneOpen, setFortuneOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)

  useEffect(() => {
    setPosition(restorePosition())
    const media = window.matchMedia('(hover: none), (pointer: coarse)')
    const updatePointerMode = () => setCoarsePointer(media.matches)
    updatePointerMode()
    media.addEventListener('change', updatePointerMode)
    return () => media.removeEventListener('change', updatePointerMode)
  }, [])

  useEffect(() => {
    const handleResize = () => setPosition((current) => current ? clampPosition(current) : current)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  if (!position) return null

  const isDragging = dragPoint !== null
  const revealed = coarsePointer || hovered || focusWithin || menuOpen || isDragging
  const { axisOffset, points } = actionLayout(position.edge, position, dragPoint)
  const alignedAxisOffset = menuOpen && !isDragging
    ? position.edge === 'left' || position.edge === 'right'
      ? { x: axisOffset.x, y: axisOffset.y + LAUNCHER_ALIGNMENT_NUDGE }
      : { x: axisOffset.x + LAUNCHER_ALIGNMENT_NUDGE, y: axisOffset.y }
    : { x: 0, y: 0 }
  const mainTransform = isDragging
    ? 'translate(-50%, -50%)'
    : revealed
      ? revealedTransform(position.edge, alignedAxisOffset)
      : 'translate(-50%, -50%)'
  const actionSide = tooltipSide(position.edge)

  const requireLogin = () => {
    if (session.authenticated && user) return true
    toast.message('登录后即可使用此功能')
    router.push('/login')
    return false
  }

  const loadDailyCalendar = () => {
    setCalendarLoading(true)
    setCalendarError('')
    setDailyCalendar(null)
    void api.getDailyCheckinCalendar()
      .then((result) => setDailyCalendar(result))
      .catch((error) => setCalendarError(error instanceof Error ? error.message : '无法读取本月签到记录'))
      .finally(() => setCalendarLoading(false))
  }

  const handleAction = (actionId: ActionId) => {
    if (actionId === 'random-script') {
      setRandomizing(true)
      void api.listWorks()
        .then((works) => {
          if (works.length === 0) {
            toast.message('暂无可进入的作品')
            return
          }
          const work = works[Math.floor(Math.random() * works.length)]
          setMenuOpen(false)
          router.push(`/work?work=${work.id}`)
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : '随机剧本失败'))
        .finally(() => setRandomizing(false))
      return
    }
    if (!requireLogin()) {
      setMenuOpen(false)
      return
    }
    if (actionId === 'assistant') {
      setMenuOpen(false)
      setAssistantOpen(true)
      return
    }
    setCheckingIn(true)
    void api.checkIn()
      .then((result) => {
        setDailyCheckin(result)
        setFortuneOpen(true)
        setMenuOpen(false)
        loadDailyCalendar()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '签到失败'))
      .finally(() => setCheckingIn(false))
  }

  const finishDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (!drag.dragging) return

    const nextPosition = snapToEdge(drag.point)
    suppressClickRef.current = true
    setMenuOpen(false)
    setDragPoint(null)
    setPosition(nextPosition)
    savePosition(nextPosition)
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      dragging: false,
      point: { x: event.clientX, y: event.clientY },
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const nextPoint = clampDragPoint({ x: event.clientX, y: event.clientY })
    const moved = Math.hypot(event.clientX - drag.point.x, event.clientY - drag.point.y) >= DRAG_THRESHOLD
    if (!drag.dragging && moved) {
      drag.dragging = true
      setMenuOpen(false)
    }
    if (!drag.dragging) return

    drag.point = nextPoint
    setDragPoint(nextPoint)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    finishDrag()
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragPoint(null)
  }

  return (
    <div
      ref={rootRef}
      className="fixed z-[45] h-0 w-0 touch-none"
      style={anchorStyle(position, dragPoint)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setFocusWithin(false)
      }}
    >
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-controls="floating-quick-actions-menu"
        aria-label={menuOpen ? '收起快捷功能' : '展开快捷功能'}
        className="absolute left-0 top-0 flex size-[58px] cursor-grab items-center justify-center rounded-full border border-primary/20 bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-[transform,box-shadow] duration-200 ease-out hover:shadow-xl hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/35 active:cursor-grabbing motion-reduce:transition-none"
        style={{ transform: mainTransform }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={() => {
          if (suppressClickRef.current) return
          setMenuOpen((open) => !open)
        }}
      >
        <Sparkles className="size-5" aria-hidden="true" />
      </button>

      <div id="floating-quick-actions-menu" role="group" aria-label="快捷功能">
        {actions.map((action, index) => {
          const Icon = action.icon
          const point = points[index]
          const visible = menuOpen && !isDragging
          const isLoading = (action.id === 'daily-checkin' && checkingIn) || (action.id === 'random-script' && randomizing)
          return (
            <Tooltip key={action.label}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={action.label}
                    tabIndex={visible ? 0 : -1}
                    disabled={isLoading}
                    className="absolute left-0 top-0 flex size-10 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-sm transition-[transform,opacity,box-shadow] duration-200 ease-out hover:bg-accent hover:text-accent-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none"
                    style={{
                      opacity: visible ? 1 : 0,
                      pointerEvents: visible ? 'auto' : 'none',
                      transform: `translate(${point.x - ACTION_SIZE / 2}px, ${point.y - ACTION_SIZE / 2}px) scale(${visible ? 1 : 0.7})`,
                      transitionDelay: visible ? `${index * 45}ms` : '0ms',
                    }}
                    onClick={() => handleAction(action.id)}
                  >
                    {isLoading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
                  </button>
                }
              />
              <TooltipContent side={actionSide}>{action.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <DailyFortuneDialog open={fortuneOpen} onOpenChange={setFortuneOpen} checkin={dailyCheckin} calendar={dailyCalendar} calendarLoading={calendarLoading} calendarError={calendarError} onRetryCalendar={loadDailyCalendar} />
      {user && <WebAssistantSheet open={assistantOpen} onOpenChange={setAssistantOpen} user={user} />}
    </div>
  )
}
