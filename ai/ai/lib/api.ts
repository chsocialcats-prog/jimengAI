export class ApiError extends Error {
  status: number
  code: string
  details: unknown

  constructor(message: string, { status = 0, code = 'api_error', details = null }: {
    status?: number
    code?: string
    details?: unknown
  } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type ApiUser = {
  id: number
  username: string
  avatar_url: string
  created_at: string
}

export type AuthSession = {
  authenticated: boolean
  user: ApiUser | null
  legacy_claim_pending?: boolean
}

export type ReplyTemplate = {
  id: string
  name: string
  content: string
}

export type OnboardingField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  default?: string
  options?: string[]
}

export type OnboardingConfig = {
  enabled?: boolean
  intro?: string
  allow_freeform?: boolean
  fields?: OnboardingField[]
}

export type RoleCard = {
  id: number
  name: string
  avatar_url: string
  persona: string
  personality: string
  speaking_style: string
  relationships: Record<string, unknown>
  directives: unknown[]
  initial_state: Record<string, unknown>
  character_attributes: Record<string, unknown>
  source: string
  owner_username: string
  can_edit: boolean
  created_at: string
  updated_at: string
  referencing_works?: Array<{ id: number; title: string }>
}

export type WorldbookEntry = {
  id: number
  worldbook_id: number
  title: string
  keywords: string[]
  content: string
  priority: number
  enabled: boolean
  can_edit: boolean
}

export type Worldbook = {
  id: number
  title: string
  description: string
  owner_username: string
  can_edit: boolean
  created_at: string
  updated_at: string
  entries?: WorldbookEntry[]
  referencing_works?: Array<{ id: number; title: string }>
}

export type Work = {
  id: number
  title: string
  description: string
  card_id: number | null
  card_ids: number[]
  cards: RoleCard[]
  player_attributes: Record<string, unknown>
  worldbook_id: number | null
  opening: string
  tags: string[]
  onboarding: OnboardingConfig
  cover_url: string
  reply_templates: ReplyTemplate[]
  active_reply_template_id: string
  is_archive: boolean
  owner_username: string
  can_edit: boolean
  created_at: string
  updated_at: string
}

export type Conversation = {
  id: number
  work_id: number | null
  title: string
  status: 'active' | 'archived'
  current_state: AdventureState
  onboarding_status: 'pending' | 'completed'
  onboarding_config: OnboardingConfig
  onboarding_answers: Record<string, string>
  card_snapshot: RoleCard | Record<string, never>
  card_snapshots: RoleCard[]
  parent_conversation_id?: number | null
  branch_label?: string
  created_at: string
  updated_at: string
  last_message_at?: string | null
}

export type StoryMessage = {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  sequence: number
  metadata: Record<string, unknown>
  token_count: number
  created_at: string
}

export type AdventureState = {
  conversation_id?: number
  attributes: Record<string, unknown>
  items: unknown[]
  money: number
  relations: Record<string, unknown>
  quests: Array<Record<string, unknown>>
  flags: unknown[]
  characters: Record<string, { attributes?: Record<string, unknown>; flags?: unknown[] }>
  logs: Array<Record<string, unknown>>
  updated_at?: string
}

export type Snapshot = {
  id: number
  conversation_id: number
  name: string
  note: string
  branch_label: string
  created_at: string
}

export type RollResult = {
  message: StoryMessage
  state: AdventureState
}

export type Settings = {
  api_key_set?: boolean
  api_key_unreadable?: boolean
  deepseek?: {
    base_url?: string
    model?: string
    api_key?: string
    clear_api_key?: boolean
    timeout_seconds?: number
  }
  generation?: {
    temperature?: number
    max_tokens?: number
    reasoning_effort?: string
    context_window_tokens?: number
    compression_trigger_ratio?: number
    compression_keep_recent_messages?: number
    compression_summary_max_tokens?: number
  }
}

type Paginated<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

type RequestOptions = {
  method?: string
  body?: unknown
  headers?: HeadersInit
  retryCsrf?: boolean
}

export type UploadedImage = {
  url: string
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let csrfToken: string | null = null

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toApiError(body: unknown, status: number) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { message?: unknown; code?: unknown; details?: unknown } }).error
    return new ApiError(
      typeof error?.message === 'string' ? error.message : '请求失败',
      {
        status,
        code: typeof error?.code === 'string' ? error.code : 'api_error',
        details: error?.details,
      },
    )
  }
  return new ApiError(typeof body === 'string' ? body : `请求失败（HTTP ${status}）`, { status })
}

