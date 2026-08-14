'use client'

import Link from 'next/link'
import { Play, Pencil, Trash2, MoreHorizontal, BookMarked, Clock } from 'lucide-react'
import type { Work } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const fallbackCovers = [
  '/images/covers/sakura-station.png',
  '/images/covers/foggy-detective.png',
  '/images/covers/star-train.png',
  '/images/covers/sky-library.png',
]

export function workCover(work: Work) {
  return work.cover_url || fallbackCovers[work.id % fallbackCovers.length]
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近更新'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

export function WorkCard({
  work,
  onPlay,
  onDelete,
  priority = false,
}: {
  work: Work
  onPlay: (work: Work) => void
  onDelete: (work: Work) => void
  priority?: boolean
}) {
  const editable = work.can_edit

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
      <Link href={`/work?work=${work.id}`} className="relative block aspect-[3/4] overflow-hidden" aria-label={`查看《${work.title}》详情`}>
        <img
          src={workCover(work)}
          alt={`《${work.title}》封面`}
          loading={priority ? 'eager' : 'lazy'}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/10" />

        <div className="absolute left-3 top-3 flex gap-1.5">
          <Badge
            className={cn(
              'rounded-full border-none text-[11px] shadow-sm backdrop-blur',
              work.is_archive ? 'bg-accent/90 text-accent-foreground' : 'bg-background/85 text-foreground',
            )}
          >
            {work.is_archive ? '已归档' : '可冒险'}
          </Badge>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3.5">
          <h3 className="font-rounded text-base font-bold leading-tight text-white text-balance drop-shadow">
            {work.title}
          </h3>
          <p className="mt-0.5 text-xs text-white/80">{work.owner_username || '本地创作者'}</p>
        </div>
      </Link>

      {editable && (
        <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="rounded-full bg-background/85 backdrop-blur"
                  aria-label="更多操作"
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href={`/editor?work=${work.id}`} />}>
                  <Pencil className="size-4" />
                  编辑作品
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPlay(work)}>
                  <Play className="size-4" />
                  进入冒险
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(work)}>
                <Trash2 className="size-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {work.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="rounded-full text-[11px] font-normal">
              {tag}
            </Badge>
          ))}
          {work.cards.slice(0, 1).map((card) => (
            <Badge key={card.id} variant="outline" className="rounded-full text-[11px] font-normal">
              {card.name}
            </Badge>
          ))}
        </div>
          <Link href={`/work?work=${work.id}`} className="line-clamp-2 text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground">
            {work.description || '尚未填写作品简介。'}
          </Link>

        <div className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatUpdatedAt(work.updated_at)}
          </span>
          {work.card_ids.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-primary">
              <BookMarked className="size-3.5" />
              {work.card_ids.length} 张角色卡
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <Button className="flex-1 rounded-full" onClick={() => onPlay(work)} disabled={work.is_archive}>
            <Play data-icon="inline-start" />
            {work.is_archive ? '作品已归档' : '进入冒险'}
          </Button>
          {editable && (
            <Button
              variant="outline"
              size="icon"
              className="rounded-full"
              render={<Link href={`/editor?work=${work.id}`} aria-label="编辑作品" />}
              nativeButton={false}
            >
              <Pencil />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
