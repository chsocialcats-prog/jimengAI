'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

export type ImageCropShape = 'avatar' | 'cover'

type Point = { x: number; y: number }
type Dimensions = { width: number; height: number }

const cropOutput = {
  avatar: { width: 512, height: 512, title: '裁剪头像', description: '圆形头像' },
  cover: { width: 900, height: 1200, title: '裁剪封面', description: '3:4 封面' },
} as const

const INITIAL_ZOOM = 2

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function sliderValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] || 1 : value
}

export function ImageCropDialog({
  file,
  shape,
  open,
  onOpenChange,
  onConfirm,
  onError,
}: {
  file: File | null
  shape: ImageCropShape
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (file: File) => void
  onError?: (message: string) => void
}) {
  const pointerRef = useRef<Point | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [surfaceElement, setSurfaceElement] = useState<HTMLDivElement | null>(null)
  const [surface, setSurface] = useState<Dimensions>({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [focus, setFocus] = useState<Point>({ x: 0.5, y: 0.5 })
  const config = cropOutput[shape]

  useEffect(() => {
    setImage(null)
    setImageUrl('')
    setZoom(INITIAL_ZOOM)
    setFocus({ x: 0.5, y: 0.5 })
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    const nextImage = new Image()
    nextImage.onload = () => {
      setImage(nextImage)
      setImageUrl(objectUrl)
    }
    nextImage.onerror = () => onError?.('无法读取这张图片')
    nextImage.src = objectUrl
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, onError])

  useEffect(() => {
    if (!surfaceElement || !open) return
    const updateSurface = () => setSurface({ width: surfaceElement.clientWidth, height: surfaceElement.clientHeight })
    updateSurface()
    const observer = new ResizeObserver(updateSurface)
    observer.observe(surfaceElement)
    return () => observer.disconnect()
  }, [open, shape, surfaceElement])

  const baseScale = image && surface.width && surface.height
    ? Math.max(surface.width / image.naturalWidth, surface.height / image.naturalHeight)
    : 0
  const scale = baseScale * zoom
  const cropWidth = scale ? surface.width / scale : 0
  const cropHeight = scale ? surface.height / scale : 0

  const clampFocus = (next: Point, nextZoom = zoom) => {
    if (!image || !baseScale || !surface.width || !surface.height) return next
    const halfWidth = surface.width / baseScale / nextZoom / image.naturalWidth / 2
    const halfHeight = surface.height / baseScale / nextZoom / image.naturalHeight / 2
    return {
      x: clamp(next.x, halfWidth, 1 - halfWidth),
      y: clamp(next.y, halfHeight, 1 - halfHeight),
    }
  }

  const reset = () => {
    setZoom(INITIAL_ZOOM)
    setFocus({ x: 0.5, y: 0.5 })
  }

  const moveFocus = (event: React.PointerEvent<HTMLDivElement>) => {
    const lastPoint = pointerRef.current
    if (!lastPoint || !image || !scale) return
    const deltaX = event.clientX - lastPoint.x
    const deltaY = event.clientY - lastPoint.y
    pointerRef.current = { x: event.clientX, y: event.clientY }
    setFocus((previous) => clampFocus({
      x: previous.x - deltaX / scale / image.naturalWidth,
      y: previous.y - deltaY / scale / image.naturalHeight,
    }))
  }

  const changeZoom = (value: number) => {
    setZoom(value)
    setFocus((previous) => clampFocus(previous, value))
  }

  const shiftHorizontally = (direction: -1 | 1) => {
    const visibleRatio = image && cropWidth ? cropWidth / image.naturalWidth : 0.25
    setFocus((previous) => clampFocus({
      ...previous,
      x: previous.x + direction * visibleRatio * 0.2,
    }))
  }

  const confirm = () => {
    if (!file || !image || !scale || !cropWidth || !cropHeight) return
    const sourceX = clamp(focus.x * image.naturalWidth - cropWidth / 2, 0, Math.max(0, image.naturalWidth - cropWidth))
    const sourceY = clamp(focus.y * image.naturalHeight - cropHeight / 2, 0, Math.max(0, image.naturalHeight - cropHeight))
    const canvas = document.createElement('canvas')
    canvas.width = config.width
    canvas.height = config.height
    const context = canvas.getContext('2d')
    if (!context) {
      onError?.('无法处理这张图片')
      return
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    if (shape === 'avatar') {
      context.beginPath()
      context.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2)
      context.clip()
    }
    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        onError?.('无法导出裁剪后的图片')
        return
      }
      const isAvatar = shape === 'avatar'
      onConfirm(new File([blob], `${shape}-${Date.now()}.${isAvatar ? 'png' : 'jpg'}`, { type: isAvatar ? 'image/png' : 'image/jpeg' }))
      onOpenChange(false)
    }, shape === 'avatar' ? 'image/png' : 'image/jpeg', 0.92)
  }

  const renderedWidth = image && scale ? image.naturalWidth * scale : 0
  const renderedHeight = image && scale ? image.naturalHeight * scale : 0
  const imageLeft = surface.width / 2 - focus.x * renderedWidth
  const imageTop = surface.height / 2 - focus.y * renderedHeight

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div
            ref={setSurfaceElement}
            className={cn(
              'relative touch-none overflow-hidden bg-muted shadow-inner',
              shape === 'avatar' ? 'aspect-square w-[min(76vw,320px)] rounded-full' : 'aspect-[3/4] w-[min(58vw,260px)] rounded-lg',
            )}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              pointerRef.current = { x: event.clientX, y: event.clientY }
            }}
            onPointerMove={moveFocus}
            onPointerUp={() => { pointerRef.current = null }}
            onPointerCancel={() => { pointerRef.current = null }}
          >
            {imageUrl && image && (
              <img
                src={imageUrl}
                alt="裁剪预览"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{ width: renderedWidth, height: renderedHeight, left: imageLeft, top: imageTop }}
              />
            )}
            <div className={cn('pointer-events-none absolute inset-0 border-2 border-white/85 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.2)]', shape === 'avatar' ? 'rounded-full' : 'rounded-lg')} />
            {shape === 'cover' && <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-45"><span className="border-b border-r border-white/70" /><span className="border-b border-r border-white/70" /><span className="border-b border-white/70" /><span className="border-b border-r border-white/70" /><span className="border-b border-r border-white/70" /><span className="border-b border-white/70" /><span className="border-r border-white/70" /><span className="border-r border-white/70" /><span /></div>}
          </div>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Button variant="ghost" size="icon-sm" title="向左取景" aria-label="向左取景" onClick={() => shiftHorizontally(-1)} disabled={!image}><ArrowLeft /></Button>
            <Button variant="ghost" size="icon-sm" title="缩小取景" aria-label="缩小取景" onClick={() => changeZoom(clamp(zoom - 0.1, 1, 3))}><Minus /></Button>
            <Slider value={[zoom]} min={1} max={3} step={0.01} onValueChange={(value) => changeZoom(sliderValue(value))} />
            <Button variant="ghost" size="icon-sm" title="放大取景" aria-label="放大取景" onClick={() => changeZoom(clamp(zoom + 0.1, 1, 3))}><Plus /></Button>
            <Button variant="ghost" size="icon-sm" title="向右取景" aria-label="向右取景" onClick={() => shiftHorizontally(1)} disabled={!image}><ArrowRight /></Button>
            <Button variant="ghost" size="icon-sm" title="重置取景" aria-label="重置取景" onClick={reset}><RotateCcw /></Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={confirm} disabled={!image || !surface.width || !surface.height}>确认裁剪</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
