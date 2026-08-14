# API contract：账号、隔离、SSE 与兼容语义

本文不是完整 API 清单。路由、请求模型、响应模型和错误码以当前代码、OpenAPI schema 及测试为准；本文记录不可随意改变的安全边界、流式协议和历史兼容语义。所有请求均使用 JSON 和 `snake_case` 字段。

## 认证与 CSRF

- `GET /api/auth/csrf` 初始化或刷新 CSRF Cookie，返回不含秘密的 `csrf_token`。
- `GET /api/auth/me` 返回当前账号和 `legacy_claim_pending` 状态。
- `POST /api/auth/register`、`POST /api/auth/login` 建立会话；`POST /api/auth/logout` 清除会话；`PUT /api/auth/password` 修改当前账号密码。
- 会话 Cookie 名为 `neko_session`，应为 HttpOnly、SameSite=Lax；CSRF Cookie 名为 `neko_csrf`，用于双提交校验。客户端不得把密码、会话值或 API key 写入日志。
- 浏览器写请求必须带 `Origin` 或 `Referer`，且与配置的 public origin 同源；同时带 `X-CSRF-Token`，其值必须匹配 CSRF Cookie。`GET` 资源读取不替代鉴权。
- 未登录、密码错误、CSRF 失败、来源不可信和迁移未完成分别由当前实现返回统一 `{"error":{"code","message"}}` 错误；具体 HTTP 状态以 OpenAPI 和测试为准。

## 公共资源与所有者

角色卡、世界书、世界书条目和作品可被其他账号读取。公共列表/详情投影包含 `owner_username`、`can_edit`；它们不代表跨账号写权限。

- `POST`、`PUT`、`DELETE` 及导入接口需要已登录账号、CSRF 和可信来源。
- 只有资源所有者能修改或删除资源；其他账号的写请求返回禁止错误，不能通过客户端传入 `owner_user_id` 绕过校验。
- 资源被作品引用时删除会返回 `resource_in_use` 及引用信息，而不是静默破坏作品。
- 旧 `card_id` 仍兼容；新的 `card_ids` 保持有序。会话创建时冻结角色卡快照。

## 私有会话、快照和个人设置

会话、消息、状态、corrections、快照、分支及其内部字段都按当前登录账号过滤。跨账号读取统一按不可见资源处理（通常为 404），不得泄露标题、消息、快照元数据或存在性；跨账号的 chat、stop、模型设置和状态写入在副作用前拒绝。

- `GET/PUT /api/config` 只作用于当前账号的 AI 设置；返回 `api_key_set` 等状态，不返回原始 key。
- `GET /api/models` 使用当前账号的设置；`POST /api/models/preview` 只测试请求体中的临时配置，不保存也不回显原始 key。
- AI key 在服务端加密保存；测试和日志只能使用“已设置/未设置”等布尔状态。

## SSE 流式事件

聊天接口返回 `text/event-stream`。每个事件由 `event` 行、一个 JSON `data` 行和空行组成。前端将 `meta`、`delta`、`context`、`state`、`done`、`error` 分别交给对应的事件处理器。

普通 AI 生成的顺序为：

1. 可选的 `context` 压缩事件：请求压缩前为 `status: "compressing"`，完成后为 `status: "compressed"` 或 `status: "fallback"`。
2. `meta`：空的 assistant 消息创建后发送，包含会话和消息标识。
3. 零个或多个 `delta`：只发送过滤后的可见文本。
4. `state`：状态变化持久化、自动存档完成后发送。
5. `done`：发送消息标识、用量和可用选项。

快捷指令流不包含上下文压缩事件，顺序为 `meta → delta → state → done`。

DeepSeek/provider 失败时，已生成的可见部分仍会持久化，并发送 `error`；不要把 provider 错误当作正常的 `state → done` 终止序列。停止请求设置当前会话的进程内停止事件，生成器在下一个 provider chunk 处收束，保存停止状态后发送最终 `state` 和 `done`。

聊天和 stop 都必须使用同一账号的会话访问上下文；进程内生成锁意味着应用必须以单 Uvicorn worker 运行。

## 迁移与恢复

第一次注册会在事务中认领旧数据库中没有 owner 的资源，并把旧配置中的 API key 加密到该账号。迁移状态公开为 pending 时，系统允许必要的恢复/认证操作，但拒绝会产生新写入的请求；必须先恢复主密钥或完成密钥清理，再重试业务写请求。备份恢复应成对恢复数据目录和 Fernet 主密钥文件，不要直接编辑 `data/app.db`。

## 兼容字段

### 作品角色卡

- `card_id` 是旧的单角色字段，仍必须接受；没有更高优先级的 `card_ids` 时会归一化为一个有序角色。
- `card_ids` 是新的有序角色数组。显式传入 `[]` 表示作品不使用角色卡，不能回退到旧 `card_id` 或实时作品数据。
- 会话创建后冻结角色卡快照；之后编辑角色卡不改写已有会话。

### 会话快照

- `card_snapshot` 保留旧的单对象快照语义。
- `card_snapshots` 是新的有序快照数组；数组非空时按其顺序使用，明确的空数组表示有效的“无角色”会话。
- 旧会话在没有冻结快照时，仍可通过 `work_id`/`card_id` 兼容解析；一旦存在冻结快照，不得回退到实时角色卡。

### corrections 与存档私有字段

- 会话 corrections 在仓储层规范化为数组。
- 旧 snapshot 的 `persona_corrections` 或 `memory_corrections` 为 `NULL`，表示该存档产生于 corrections 捕获功能之前；恢复时不能把它误当成明确的空数组。
- 新 snapshot 的 `[]` 表示已经捕获且明确为空，必须和旧的 `NULL` 保持可区分。
- snapshot 的 `messages`、`memory_summary`、覆盖序号和 corrections 是恢复使用的私有字段；公共存档列表不暴露它们。

### 前端离线兼容

现有 localStorage 键和迁移形状属于兼容面，清理或重构不得改名或删除：

- `adventure_mock_data`
- `adventure_mock_settings`
- `adventure_api_key_draft`
- `adventure_theme`
- `adventure_age_confirmed`
- `adventure_reply_length:<conversationId>`

更多基线证据见 [`docs/superpowers/baselines/2026-08-12-cleanup-baseline.md`](superpowers/baselines/2026-08-12-cleanup-baseline.md)。
