'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full"
      aria-label={mounted ? (isDark ? '切换到浅色模式' : '切换到深色模式') : '切换主题'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {/* 挂载前不渲染具体图标,避免明暗不一致的水合闪烁 */}
      {mounted ? (
        isDark ? (
          <Sun className="size-5" />
        ) : (
          <Moon className="size-5" />
        )
      ) : (
        <span className="size-5" />
      )}
    </Button>
  )
}