async function refreshCsrf() {
  const response = await fetch('/api/auth/csrf', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  const body = await parseBody(response)
  if (!response.ok) throw toApiError(body, response.status)
  const token = body && typeof body === 'object' ? (body as { csrf_token?: unknown }).csrf_token : null
  if (typeof token !== 'string' || !token) {
    throw new ApiError('服务未返回有效安全令牌', { code: 'csrf_unavailable', status: response.status })
  }
  csrfToken = token
  return token
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  const unsafe = unsafeMethods.has(method)
  if (unsafe && !csrfToken) await refreshCsrf()

  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (unsafe && csrfToken) headers.set('X-CSRF-Token', csrfToken)

  let body: BodyInit | undefined
  if (options.body !== undefined && options.body !== null) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    const isUrlSearchParams = typeof URLSearchParams !== 'undefined' && options.body instanceof URLSearchParams
    const isBlob = typeof Blob !== 'undefined' && options.body instanceof Blob
    if (typeof options.body === 'string' || isFormData || isUrlSearchParams || isBlob) {
      body = options.body as BodyInit
    } else {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(options.body)
    }
  }

  let response: Response
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' })
  } catch {
    throw new ApiError('无法连接到服务', { code: 'network_error' })
  }
  const parsed = await parseBody(response)
  if (response.ok) return parsed as T

  const error = toApiError(parsed, response.status)
  if (unsafe && error.code === 'csrf_failed' && options.retryCsrf !== false) {
    csrfToken = null
    await refreshCsrf()
    return request<T>(path, { ...options, retryCsrf: false })
  }
  throw error
}

async function requestStream(path: string, body: unknown) {
  if (!csrfToken) await refreshCsrf()
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify(body),
  })
  if (response.ok && response.body) return response
  const parsed = await parseBody(response)
  const error = toApiError(parsed, response.status)
  if (error.code === 'csrf_failed') {
    csrfToken = null
    await refreshCsrf()
    return requestStream(path, body)
  }
  throw error
}

async function listAll<T>(path: string, parameters: Record<string, string | number | undefined> = {}) {
  const items: T[] = []
  let page = 1
  const pageSize = 100
  while (true) {
    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    const result = await request<Paginated<T>>(`${path}?${query.toString()}`)
    items.push(...(result.items || []))
    if (items.length >= result.total || (result.items || []).length < pageSize) return items
    page += 1
  }
}

export type StreamHandlers = {
  onMeta?: (data: Record<string, unknown>) => void
  onDelta?: (content: string) => void
  onContext?: (data: Record<string, unknown>) => void
  onState?: (data: { current_state?: AdventureState } & Record<string, unknown>) => void
  onDone?: (data: Record<string, unknown>) => void
  onError?: (message: string) => void
  onFinish?: () => void
}

export async function streamChat(conversationId: number, content: string, handlers: StreamHandlers, metadata: Record<string, unknown> = {}) {
  let response: Response
  try {
    response = await requestStream(`/api/conversations/${conversationId}/chat`, { content, metadata })
  } catch (error) {
    handlers.onError?.(error instanceof Error ? error.message : '无法开始对话')
    handlers.onFinish?.()
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    handlers.onError?.('对话流不可用')
    handlers.onFinish?.()
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  const processLine = (line: string) => {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      return
    }
    if (!line.startsWith('data:')) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
    } catch {
      return
    }
    if (eventName === 'meta') handlers.onMeta?.(data)
    if (eventName === 'delta') handlers.onDelta?.(typeof data.content === 'string' ? data.content : '')
    if (eventName === 'context') handlers.onContext?.(data)
    if (eventName === 'state') handlers.onState?.(data as { current_state?: AdventureState } & Record<string, unknown>)
    if (eventName === 'done') handlers.onDone?.(data)
    if (eventName === 'error') handlers.onError?.(typeof data.message === 'string' ? data.message : '生成失败')
    eventName = ''
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      lines.forEach(processLine)
    }
    buffer += decoder.decode()
    buffer.split(/\r?\n/).forEach(processLine)
  } catch (error) {
    handlers.onError?.(error instanceof Error ? error.message : '对话流中断')
  } finally {
    handlers.onFinish?.()
  }
}

