'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  Ban,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Database,
  FileClock,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useSession } from '@/components/session-provider'
import { AdminDataPanel } from '@/components/admin/admin-data-panel'
import { api, type AdminAuditLog, type AdminOverview, type AdminUser } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type AdminTab = 'overview' | 'users' | 'data' | 'audit'

const actionLabels: Record<string, string> = {
  promote_station_master: '授予站长权限',
  suspend_user: '停用账户',
  activate_user: '恢复账户',
  reset_password: '重置密码',
  clear_ai_secrets: '清理 AI 密钥',
}

const resourceLabels: Record<string, string> = {
  cards: '角色卡',
  worldbooks: '世界书',
  worldbook_entries: '世界书条目',
  works: '作品',
  conversations: '冒险会话',
  messages: '消息',
  snapshots: '存档',
  states: '实时状态',
}

function formatTime(value: string | null | undefined) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatAction(action: string) {
  return actionLabels[action] || action
}

export function AdminView() {
  const { session, loading: sessionLoading } = useSession()
  const [tab, setTab] = useState<AdminTab>('overview')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [auditTotal, setAuditTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isStationMaster = session.user?.role === 'station_master'

  const load = async (showSpinner = true) => {
    if (!isStationMaster) return
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const [nextOverview, nextUsers, nextAudit] = await Promise.all([
        api.getAdminOverview(),
        api.listAdminUsers({ q: query, status, page_size: 50 }),
        api.listAdminAuditLogs({ page_size: 30 }),
      ])
      setOverview(nextOverview)
      setUsers(nextUsers.items || [])
      setUsersTotal(nextUsers.total)
      setAuditLogs(nextAudit.items || [])
      setAuditTotal(nextAudit.total)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '无法读取站长后台'
      setError(message)
      if (showSpinner) toast.error(message)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    if (!sessionLoading && isStationMaster) void load()
  }, [sessionLoading, isStationMaster])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await load(false)
      toast.success('后台数据已刷新')
    } finally {
      setRefreshing(false)
    }
  }

  const openUser = async (user: AdminUser) => {
    setSelectedUser(user)
    try {
      const result = await api.getAdminUser(user.id)
      setSelectedUser(result.user)
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : '无法读取用户详情')
    }
  }

  const updateUser = (nextUser: AdminUser) => {
    setUsers((current) => current.map((user) => user.id === nextUser.id ? nextUser : user))
    setSelectedUser(nextUser)
  }

  const suspendUser = async () => {
    if (!selectedUser || selectedUser.id === session.user?.id) return
    if (!window.confirm(`停用“${selectedUser.username}”后，该账户的现有登录会立即失效。是否继续？`)) return
    try {
      const result = await api.suspendAdminUser(selectedUser.id)
      updateUser(result.user)
      await load(false)
      toast.success('账户已停用')
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : '停用账户失败')
    }
  }

  const activateUser = async () => {
    if (!selectedUser || selectedUser.id === session.user?.id) return
    try {
      const result = await api.activateAdminUser(selectedUser.id)
      updateUser(result.user)
      await load(false)
      toast.success('账户已恢复')
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : '恢复账户失败')
    }
  }

  if (sessionLoading || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />正在打开站长后台…</div>
  }

  if (!session.authenticated) {
    return <AccessState title="请先登录" description="登录站长账户后才能打开控制台。" action={<Button render={<Link href="/login" />} nativeButton={false}>前往登录</Button>} />
  }

  if (!isStationMaster) {
    return <AccessState title="这里是站长工作区" description="当前账户没有站长权限。普通用户的数据仍然只在自己的账户范围内可见。" action={<Button variant="outline" render={<Link href="/" />} nativeButton={false}>返回作品库</Button>} />
  }

  if (error && !overview) {
    return <AccessState title="后台暂时不可用" description={error} action={<Button onClick={() => void load()}><RefreshCw data-icon="inline-start" />重试</Button>} />
  }

  return (
    <div className="relative overflow-hidden bg-[radial-gradient(circle_at_8%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_32rem)]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-10">
        <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.12em] text-primary uppercase"><ShieldCheck className="size-4" />站长工作台</div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground md:text-4xl">把每个账号的状态看清楚</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">账户运营、数据概览和敏感操作记录都集中在这里。密钥只显示配置状态，不会回显完整内容。</p>
          </div>
          <Button variant="outline" className="rounded-full self-start sm:self-auto" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={cn(refreshing && 'animate-spin')} />刷新数据</Button>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/15 bg-primary/[0.045] p-2">
          {([
            ['overview', '总览', Activity],
            ['users', '用户管理', UsersRound],
            ['data', '跨账号数据', Database],
            ['audit', '审计日志', FileClock],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={cn('inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors', tab === value ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground')}><Icon className="size-4" />{label}</button>
          ))}
          <span className="ml-auto hidden items-center gap-1.5 px-3 text-xs text-muted-foreground sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-500" />以 {session.user?.username} 身份管理</span>
        </div>

        {tab === 'overview' && <OverviewPanel overview={overview} auditLogs={auditLogs} onOpenUsers={() => setTab('users')} />}
        {tab === 'users' && <UsersPanel users={users} total={usersTotal} query={query} status={status} onQueryChange={setQuery} onStatusChange={setStatus} onSearch={() => void load()} onOpenUser={(user) => void openUser(user)} />}
        {tab === 'data' && <AdminDataPanel />}
        {tab === 'audit' && <AuditPanel logs={auditLogs} total={auditTotal} />}
      </div>

      <UserSheet user={selectedUser} currentUserId={session.user?.id ?? 0} onOpenChange={(open) => !open && setSelectedUser(null)} onSuspend={() => void suspendUser()} onActivate={() => void activateUser()} onReset={async (password) => {
        if (!selectedUser) return
        const result = await api.resetAdminUserPassword(selectedUser.id, password)
        updateUser(result.user)
        await load(false)
        toast.success('临时密码已更新，旧登录已失效')
      }} onClearAi={async () => {
        if (!selectedUser || !window.confirm('清理后，该用户保存的 AI 密钥将无法继续使用。是否继续？')) return
        const result = await api.clearAdminUserAiSecrets(selectedUser.id)
        updateUser(result.user)
        await load(false)
        toast.success('已清理该账户的 AI 密钥')
      }} />
    </div>
  )
}

