'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Eye, Lock, User as UserIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { InputGroup, InputGroupInput, InputGroupAddon } from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api'
import { useSession } from '@/components/session-provider'

type Mode = 'login' | 'register'

const DEFAULT_ILLUSTRATION = '/images/auth-illustration.png'
const ILLUSTRATION_MANIFEST = '/images/login-illustrations/manifest.json'

function getIllustrationPaths(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { images?: unknown }).images)) {
    return []
  }

  return (payload as { images: unknown[] }).images.filter(
    (image): image is string => typeof image === 'string' && image.startsWith('/images/login-illustrations/')
  )
}

export function AuthView() {
  const router = useRouter()
  const { setSession } = useSession()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [illustration, setIllustration] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const showFallback = () => {
      if (!cancelled) setIllustration(DEFAULT_ILLUSTRATION)
    }

    const loadRandomIllustration = async () => {
      try {
        const response = await fetch(ILLUSTRATION_MANIFEST, { cache: 'no-store' })
        if (!response.ok) {
          showFallback()
          return
        }

        const images = getIllustrationPaths(await response.json())
        if (!images.length) {
          showFallback()
          return
        }

        let previous: string | null = null
        try {
          previous = window.sessionStorage.getItem('zhimeng-last-login-illustration')
        } catch {
          // Storage access is optional and only prevents immediate repeats.
        }
        const candidates = images.length > 1 ? images.filter((image) => image !== previous) : images
        const selected = candidates[Math.floor(Math.random() * candidates.length)] ?? images[0]
        const preview = new window.Image()
        const applyIllustration = () => {
          if (cancelled) return
          try {
            window.sessionStorage.setItem('zhimeng-last-login-illustration', selected)
          } catch {
            // Storage access is optional and only prevents immediate repeats.
          }
          setIllustration(selected)
        }

        preview.onload = applyIllustration
        preview.onerror = showFallback
        preview.src = selected

        if (preview.complete && preview.naturalWidth > 0) {
          applyIllustration()
        }
      } catch {
        showFallback()
      }
    }

    void loadRandomIllustration()
    return () => {
      cancelled = true
    }
  }, [])

  const validate = () => {
    const next: Record<string, string> = {}
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username.trim())) {
      next.username = '用户名需为 3-32 位字母、数字、下划线或连字符'
    }
    if (password.length < 10) next.password = '密码至少需要 10 位'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const session = mode === 'login'
        ? await api.login(username.trim(), password)
        : await api.register(username.trim(), password)
      setSession(session)
      toast.success(mode === 'login' ? '欢迎回来' : '账户已创建')
      router.push('/')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '认证失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative isolate flex min-h-svh overflow-hidden bg-background">
      {illustration && (
        <img
          src={illustration}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      <div className="relative flex min-h-svh w-full items-center justify-center px-6 py-10 lg:px-10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-primary/45 via-transparent to-transparent" />
        <div className="pointer-events-none absolute bottom-0 left-0 hidden max-w-2xl p-10 xl:block xl:p-14">
          <p className="font-serif text-2xl font-semibold leading-relaxed text-white text-balance drop-shadow md:text-3xl">
            每一次落笔，都是一个世界的开始。
          </p>
          <p className="mt-3 text-sm text-white/90 md:text-base">用 AI 编织属于你的互动故事。</p>
        </div>

        <div
          className={`relative w-full max-w-md rounded-3xl border border-white/45 px-7 py-8 shadow-2xl sm:px-8 sm:py-9 ${
            illustration ? 'bg-background/46 backdrop-blur-3xl dark:bg-background/54' : 'bg-background/95'
          }`}
        >
          <div className="w-full">
          <Link href="/" className="mb-8 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <span className="font-serif text-xl font-semibold text-foreground">织梦</span>
          </Link>

          <h1 className="font-serif text-2xl font-bold text-foreground text-balance">
            {mode === 'login' ? '欢迎回来' : '创建本地账户'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === 'login' ? '登录以继续创作和冒险。' : '创建后即可保存作品与冒险进度。'}
          </p>

          <form onSubmit={handleSubmit} className="mt-7">
            <FieldGroup>
              <Field data-invalid={!!errors.username || undefined}>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <InputGroup className="bg-background/75 backdrop-blur-sm dark:bg-background/75">
                  <InputGroupInput
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="3-32 位字母、数字或 _ -"
                    aria-invalid={!!errors.username || undefined}
                  />
                  <InputGroupAddon>
                    <UserIcon className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                </InputGroup>
                {errors.username && <FieldDescription className="text-destructive">{errors.username}</FieldDescription>}
              </Field>

              <Field data-invalid={!!errors.password || undefined}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <InputGroup className="bg-background/75 backdrop-blur-sm dark:bg-background/75">
                  <InputGroupInput
                    id="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 10 位"
                    aria-invalid={!!errors.password || undefined}
                  />
                  <InputGroupAddon>
                    <Lock className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                </InputGroup>
                {errors.password && <FieldDescription className="text-destructive">{errors.password}</FieldDescription>}
              </Field>

              <Button type="submit" size="lg" className="mt-1 w-full rounded-full" disabled={loading}>
                {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
              </Button>
            </FieldGroup>
          </form>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">或</span>
            <Separator className="flex-1" />
          </div>

          <Button variant="outline" size="lg" className="w-full rounded-full" onClick={() => router.push('/')}>
            <Eye data-icon="inline-start" />
            以访客身份浏览
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? '还没有账户？' : '已有账户？'}{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setErrors({})
              }}
            >
              {mode === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
    </div>
  )
}