export const api = {
  getSession: () => request<AuthSession>('/api/auth/me'),
  login: (username: string, password: string) => request<AuthSession>('/api/auth/login', { method: 'POST', body: { username, password } }),
  register: (username: string, password: string) => request<AuthSession>('/api/auth/register', { method: 'POST', body: { username, password } }),
  logout: () => request<null>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) => request<AuthSession>('/api/auth/password', { method: 'PUT', body: { current_password: currentPassword, new_password: newPassword } }),
  updateProfile: (payload: { avatar_url: string }) => request<AuthSession>('/api/auth/profile', { method: 'PUT', body: payload }),
  uploadImage: (file: File) => request<UploadedImage>('/api/uploads/images', {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  }),

  listWorks: (query = '', tag = '') => listAll<Work>('/api/works', { q: query, tag }),
  getWork: (id: number) => request<Work>(`/api/works/${id}`),
  createWork: (payload: Partial<Work> & { title: string }) => request<Work>('/api/works', { method: 'POST', body: payload }),
  updateWork: (id: number, payload: Partial<Work>) => request<Work>(`/api/works/${id}`, { method: 'PUT', body: payload }),
  deleteWork: (id: number) => request<null>(`/api/works/${id}`, { method: 'DELETE' }),

  listCards: (query = '') => listAll<RoleCard>('/api/cards', { q: query }),
  getCard: (id: number) => request<RoleCard>(`/api/cards/${id}`),
  createCard: (payload: Partial<RoleCard> & { name: string }) => request<RoleCard>('/api/cards', { method: 'POST', body: payload }),
  updateCard: (id: number, payload: Partial<RoleCard>) => request<RoleCard>(`/api/cards/${id}`, { method: 'PUT', body: payload }),
  deleteCard: (id: number) => request<null>(`/api/cards/${id}`, { method: 'DELETE' }),
  importCardText: (text: string) => request<{ card: RoleCard; worldbook: Worldbook; work: Work }>('/api/imports/card-text', { method: 'POST', body: { text } }),

  listWorldbooks: () => listAll<Worldbook>('/api/worldbooks'),
  getWorldbook: (id: number) => request<Worldbook>(`/api/worldbooks/${id}`),
  createWorldbook: (payload: { title: string; description?: string }) => request<Worldbook>('/api/worldbooks', { method: 'POST', body: payload }),
  updateWorldbook: (id: number, payload: Partial<Worldbook>) => request<Worldbook>(`/api/worldbooks/${id}`, { method: 'PUT', body: payload }),
  deleteWorldbook: (id: number) => request<null>(`/api/worldbooks/${id}`, { method: 'DELETE' }),
  createWorldbookEntry: (worldbookId: number, payload: Partial<WorldbookEntry> & { title: string }) => request<WorldbookEntry>(`/api/worldbooks/${worldbookId}/entries`, { method: 'POST', body: payload }),
  updateWorldbookEntry: (worldbookId: number, entryId: number, payload: Partial<WorldbookEntry>) => request<WorldbookEntry>(`/api/worldbooks/${worldbookId}/entries/${entryId}`, { method: 'PUT', body: payload }),
  deleteWorldbookEntry: (worldbookId: number, entryId: number) => request<null>(`/api/worldbooks/${worldbookId}/entries/${entryId}`, { method: 'DELETE' }),

  listConversations: (workId?: number) => listAll<Conversation>('/api/conversations', { work_id: workId }),
  getConversation: (id: number) => request<Conversation>(`/api/conversations/${id}`),
  createConversation: (workId: number, title: string) => request<Conversation>('/api/conversations', { method: 'POST', body: { work_id: workId, title } }),
  updateConversation: (id: number, title: string) => request<Conversation>(`/api/conversations/${id}`, { method: 'PUT', body: { title } }),
  deleteConversation: (id: number) => request<null>(`/api/conversations/${id}`, { method: 'DELETE' }),
  archiveConversation: (id: number) => request<Conversation>(`/api/conversations/${id}/archive`, { method: 'POST' }),
  restoreConversation: (id: number) => request<Conversation>(`/api/conversations/${id}/restore`, { method: 'POST' }),
  completeOnboarding: (id: number, answers: Record<string, string>) => request<Conversation>(`/api/conversations/${id}/onboarding`, { method: 'POST', body: { answers } }),
  addCorrection: (id: number, kind: string, content: string) => request<Conversation>(`/api/conversations/${id}/corrections`, { method: 'POST', body: { kind, content } }),
  getMessages: (id: number) => request<Paginated<StoryMessage> | StoryMessage[]>(`/api/conversations/${id}/messages`).then((result) => Array.isArray(result) ? result : result.items || []),
  getState: (id: number) => request<AdventureState>(`/api/conversations/${id}/state`),
  updateState: (id: number, changes: Partial<AdventureState>) => request<AdventureState>(`/api/conversations/${id}/state`, { method: 'PUT', body: changes }),
  roll: (id: number, payload: { dice?: string; target?: number; attribute?: string; reason?: string }) => request<RollResult>(`/api/conversations/${id}/roll`, { method: 'POST', body: payload }),
  stopConversation: (id: number) => request<null>(`/api/conversations/${id}/stop`, { method: 'POST' }),
  listSnapshots: (id: number) => request<Paginated<Snapshot>>(`/api/conversations/${id}/snapshots`).then((result) => result.items || []),
  createSnapshot: (id: number, name: string, note = '') => request<Snapshot>(`/api/conversations/${id}/snapshots`, { method: 'POST', body: { name, note } }),
  restoreSnapshot: (conversationId: number, snapshotId: number) => request<{ state: AdventureState; conversation: Conversation; messages: StoryMessage[] }>(`/api/conversations/${conversationId}/snapshots/${snapshotId}/restore`, { method: 'POST' }),
  deleteSnapshot: (conversationId: number, snapshotId: number) => request<null>(`/api/conversations/${conversationId}/snapshots/${snapshotId}`, { method: 'DELETE' }),
  createConversationBranch: (id: number, payload: { title: string; branch_label?: string; snapshot_id?: number | null }) => request<Conversation>(`/api/conversations/${id}/branches`, { method: 'POST', body: payload }),

  getSettings: () => request<Settings>('/api/config'),
  saveSettings: (settings: Settings) => request<Settings>('/api/config', { method: 'PUT', body: settings }),
  previewModels: (payload: { base_url?: string; api_key?: string; timeout_seconds?: number }) => request<{ models?: string[]; items?: Array<string | { id?: string }> }>('/api/models/preview', { method: 'POST', body: payload }),
}