function AccessState({ title, description, action }: { title: string; description: string; action: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-12"><Empty className="border border-dashed border-border bg-card/60 py-16"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader><EmptyContent>{action}</EmptyContent></Empty></div>
}

function OverviewPanel({ overview, auditLogs, onOpenUsers }: { overview: AdminOverview | null; auditLogs: AdminAuditLog[]; onOpenUsers: () => void }) {
  if (!overview) return null
  const cards = [
    { label: '全部用户', value: overview.users.total, note: `${overview.users.active} 个活跃`, icon: UsersRound, tone: 'bg-primary/10 text-primary' },
    { label: '停用账户', value: overview.users.disabled, note: '默认保留数据', icon: Ban, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    { label: '冒险会话', value: overview.resources.conversations || 0, note: '跨账号汇总', icon: MessageSquareText, tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
    { label: '审计事件', value: auditLogs.length, note: '最近一页记录', icon: FileClock, tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  ]
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, note, icon: Icon, tone }) => <Card key={label} className="rounded-2xl"><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-serif text-3xl font-bold tracking-tight">{value.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div><span className={cn('flex size-10 items-center justify-center rounded-xl', tone)}><Icon className="size-5" /></span></CardContent></Card>)}</div>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <Card className="rounded-2xl"><CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>站点数据脉搏</CardTitle><CardDescription>当前数据库里各类内容的数量。</CardDescription></div><Database className="size-5 text-primary/70" /></div></CardHeader><CardContent className="grid grid-cols-2 gap-x-5 gap-y-5 p-5 sm:grid-cols-3">{Object.entries(overview.resources).map(([key, value]) => <div key={key}><p className="text-xs text-muted-foreground">{resourceLabels[key] || key}</p><p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p></div>)}</CardContent></Card>
      <Card className="rounded-2xl"><CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>账户结构</CardTitle><CardDescription>站长权限只授予一个受控账户。</CardDescription></div><ShieldCheck className="size-5 text-primary/70" /></div></CardHeader><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between rounded-xl bg-muted/55 px-4 py-3"><span className="text-sm text-muted-foreground">站长账户</span><Badge variant="secondary" className="rounded-full">{overview.users.station_masters} 个</Badge></div><div className="flex items-center justify-between rounded-xl bg-muted/55 px-4 py-3"><span className="text-sm text-muted-foreground">活跃比例</span><span className="font-mono text-sm">{overview.users.total ? Math.round((overview.users.active / overview.users.total) * 100) : 0}%</span></div><Button variant="outline" className="w-full rounded-xl" onClick={onOpenUsers}>查看用户管理<ChevronRight data-icon="inline-end" /></Button></CardContent></Card>
    </div>
    <AuditPreview logs={auditLogs} />
  </div>
}

function UsersPanel({ users, total, query, status, onQueryChange, onStatusChange, onSearch, onOpenUser }: { users: AdminUser[]; total: number; query: string; status: 'all' | 'active' | 'disabled'; onQueryChange: (value: string) => void; onStatusChange: (value: 'all' | 'active' | 'disabled') => void; onSearch: () => void; onOpenUser: (user: AdminUser) => void }) {
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium tracking-[0.12em] text-primary uppercase">Accounts</p><h2 className="mt-1 font-serif text-2xl font-bold">用户管理</h2><p className="mt-1 text-sm text-muted-foreground">搜索、查看和维护账户状态；停用会立即撤销该用户的登录。</p></div><Badge variant="outline" className="w-fit rounded-full px-3 py-1">共 {total} 个账户</Badge></div>
    <Card className="rounded-2xl"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }} placeholder="搜索用户名或用户 ID" className="h-10 rounded-xl pl-9" /></div><div className="flex gap-2"><select value={status} onChange={(event) => onStatusChange(event.target.value as typeof status)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><option value="all">全部状态</option><option value="active">活跃</option><option value="disabled">已停用</option></select><Button className="h-10 rounded-xl" onClick={onSearch}><Search />搜索</Button></div></CardContent></Card>
    <Card className="overflow-hidden rounded-2xl"><div className="hidden grid-cols-[minmax(15rem,1.4fr)_7rem_8rem_9rem_2rem] gap-4 border-b border-border/60 bg-muted/35 px-5 py-3 text-xs font-medium text-muted-foreground md:grid"><span>账户</span><span>状态</span><span>内容</span><span>最近活动</span><span /></div><div className="divide-y divide-border/60">{users.length ? users.map((user) => <button key={user.id} type="button" className="group grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/35 md:grid-cols-[minmax(15rem,1.4fr)_7rem_8rem_9rem_2rem] md:items-center md:gap-4 md:px-5" onClick={() => onOpenUser(user)}><div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{user.username.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="truncate font-medium text-foreground">{user.username}</span>{user.role === 'station_master' && <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">站长</Badge>}</span><span className="mt-0.5 block text-xs text-muted-foreground">ID {user.id} · 注册于 {formatTime(user.created_at)}</span></span></div><div><Badge variant={user.is_active ? 'secondary' : 'outline'} className={cn('rounded-full', user.is_active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>{user.is_active ? '活跃' : '已停用'}</Badge></div><div className="flex gap-1 text-xs text-muted-foreground"><span>{user.counts.cards} 卡</span><span>·</span><span>{user.counts.works} 作</span></div><div className="text-xs text-muted-foreground">{formatTime(user.last_seen_at)}</div><ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" /></button>) : <Empty className="border-0 py-16"><EmptyHeader><EmptyMedia variant="icon"><UsersRound /></EmptyMedia><EmptyTitle>没有匹配的账户</EmptyTitle><EmptyDescription>换一个用户名或状态筛选试试。</EmptyDescription></EmptyHeader></Empty>}</div></Card>
  </div>
}

function AuditPanel({ logs, total }: { logs: AdminAuditLog[]; total: number }) {
  return <div className="space-y-5"><div><p className="text-xs font-medium tracking-[0.12em] text-primary uppercase">Trace</p><h2 className="mt-1 font-serif text-2xl font-bold">审计日志</h2><p className="mt-1 text-sm text-muted-foreground">所有站长写操作只记录脱敏摘要，不保存密码、Token 或密钥。</p></div><Card className="rounded-2xl"><CardHeader className="border-b border-border/60"><CardTitle>最近操作</CardTitle><CardDescription>共记录 {total} 条事件</CardDescription></CardHeader><CardContent className="p-0">{logs.length ? <div className="divide-y divide-border/60">{logs.map((log) => <AuditRow key={log.id} log={log} />)}</div> : <Empty className="border-0 py-16"><EmptyHeader><EmptyMedia variant="icon"><FileClock /></EmptyMedia><EmptyTitle>还没有审计记录</EmptyTitle><EmptyDescription>站长执行第一次账户操作后，记录会显示在这里。</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></div>
}

function AuditPreview({ logs }: { logs: AdminAuditLog[] }) {
  return <Card className="rounded-2xl"><CardHeader className="border-b border-border/60"><div className="flex items-start justify-between gap-3"><div><CardTitle>最近操作</CardTitle><CardDescription>账户变更会留下可追溯记录。</CardDescription></div><FileClock className="size-5 text-primary/70" /></div></CardHeader><CardContent className="p-0">{logs.length ? <div className="divide-y divide-border/60">{logs.slice(0, 4).map((log) => <AuditRow key={log.id} log={log} compact />)}</div> : <p className="px-5 py-8 text-sm text-muted-foreground">暂无操作记录。</p>}</CardContent></Card>
}

function AuditRow({ log, compact = false }: { log: AdminAuditLog; compact?: boolean }) {
  return <div className={cn('flex gap-3 px-5 py-4', compact && 'py-3.5')}><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium text-foreground">{formatAction(log.action)}</span><span className="text-xs text-muted-foreground">{log.actor_username}{log.target_username ? ` → ${log.target_username}` : ''}</span></div><p className="mt-1 text-xs text-muted-foreground">{formatTime(log.created_at)} · {log.request_ip || '本机操作'}</p></div></div>
}

function UserSheet({ user, currentUserId, onOpenChange, onSuspend, onActivate, onReset, onClearAi }: { user: AdminUser | null; currentUserId: number; onOpenChange: (open: boolean) => void; onSuspend: () => void; onActivate: () => void; onReset: (password: string) => Promise<void>; onClearAi: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const canOperate = Boolean(user && user.id !== currentUserId && user.role !== 'station_master')

  useEffect(() => setPassword(''), [user?.id])

  const reset = async () => {
    if (!user || password.length < 10) {
      toast.error('临时密码至少需要 10 个字符')
      return
    }
    setWorking('password')
    try {
      await onReset(password)
      setPassword('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重置密码失败')
    } finally {
      setWorking(null)
    }
  }

  const clearAi = async () => {
    setWorking('ai')
    try {
      await onClearAi()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理 AI 密钥失败')
    } finally {
      setWorking(null)
    }
  }

  return <Sheet open={Boolean(user)} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg"><SheetHeader className="border-b border-border/60 px-5 py-6 pr-14 sm:px-7"><div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">{user?.username.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><SheetDescription className="text-xs tracking-[0.12em] uppercase">账户详情</SheetDescription><SheetTitle className="mt-1 truncate font-serif text-2xl">{user?.username}</SheetTitle></div></div>{user && <div className="mt-4 flex flex-wrap gap-2"><Badge variant={user.is_active ? 'secondary' : 'outline'} className={cn('rounded-full', user.is_active && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>{user.is_active ? '活跃账户' : '已停用'}</Badge>{user.role === 'station_master' && <Badge variant="secondary" className="rounded-full">站长</Badge>}</div>}</SheetHeader>{user && <div className="space-y-6 px-5 py-6 sm:px-7"><section><p className="mb-3 text-sm font-semibold">使用概览</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries({ 角色卡: user.counts.cards, 世界书: user.counts.worldbooks, 作品: user.counts.works, 会话: user.counts.conversations }).map(([label, value]) => <div key={label} className="rounded-xl bg-muted/55 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}</div></section><section className="rounded-2xl border border-border/70 p-4"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="size-4" /></span><div className="min-w-0 flex-1"><p className="font-medium">AI 连接</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{user.ai.api_key_set ? `已配置 · ${user.ai.active_provider_count}/${user.ai.provider_count} 个连接启用` : '未配置 API 密钥'}。后台不会显示完整密钥。</p>{(user.ai.providers.length > 0 || user.ai.legacy) && <div className="mt-3 space-y-1.5">{user.ai.providers.map((provider) => <div key={provider.provider_id} className="rounded-lg bg-muted/55 px-3 py-2 text-xs"><span className="font-medium">{provider.display_name}</span><span className="text-muted-foreground"> · {provider.model} · {provider.is_active ? '当前启用' : '未启用'}</span></div>)}{user.ai.legacy && <div className="rounded-lg bg-muted/55 px-3 py-2 text-xs"><span className="font-medium">{user.ai.legacy.display_name}</span><span className="text-muted-foreground"> · {user.ai.legacy.model || '未指定模型'}</span></div>}</div>}</div></div>{canOperate && <Button variant="outline" size="sm" className="mt-4 w-full rounded-xl" onClick={() => void clearAi()} disabled={working !== null}>{working === 'ai' ? <LoaderCircle className="animate-spin" /> : <KeyRound />}清理该账户的 AI 密钥</Button>}</section><section className="rounded-2xl border border-border/70 p-4"><div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"><UserRound className="size-4" /></span><div><p className="font-medium">账户状态</p><p className="mt-1 text-xs leading-5 text-muted-foreground">注册于 {formatTime(user.created_at)}，最近活动 {formatTime(user.last_seen_at)}。</p></div></div>{canOperate && <div className="mt-4 flex gap-2">{user.is_active ? <Button variant="destructive" className="flex-1 rounded-xl" onClick={onSuspend}>停用账户</Button> : <Button className="flex-1 rounded-xl" onClick={onActivate}><Check />恢复账户</Button>}</div>}</section>{canOperate && <section className="rounded-2xl border border-border/70 p-4"><p className="font-medium">重置密码</p><p className="mt-1 text-xs leading-5 text-muted-foreground">旧会话会立即失效。临时密码只会由你在这里设置，不会写入审计日志。</p><div className="mt-3 flex gap-2"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入新的临时密码" className="h-9 rounded-xl" /><Button size="sm" className="h-9 rounded-xl" onClick={() => void reset()} disabled={working !== null}>{working === 'password' ? <LoaderCircle className="animate-spin" /> : '更新'}</Button></div></section>}<Alert className="rounded-xl"><ShieldCheck className="size-4" /><AlertTitle>隐私边界</AlertTitle><AlertDescription>站长可以管理账户数据，但不会看到密码哈希、Session Token 或 API Key。</AlertDescription></Alert></div>}</SheetContent></Sheet>
}
