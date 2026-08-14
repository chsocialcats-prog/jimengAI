# 共享内容库账号系统 Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this plan. Every implementation package follows test-driven development. Use superpowers:systematic-debugging for unexpected failures, superpowers:requesting-code-review after each package, and superpowers:verification-before-completion before reporting success.

**Goal:** 把当前单用户应用升级为开放注册的多账号应用：作品、角色卡、世界书全站共享，只有创建者可编辑或删除；会话、消息、状态、存档和 AI 设置严格按账号隔离；访客可以浏览共享内容，但不能写入或开始冒险。

**Architecture:** 在现有 FastAPI + SQLite + 原生前端架构上增加服务端随机会话、CSRF/同源保护、Argon2id 密码、加密的用户 AI 设置和显式所有权查询。首次注册通过可恢复的迁移状态机认领旧数据。前端使用一个统一 API 客户端和认证状态容器；后端不可用时只展示不可变的内置演示数据。

**Tech Stack:** Python、FastAPI、SQLite、pwdlib[argon2]、cryptography、httpx、原生 HTML/CSS/JavaScript、Python unittest、Node node:test。

**Design source:** docs/superpowers/specs/2026-08-13-shared-library-account-system-design.md

---

## 0. 总控规则

- 用户界面和产品错误信息使用 UTF-8 中文；API 字段保持 snake_case。
- 保持统一错误格式：{"error":{"code":"...","message":"..."}}。
- 保持现有 SSE 事件契约、停止生成、单会话互斥、部分消息持久化、结构化输出和自动存档行为。
- 继续只运行一个 Uvicorn worker；本计划不重构进程内锁和 stop event。
- 生产业务函数中的 user_id 必须显式传入，不允许用默认值、可选值或“当前第一个用户”回退。
- 不打印 config.json、环境变量或数据库中的真实 API Key。
- 不修改或提交 data/app.db，不把 data/auth_keys.json 加入版本控制。
- 离线模式只允许读取内置演示数据，不得继续把 localStorage 当作可写用户数据库。
- 当前工作树已有用户修改。每个 Agent 只改自己的文件，遇到重叠必须交回总控 Agent 合并。
- 未获得用户提交授权，因此本计划中的 Agent 不执行 git add、git commit、git push 或创建 PR。
- 每个 Agent 开工和收尾都运行 git status --short，并把非本工作包的改动视为用户资产。
- 测试不得依赖真实网络、真实 DeepSeek Key 或真实 data/app.db。

### 0.1 运行配置名称

所有 Agent 统一使用以下机器级配置，默认值必须适合局域网首版：

| 名称 | 语义 |
|---|---|
| NEKO_DATA_DIR | 数据目录覆盖；默认是项目 data 目录，主要供测试和部署使用 |
| NEKO_AUTH_KEYS | 逗号分隔的主密钥轮换列表；第一项用于新加密 |
| NEKO_AUTH_KEY_PATH | 本地主密钥文件覆盖；默认是 data/auth_keys.json |
| NEKO_COOKIE_SECURE | 是否给会话 Cookie 设置 Secure；局域网 HTTP 默认 false |
| NEKO_PUBLIC_ORIGIN | 部署的精确公共 Origin；配置后用于同源校验 |
| NEKO_TRUSTED_PROXY_CIDRS | 允许信任转发头的代理网段列表；默认空 |
| NEKO_AI_ALLOWED_ORIGINS | 允许用户配置的 AI 服务精确 Origin 白名单 |
| NEKO_AI_HTTPS_ONLY | 是否只允许 HTTPS AI 地址；局域网首版可显式关闭 |

不把用户 AI Key 放入任何机器级环境变量迁移结果；旧 config.json 只作为首次认领的数据源。

### 0.2 冻结的后端接口

后续 Agent 必须复用这些类型和依赖，不另造同义接口：

~~~text
PublicUser(id: int, username: str, created_at: str)
AuthContext(user: PublicUser, session_id: int)
IssuedSession(session_id: int, token: str, absolute_expires_at: str)
ConversationAccess(auth: AuthContext, conversation: dict)

optional_auth(request) -> AuthContext | None
require_auth(request) -> AuthContext
optional_user(request) -> PublicUser | None
require_user(request) -> PublicUser
require_conversation_owner(conversation_id, auth, repository) -> ConversationAccess
~~~

Cookie 名称固定为：

- neko_session：HttpOnly、SameSite=Lax、Path=/；Secure 由 NEKO_COOKIE_SECURE 决定。
- neko_csrf：非 HttpOnly、SameSite=Lax、Path=/；值只作为双提交载体。

安全写请求必须同时满足：

1. Cookie 会话有效。
2. Origin 或 Referer 与服务端允许的精确 Origin 相同。
3. X-CSRF-Token 与签名 CSRF Cookie 相符。

登录、注册和退出也属于安全写请求。匿名客户端先调用 GET /api/auth/csrf。

### 0.3 冻结的 JSON 契约

~~~text
GET /api/auth/csrf
200 {"csrf_token":"..."}

GET /api/auth/me
200 {
  "authenticated": false,
  "user": null,
  "legacy_claim_pending": true
}

POST /api/auth/register
{"username":"alice","password":"..."}

POST /api/auth/login
{"username":"alice","password":"..."}

PUT /api/auth/password
{"current_password":"...","new_password":"..."}

GET /api/config
200 {
  "app":{...},
  "deepseek":{"base_url":"https://...","model":"..."},
  "generation":{...},
  "api_key_set":true,
  "api_key_unreadable":false
}

PUT /api/config
{"deepseek":{"base_url":"https://...","model":"...","api_key":"..."},"generation":{...}}

PUT /api/config
{"deepseek":{"base_url":"https://...","model":"...","clear_api_key":true}}

POST /api/conversations/{conversation_id}/branches
{"snapshot_id":123,"title":"新的分支","branch_label":"另一种选择"}
~~~

GET /api/auth/me 的 legacy_claim_pending 对匿名用户也可见，只暴露布尔值，不暴露旧数据数量或内容。

共享资源列表和详情必须增加：

~~~text
owner_username: string
can_edit: boolean
~~~

访客的 can_edit 恒为 false。登录用户只有在 owner_user_id 等于本人 id 时得到 true。owner_user_id 可以留作内部字段，但公开响应不得依赖前端用它自行授权。

### 0.4 冻结的错误码和 HTTP 语义

| code | HTTP | 使用场景 |
|---|---:|---|
| authentication_required | 401 | 没有有效会话 |
| invalid_credentials | 401 | 用户名或密码错误；不得区分用户名是否存在 |
| csrf_failed | 403 | CSRF、Origin 或 Referer 校验失败 |
| forbidden | 403 | 已登录但不能创建通用受保护动作 |
| not_found | 404 | 私有资源不存在或属于其他用户 |
| username_taken | 409 | 注册用户名已被占用 |
| resource_in_use | 409 | 共享卡片或世界书仍被作品引用 |
| migration_pending | 503 | 首次认领迁移未完成，安全写被全局门禁阻断 |
| secret_key_unavailable | 503 | 已配置密钥无效，或本地密钥文件无法安全创建/读取 |
| api_key_unreadable | 503 | 已存个人 API Key 无法用现有主密钥解密 |
| rate_limited | 429 | 登录或注册限流 |
| ai_origin_not_allowed | 422 | AI Base URL 不满足出站策略 |

resource_in_use 的 details 只返回引用作品的 id 和 title，不返回私有会话信息。

### 0.5 首次认领事务边界

首次注册严格按以下顺序执行：

1. 进入事务前确认主密钥可用，读取旧机器配置，并准备旧有效 AI 配置的加密副本。
2. 在单个 BEGIN IMMEDIATE 数据库事务中创建首个用户。
3. 给全部无主的旧共享资源写入 owner_user_id。
4. 给全部旧会话写入 user_id；消息、状态、记忆、修正和存档通过会话外键继承归属，不重复保存 user_id。
5. 将旧 AI/生成配置及加密 Key 写入 user_ai_settings。
6. 如有配置文件明文 Key，把迁移状态写为 needs_secret_cleanup；否则写为 complete，然后提交。
7. 事务提交后用临时文件和原子替换清除 config.json 中的旧 Key。
8. 清理成功后把迁移状态写为 complete，签发登录会话。

如果第 7 步失败，不能回滚已提交的数据认领，也不能签发会话；应用进入公开只读状态，所有安全写返回 migration_pending。重启时继续清理，不重复认领。旧 Key 若来自 DEEPSEEK_API_KEY 环境变量则无法由程序删除：迁移后允许系统运行，但启动日志只输出不含值的移除警告；任何账号都不得再回退使用该全局 Key。

### 0.6 多 Agent 文件所有权

| Agent | 工作包 | 独占写入范围 |
|---|---|---|
| A | 数据库骨架与依赖 | database.py、account_schema.py、auth/types.py、api_models/__init__.py、requirements.txt、.gitignore、repositories.py 初始门面 |
| B | 认证安全原语 | auth/passwords.py、keyring.py、sessions.py、cookies.py、csrf.py、origin.py、rate_limit.py、runtime_settings.py 及其测试 |
| C | 认证 API 与首次认领 | auth/service.py、account_migration.py、auth/dependencies.py、auth/http_security.py、api_models/auth.py、auth_routes.py、legacy_config.py、main.py 及其测试 |
| D | 共享内容授权 | repository/cards、worldbooks、works、work_bundles，api_models/shared.py，对应路由和测试 |
| E | 私有冒险数据 | conversation/snapshot 仓储、api_models/adventure.py、state/roll/commands 服务、对应路由和测试 |
| F | 用户 AI 设置 | user_ai_settings、api_models/settings.py、出站 URL 策略、settings 路由、deepseek_client.py 和测试 |
| G | 聊天/SSE 汇合 | chat_routes.py、adventure_engine.py、context_service.py 和聊天相关测试 |
| H | 前端基础模块 | 只新增 api-client.mjs、auth-state.mjs、ownership.mjs、read-only-demo.mjs 和对应测试 |
| I | 前端页面集成 | auth/settings/worldbook 页面及现有 index.html、style.css、main.js、data.mjs、adventure-page.mjs、icons.js 和 UI 测试 |
| J | 系统验证与文档 | smoke 测试、README、API 文档、最终范围检查；除测试/文档修正外不改业务实现 |
| 总控 | 串行汇合 | Wave 3 结束后独占 repositories.py 和 schemas.py 兼容门面；只按各包交接清单合并导出 |

同一时间总控 Agent 占用一个槽，因此最多运行三个执行 Agent。若运行环境提供更多槽，也不要突破上述文件所有权。

---

## 1. 执行波次与依赖图

~~~text
Wave 0: A 数据库骨架
            |
Wave 1: B 认证安全原语
            |
Wave 2: C 认证 API 与首次认领
            |
            +---------+---------+
            |         |         |
Wave 3:    D         E         F       （首批三个并行）
            |         |         |
            +----+----+         |
                 |              |
Wave 3b:         H 前端基础模块          （任一槽释放后启动）
                 |
Wave 4:          G 聊天汇合  +  I 前端页面集成
                         （两个 Agent 并行，文件不重叠）
                              |
Wave 5:                       J 系统验证与文档
~~~

调度规则：

- A、B、C 是串行基础链，不并发修改共享底座。
- Wave 3 先启动 D、E、F；H 不依赖它们的文件，可在任一槽释放后启动。
- D、E、F 不修改 repositories.py 或 backend/schemas.py；它们在独立 repository/api_models 模块工作。全部结束后由总控 Agent 串行更新一次 repositories.py 和 schemas.py 兼容门面。
- G 只在 E、F 完成后开始，因为它同时消费会话所有权与有效 AI 配置。
- I 只在 C、D、E、F、H 完成后开始；它是所有已有前端脏文件的唯一集成人。
- J 等全部实现包完成后执行，不允许用宽松测试替代真实隔离验证。

---

## 2. Agent A：数据库骨架与依赖

**目标：** 建立可重复迁移的账号 schema、测试隔离入口和仓储门面，供后续 Agent 并行工作。

**修改文件：**

- backend/database.py
- backend/repositories.py
- backend/config.py
- requirements.txt
- .gitignore

**新增文件：**

- backend/migrations/__init__.py
- backend/migrations/account_schema.py
- backend/auth/__init__.py
- backend/auth/types.py
- backend/api_models/__init__.py
- backend/test_account_schema.py
- backend/test_support/__init__.py
- backend/test_support/accounts.py

### Task A1：先锁定 schema 迁移

- [ ] 在 backend/test_account_schema.py 写 RED 测试：对旧版临时数据库运行两次迁移，验证幂等。
- [ ] 验证新增 users、auth_sessions、user_ai_settings、account_migration_state。
- [ ] 验证 cards、worldbooks、works 增加 owner_user_id。
- [ ] 验证 conversations 增加 user_id；messages、states、memory_summaries、snapshots 等子表继续只通过 conversation_id 继承归属。
- [ ] 验证新建数据库中的必要 NOT NULL/外键/唯一索引；旧库通过迁移期间允许的兼容路径升级。
- [ ] 运行 python -m unittest backend.test_account_schema，确认因实现缺失而 RED。
- [ ] 在 backend/migrations/account_schema.py 实现显式版本迁移和索引。
- [ ] 在 backend/database.py 的初始化路径调用 migrate_account_schema。
- [ ] 再运行窄测试，确认 GREEN。

推荐表字段：

~~~text
users:
  id, username, username_key, password_hash,
  is_active, password_changed_at, created_at, updated_at

auth_sessions:
  id, user_id, token_hash,
  created_at, last_seen_at, absolute_expires_at, revoked_at

user_ai_settings:
  user_id, deepseek_config, generation_config, api_key_ciphertext, updated_at

app_meta:
  key, value, updated_at
~~~

users 还必须包含 username_key、is_active、password_changed_at；唯一索引建立在 username_key。auth_sessions 固定包含 id、user_id、token_hash、created_at、last_seen_at、absolute_expires_at、revoked_at；7 天闲置期由 last_seen_at 推导，不另存一份可能失配的闲置截止时间。迁移状态保存在 app_meta 的 account_migration_state 键中，值只使用 unclaimed、needs_secret_cleanup、complete。

### Task A2：建立可隔离的数据目录

- [ ] 写测试证明 NEKO_DATA_DIR 在进程导入时能改变数据库和本地主密钥默认路径。
- [ ] 在 backend/config.py 解析 PROJECT_ROOT 和 DATA_DIR。
- [ ] backend/database.py 从统一 DATA_DIR 构造 DB_PATH，不再定义第二套数据目录来源。
- [ ] 所有测试继续优先使用现有临时数据库 patch；端到端测试可以通过新环境变量获得完整隔离。

### Task A3：冻结共享类型和测试夹具

- [ ] 在 backend/auth/types.py 定义不可变 PublicUser、AuthContext、IssuedSession、ConversationAccess。
- [ ] 在 backend/test_support/accounts.py 提供 create_test_user、issue_test_session、csrf_headers 等纯测试帮助函数；不得读取真实配置。
- [ ] 建立 backend/api_models 包；跨包公开用户类型只放 backend/auth/types.py，具体 Pydantic 请求/响应模型由各领域 Agent 放入自己的 api_models 模块。

### Task A4：仓储门面与依赖

- [ ] 保持 backend.repositories 的旧导入路径可用。
- [ ] repositories.py 继续作为兼容门面。A 只建立可扩展的显式转发结构；D/E/F 完成后由总控 Agent 串行合并它们交接的导出和新签名。
- [ ] 不在本任务重写仓储业务；只建立不会造成循环导入的门面。
- [ ] requirements.txt 增加以下兼容范围：

~~~text
pwdlib[argon2]>=0.3.0,<0.4.0
cryptography>=49.0.0,<50.0.0
httpx>=0.28.1,<0.29.0
~~~

- [ ] .gitignore 增加 data/auth_keys.json 和测试隔离目录模式。
- [ ] 运行 python -m pip install -r requirements.txt。
- [ ] 运行 python -m unittest backend.test_account_schema。
- [ ] 运行 python -m unittest discover -s backend -p 'test_*.py'，记录本包引入前后的结果。

**交付接口：** migrate_account_schema(connection)、DATA_DIR、四个 auth 类型、稳定的 repositories 门面。

**禁止事项：** 不实现路由、不处理 Cookie、不认领旧数据、不修改前端。

---

## 3. Agent B：认证安全原语

**依赖：** Agent A 完成。

**目标：** 实现可独立测试的密码、密钥、会话、CSRF、Origin 和限流底层，不接业务路由。

**新增文件：**

- backend/auth/errors.py
- backend/auth/passwords.py
- backend/auth/keyring.py
- backend/auth/sessions.py
- backend/auth/cookies.py
- backend/auth/csrf.py
- backend/auth/origin.py
- backend/auth/rate_limit.py
- backend/auth/runtime_settings.py
- backend/test_auth_passwords.py
- backend/test_auth_keyring.py
- backend/test_auth_sessions.py
- backend/test_auth_http_security.py
- backend/test_auth_rate_limit.py

### Task B1：用户名与密码

- [ ] 测试 normalize_username 使用 NFKC、去首尾空格并大小写折叠。
- [ ] 测试用户名长度、允许字符和保留名与设计文档一致。
- [ ] 测试密码规则与最大输入长度，防止超长输入消耗。
- [ ] 测试 hash_password 和 verify_password 使用 pwdlib 的 Argon2id。
- [ ] 测试不存在的用户也走 verify_password_or_dummy，避免明显时序分叉。
- [ ] 实现并让 python -m unittest backend.test_auth_passwords GREEN。

### Task B2：主密钥和用户 Key 加密

- [ ] 测试优先读取 NEKO_AUTH_KEYS，并支持多 Key 解密、首 Key 新加密。
- [ ] 测试未配置环境密钥时原子创建权限受限的 data/auth_keys.json。
- [ ] 测试已有环境变量/本地文件格式损坏或权限失败时返回 secret_key_unavailable，不生成临时进程 Key。
- [ ] 测试本地 Key 文件缺失时原子生成新 Fernet Key；如果数据库已有旧密文，不覆盖密文，而由用户设置层报告 api_key_unreadable，允许用户显式替换或清除。
- [ ] Fernet 主密钥直接交给 MultiFernet 加密用户 Key；另用 HKDF-SHA256 和固定版本化上下文从每把 Fernet Key 派生 CSRF 签名 Key。
- [ ] 用户 Key 使用 cryptography.fernet.MultiFernet；新加密用首 Key，解密依次尝试全部 Key，旧 Key 解密成功后惰性 rotate 到首 Key。
- [ ] 实现 AuthKeyring.load、encrypt、decrypt、rotate、csrf_signing_keys；解密失败不得把密文写入日志。

本地 Key 文件格式固定为：

~~~json
{"version":1,"keys":["base64url-key"]}
~~~

### Task B3：服务端随机会话

- [ ] 测试签发至少 256 bit 随机 token，数据库只存 SHA-256 token_hash。
- [ ] 测试 authenticate_session 同时检查 revoked_at、last_seen_at + 7 天闲置期和创建后 30 天 absolute_expires_at。
- [ ] 测试活动会话最多每 5 分钟刷新一次 last_seen_at；权限判断仍使用真实请求时间。
- [ ] 测试登录永远签发新 token，防止会话固定；logout 只撤销当前会话；改密撤销该用户全部会话。
- [ ] 测试认证时惰性删除过期会话，并提供启动时批量清理过期记录的入口。
- [ ] 所有时间统一为 UTC ISO 字符串，比较前先解析，不比较本地格式文本。
- [ ] Cookie 帮助函数只接受 IssuedSession，不从全局读取用户；明确不设置 Domain。
- [ ] 私有响应和设置 Cookie 的响应增加 Cache-Control: no-store。

### Task B4：CSRF 和同源

- [ ] 测试匿名 GET /csrf 所需的 token 签发原语不依赖登录态。
- [ ] token 载荷包含随机 nonce、签发时间、用途、可选 auth_sessions.id 和 HMAC；默认有效期 30 分钟。
- [ ] verify_csrf 同时校验 Cookie、X-CSRF-Token、签名和常量时间比较。
- [ ] unsafe method 集合固定为 POST、PUT、PATCH、DELETE。
- [ ] 登录前使用匿名用途 token；登录/注册成功后立即轮换为绑定新 session id 的 token。
- [ ] Sec-Fetch-Site=cross-site 时拒绝请求。
- [ ] 精确 Origin 比较包含 scheme、host、规范化端口；拒绝后缀、userinfo、额外路径技巧。
- [ ] 只有来源 IP 落在 NEKO_TRUSTED_PROXY_CIDRS 时才使用转发头。

### Task B5：登录注册限流

- [ ] 实现进程内滑动窗口限流器：IP + 规范化用户名 15 分钟最多 5 次登录失败；同一 IP 15 分钟最多 30 次登录失败；同一 IP 每小时最多 5 次注册尝试。
- [ ] 登录成功只清理对应 IP+用户名失败记录，不清理 IP 总量记录。
- [ ] 返回 Retry-After 响应头和稳定错误体，但不泄露账号是否存在。
- [ ] 单元测试使用注入时钟，不 sleep。

### Task B6：本包验证

- [ ] 分别运行五个新增测试文件。
- [ ] 运行 python -m unittest discover -s backend -p 'test_*.py'。
- [ ] 搜索日志和异常消息，确认没有 token、密码、明文 Key。

**交付接口：** normalize_username、validate_password、hash_password、verify_password_or_dummy、AuthKeyring、SessionService、Cookie helpers、issue_csrf_token、verify_csrf、OriginPolicy、AuthRateLimiter。

**禁止事项：** 不注册 FastAPI 路由、不修改 main.py、不读写 config.json。

---

## 4. Agent C：认证 API 与首次认领

**依赖：** Agent B 完成。

**目标：** 组装认证原语、首次迁移、请求依赖和 FastAPI 生命周期，形成可用账号 API。

**新增文件：**

- backend/auth/service.py
- backend/auth/dependencies.py
- backend/auth/http_security.py
- backend/auth/account_migration.py
- backend/auth/legacy_config.py
- backend/api_models/auth.py
- backend/routers/auth_routes.py
- backend/test_auth_routes.py
- backend/test_account_claim_migration.py
- backend/test_auth_startup_recovery.py

**修改文件：**

- backend/main.py
- backend/config.py（仅增加读取旧配置原始值和安全清理帮助函数；若与 A 冲突由总控合并）

### Task C1：认证服务

- [ ] 写注册 RED 测试：开放注册、用户名冲突、密码校验、首个用户分支。
- [ ] 写登录 RED 测试：成功、统一 invalid_credentials、限流、Cookie 属性。
- [ ] 写 me、logout、PUT /api/auth/password 的 RED 测试。
- [ ] 实现 AuthenticationService.register、login、logout、change_password。
- [ ] 注册用户和用户名唯一性检查必须依赖 username_key 唯一索引处理竞态。
- [ ] 并发注册测试证明只有一个事务能把迁移状态从 unclaimed 推进；后续注册只有在状态 complete 后才继续。

### Task C2：首次认领状态机

- [ ] 用旧 schema fixture 写 RED 测试，覆盖共享资源和全部私有表的 user_id 认领。
- [ ] 覆盖旧 config.json 有 Key、没有 Key、清理成功、清理失败四种情况。
- [ ] 清理失败测试必须证明：数据认领和加密设置已提交、无会话签发、状态为 needs_secret_cleanup、安全写门禁打开。
- [ ] 覆盖旧 Key 只来自 DEEPSEEK_API_KEY 的情况：完成一次性继承，输出不含值的运维警告，迁移后不再作为全局回退。
- [ ] 覆盖没有旧业务数据、数据库事务异常回滚和重复启动，不留下半个用户或部分所有权。
- [ ] 重启恢复测试必须证明：只重试清理，不创建第二个用户、不重复覆盖所有权、不丢加密设置。
- [ ] legacy_config.py 只返回原始 legacy 值；不得调用会隐藏来源或回填环境变量的 load_config 结果。
- [ ] 实现 AccountMigrationService.claim_for_first_user 和 resume_cleanup。

### Task C3：请求认证依赖

- [ ] optional_auth 从 neko_session 读取 token，经 SessionService 认证后写 request.state.auth。
- [ ] require_auth 缺失时抛 authentication_required。
- [ ] optional_user 和 require_user 只做兼容薄封装，不重复查库。
- [ ] require_conversation_owner 统一由 Agent E 完善；此处先定义注入边界。
- [ ] 无效、过期或已撤销 Cookie 被当作匿名，并在响应时清理 Cookie。

### Task C4：全局 HTTP 安全门禁

- [ ] GET、HEAD、OPTIONS 不触发 CSRF，但仍可建立 optional auth 上下文。
- [ ] unsafe 请求在进入业务路由前验证 Origin/Referer 和双提交 CSRF。
- [ ] auth/csrf 的 GET 保持匿名可用。
- [ ] needs_secret_cleanup 或主密钥不可用时，公开安全读取仍可用；安全写统一返回相应 503。
- [ ] 不在错误详情返回数据库、Key 路径或 config 内容。

### Task C5：路由和生命周期

- [ ] 增加 GET /api/auth/csrf。
- [ ] 增加 POST /api/auth/register、POST /api/auth/login、POST /api/auth/logout。
- [ ] 增加 GET /api/auth/me、PUT /api/auth/password。
- [ ] 注册成功响应包含公开用户和 legacy_data_claimed；只有本次把状态从 unclaimed 推进时为 true。
- [ ] 修改密码成功后撤销该用户全部旧会话，并为当前浏览器签发一个新会话和绑定的新 CSRF token。
- [ ] lifespan 中先初始化 schema 和 AuthKeyring，再调用 resume_cleanup，最后准备服务依赖。
- [ ] 启动日志在存在待认领旧数据时提示“第一个注册账号将取得全部旧数据”；局域网 HTTP 模式提示同网段监听风险，均不得输出账号或密钥内容。
- [ ] 启动时调用 SessionService 清理已过期会话。
- [ ] main.py 注册 auth router 和安全中间件，确认 frontend mount 顺序不吞 /api 路由。
- [ ] 公开 /api/health 保留机器健康字段，但移除全局 ai_enabled。
- [ ] TestClient 测试必须先取 CSRF，再发安全写，且默认 credentials 行为与浏览器一致。

### Task C6：本包验证

- [ ] 运行 python -m unittest backend.test_auth_routes backend.test_account_claim_migration backend.test_auth_startup_recovery。
- [ ] 运行所有 backend/test_auth_*.py。
- [ ] 运行完整后端测试并记录现有兼容失败，不能直接放宽安全校验。

**交付接口：** 全部 /api/auth 路由、request.state.auth、安全写门禁、可恢复首次认领。

**禁止事项：** 不改共享内容授权、不改聊天路由、不改前端。

---

## 5. Agent D：共享内容授权

**依赖：** Agent C 完成。

**目标：** 让作品、角色卡、世界书对所有访问者可读，但只有创建者可以新增、编辑、删除；删除和作品组合操作保持引用一致性。

**修改仓储文件：**

- backend/repository/cards.py
- backend/repository/worldbooks.py
- backend/repository/works.py
- backend/repository/work_bundles.py
- backend/test_shared_library_authorization.py
- backend/test_shared_library_references.py
- backend/test_work_bundle_authorization.py

**修改文件：**

- backend/api_models/shared.py
- backend/routers/cards_routes.py
- backend/routers/worldbooks_routes.py
- backend/routers/works_routes.py
- backend/routers/imports_routes.py
- 与共享内容有关的现有测试

### Task D1：公开投影

- [ ] 先写 RED 测试：匿名列表和详情可读取共享作品、卡片和世界书。
- [ ] 世界书条目的列表、创建、编辑和删除继承世界书所有权；不能只保护世界书外壳。
- [ ] 响应包含 owner_username 和 can_edit。
- [ ] 匿名 can_edit=false；本人 true；其他已登录用户 false。
- [ ] 列表查询一次 join users，避免逐行 owner 查询。
- [ ] needs_secret_cleanup 门禁期间旧 owner_user_id=NULL 行只允许公开读取，不能编辑或删除；complete 后应用层不得创建无主记录。

### Task D2：创建和修改授权

- [ ] 写 RED 测试：匿名 POST/PUT/PATCH/DELETE 返回 authentication_required。
- [ ] 登录用户新建共享资源时，owner_user_id 由 request.state.auth.user.id 写入，忽略客户端同名字段。
- [ ] 非创建者修改或删除共享资源返回 forbidden；不存在仍返回 not_found。
- [ ] 批量导入的每条共享资源都绑定当前用户，导入响应带正确 can_edit。
- [ ] 公共 schema 不允许客户端提交 owner_user_id 或 can_edit。

### Task D3：引用删除与组合原子性

- [ ] 写卡片或世界书被作品引用时的删除测试，期望 resource_in_use。
- [ ] details 只列引用作品 id/title，顺序稳定，适合前端展示。
- [ ] 非所有者不能通过“资源被引用”的差异探测更多信息：先做所有权检查，再做引用检查。
- [ ] work bundle 创建/导入在单个事务中校验所引用共享资源存在；允许使用其他用户公开卡片/世界书，但新建的作品归当前用户。
- [ ] work bundle 更新时分别校验作品和将被修改的世界书所有权；作品创建者可以替换他人的世界书引用，但不能借组合接口修改他人的世界书。
- [ ] 删除作品不级联删除共享卡片或世界书。
- [ ] 并发或中途失败时不留下半成品 bundle。
- [ ] 编辑被引用角色卡或世界书的详情响应提供安全的引用作品摘要，供前端保存前二次确认。
- [ ] 作品聚合游玩次数可以公开，但不得泄露玩家身份、会话标题或个人活动记录。

### Task D4：兼容迁移

- [ ] 保留 legacy card_id 与 ordered card_ids 的既有迁移和响应行为。
- [ ] 现有作品快照逻辑继续冻结卡片内容；授权判断只基于作品/卡片真实记录，不基于快照。
- [ ] repositories.py 的旧导入名继续通过薄门面可用。

### Task D5：验证

- [ ] 运行三个新增测试文件。
- [ ] 运行 card、worldbook、work、import 相关现有测试。
- [ ] 运行完整后端测试。

**交付接口：** 共享资源公开读投影、创建者写授权、ResourceInUse、原子 work bundle。

**禁止事项：** 不修改私有会话、不修改聊天生成、不修改现有前端文件。

---

## 6. Agent E：私有冒险数据隔离

**依赖：** Agent C 完成。

**目标：** 把会话、消息、状态、长期记忆、存档和分支操作全部绑定 user_id，并让跨账号访问统一表现为不存在。

**修改仓储文件：**

- backend/repository/conversation_repository.py
- backend/repository/snapshot_repository.py
- backend/test_conversation_authorization.py
- backend/test_snapshot_authorization.py
- backend/test_private_repository_scoping.py

**修改文件：**

- backend/api_models/adventure.py
- backend/routers/conversations_routes.py
- backend/services/state_service.py
- backend/services/snapshot_service.py
- backend/services/roll_service.py
- backend/services/commands.py
- 直接调用私有仓储的现有测试

### Task E1：强制仓储作用域

- [ ] 先写 RED 测试证明任何会话列表、详情、更新、删除都需要显式 user_id。
- [ ] 生产方法签名中 user_id 不得有默认值，也不得是 Optional。
- [ ] 所有 SQL 在主查询中同时约束 id 和 user_id；禁止“先查 id，再在 Python 判断”。
- [ ] 消息、状态、记忆和快照通过拥有者会话 join 或直接 user_id 过滤。
- [ ] 增加静态签名测试或 rg 验证，阻止重新出现 get_conversation(id) 等无作用域调用。

### Task E2：会话路由

- [ ] 匿名创建、列表、详情、改名、删除、归档、恢复都返回 authentication_required。
- [ ] 创建会话时从认证上下文写 user_id，客户端不能选择拥有者。
- [ ] 本人操作成功；另一个用户对同一 id 的所有操作统一返回 not_found。
- [ ] 作品是共享可读的，因此任何登录用户都能基于任意公开作品创建自己的会话。
- [ ] 创建会话仍冻结角色卡快照，不能因授权改造而退化。

### Task E3：存档与分支

- [ ] 写自动存档、手动存档、存档列表、恢复和删除的双用户隔离测试。
- [ ] 恢复前校验会话和快照属于同一当前用户。
- [ ] 增加 POST /api/conversations/{conversation_id}/branches；snapshot_id 可为空（从当前头部分支），从指定源会话/存档复制消息、状态、记忆、修正和冻结卡片，新的 conversation.user_id 固定为当前用户。
- [ ] 分支操作单事务执行；失败不得留下空会话。

### Task E4：状态、骰子和指令

- [ ] 为 state_service、roll_service、commands 的入口补 user_id 或 ConversationAccess。
- [ ] 骰子结果、玩家属性和更正不能跨账号读写。
- [ ] 服务层不要自行从第一个用户或全局状态推断当前用户。

### Task E5：更新现有测试夹具

- [ ] 给旧测试的会话创建夹具显式增加测试用户。
- [ ] 优先复用 backend/test_support/accounts.py，避免每个测试发明不同账号创建方式。
- [ ] 不为了兼容旧测试给生产函数添加可选 user_id。

### Task E6：验证

- [ ] 运行三个新增测试文件。
- [ ] 运行 conversation、snapshot、state、roll、command 相关测试。
- [ ] 运行完整后端测试。

**交付接口：** 强制 user_id 仓储、require_conversation_owner 的最终实现、受保护会话/存档/分支 API。

**禁止事项：** 不修改 chat_routes.py，不修改 AI 配置，不修改前端。

---

## 7. Agent F：用户 AI 设置与出站安全

**依赖：** Agent C 完成。

**目标：** 把 DeepSeek 兼容配置变成按用户保存的加密设置，并确保任意 Base URL 不造成 SSRF、凭据重定向泄漏或跨账号配置混用。

**建议新增文件：**

- backend/repository/user_ai_settings.py
- backend/services/user_ai_settings.py
- backend/api_models/settings.py
- backend/ai/request_policy.py
- backend/test_user_ai_settings.py
- backend/test_ai_request_policy.py
- backend/test_config_routes_authorization.py

**修改文件：**

- backend/routers/settings_routes.py
- backend/ai/deepseek_client.py

### Task F1：用户设置仓储

- [ ] 写双用户 RED 测试：deepseek_config、generation_config、api_key_ciphertext 互不影响。
- [ ] Key 只通过 Agent B 的 AuthKeyring 加解密，仓储不接触全局 config Key。
- [ ] GET 响应包含机器级 app 公开设置、当前用户 deepseek/generation、api_key_set 和 api_key_unreadable，不返回明文或密文。
- [ ] PUT 缺少 api_key 时保留旧 Key；api_key="" 不隐式清空；只有 clear_api_key=true 清除。
- [ ] 新 api_key 与 clear_api_key=true 同时出现时返回校验错误。
- [ ] 更新设置时若提供新 Key，用 MultiFernet 当前首 Key 加密；旧 Key 解密成功后惰性 rotate。
- [ ] 继续复用 config.py 的 generation 规范化和上下限，不把未校验 JSON 直接写库。

### Task F2：有效配置

- [ ] 定义 EffectiveAIConfig(base_url, model, api_key, ai_enabled)。
- [ ] resolve_for_user(user_id) 只从该用户设置解析，不回退其他用户。
- [ ] 没有 Key 时 ai_enabled=false，聊天可使用现有确定性 mock；不得读取旧 config.json Key。
- [ ] 数据库已有密文但主密钥丢失时，设置投影 api_key_unreadable=true；聊天返回 api_key_unreadable，不静默 Mock，用户仍可替换或清除。
- [ ] 首个用户认领得到的 legacy 设置与普通用户设置走同一解析路径。
- [ ] 首次迁移使用的有效旧 Base URL 自动加入本次进程的已批准 Origin 集合；后续新用户仍只能从机器白名单选择。

### Task F3：Base URL 和 SSRF

- [ ] Base URL 必须是绝对 http/https URL，不允许用户名密码、query、fragment 或协议相对 URL；再提取并比较精确 Origin。
- [ ] 规范化 scheme、IDNA host、端口，并和 NEKO_AI_ALLOWED_ORIGINS 做精确 Origin 比较。
- [ ] NEKO_AI_HTTPS_ONLY=true 时拒绝 http；局域网例外必须通过显式白名单。
- [ ] DNS 解析出的每个地址都必须通过地址策略；默认拒绝 loopback、link-local、multicast、unspecified 和非白名单私网。
- [ ] 重定向默认关闭；若未来打开，逐跳重新校验 Origin 且绝不把 Authorization 转发到不同 Origin。
- [ ] /models 和 /chat/completions 共用同一个 AIRequestPolicy，不能只保护设置保存。

### Task F4：受保护设置路由

- [ ] GET /api/config 和 PUT /api/config 都要求登录；匿名返回 authentication_required。
- [ ] PUT 使用 CSRF/同源中间件，返回不含 Key 的安全投影。
- [ ] GET /api/models 要求登录并使用当前用户 EffectiveAIConfig。
- [ ] POST /api/models/preview 要求登录；可使用请求中的临时 Key，缺省时用已保存 Key；临时 Key 不落库、不进日志。
- [ ] PUT 若提交 app 字段返回校验错误；机器级 app 只能读不能由账号修改。
- [ ] deepseek_client 的构造函数改为显式接收 EffectiveAIConfig 和 request policy，不从全局 load_config 取 Key。

### Task F5：验证

- [ ] 运行三个新增测试文件。
- [ ] 运行 config 和 deepseek client 现有测试。
- [ ] 运行 rg -n "api_key|Authorization" backend，人工核对任何日志或错误拼接。
- [ ] 运行完整后端测试。

**交付接口：** UserAISettingsService、EffectiveAIConfig、AIRequestPolicy、按用户的 /api/config。

**禁止事项：** 不修改 chat_routes.py 和 adventure_engine.py，不修改前端。

---

## 8. Agent G：聊天与 SSE 汇合

**依赖：** Agent E、F 完成。

**目标：** 在不破坏现有流式行为的前提下，把当前用户的会话所有权和 AI 设置贯穿生成、停止、压缩、状态更新和自动存档。

**修改文件：**

- backend/routers/chat_routes.py
- backend/services/adventure_engine.py
- backend/services/context_service.py
- backend/test_adventure_engine.py
- backend/test_chat_reply_length.py
- backend/test_options_output.py
- 其他 chat/context/SSE 直接相关测试

**注意：** 上述文件已存在用户工作树修改。开工前必须记录 git diff -- 对应文件，只在这些现有改动之上增量编辑；不得丢失 _recover_missing_options 及其测试。

### Task G1：把授权放在副作用之前

- [ ] 先写双用户 RED 测试：发送消息、停止生成、重试、压缩、查看上下文状态都不能访问他人会话。
- [ ] 路由在创建 StreamingResponse 或生成器前调用 require_conversation_owner。
- [ ] 所有锁 key、stop event 和 generation registry 都基于已授权 conversation id。
- [ ] 非拥有者得到 not_found，且不能创建锁、stop event、部分消息或审计副作用。

### Task G2：显式传递有效 AI 配置

- [ ] 每次生成只调用 resolve_for_user(auth.user.id)。
- [ ] EffectiveAIConfig 显式传入 deepseek client/adventure engine；禁止全局配置回退。
- [ ] 同一会话生成期间冻结本轮配置快照，设置更新只影响下一轮。
- [ ] 没有 Key 时保持确定性 mock，模式事件反映当前用户而非全局健康状态。

### Task G3：保持 SSE 完整性

- [ ] 测试真实流和 mock 流都保持既有事件顺序。
- [ ] 测试停止处理、会话互斥、断连后的部分消息持久化。
- [ ] 测试结构化 options/state_delta/judge 被过滤并正确持久化。
- [ ] 测试自动压缩只读取当前用户会话的消息和长期记忆。
- [ ] 测试自动存档写入当前 user_id 范围。
- [ ] StreamingResponse 惰性执行的异常路径必须转换为现有 SSE error 事件或在响应创建前失败，不得返回伪 200 后泄漏。

### Task G4：回归当前脏改动

- [ ] 保留 _recover_missing_options。
- [ ] 保留 test_adventure_engine.py、test_chat_reply_length.py、test_options_output.py 中现有新增断言。
- [ ] 先分别运行这三个测试文件，再运行所有 chat/context 测试。

### Task G5：验证

- [ ] 运行 python -m unittest backend.test_adventure_engine backend.test_chat_reply_length backend.test_options_output。
- [ ] 运行所有名称含 chat、context、stream、compression 的后端测试。
- [ ] 运行完整后端测试。

**交付接口：** 所有聊天操作都消费 ConversationAccess 和 EffectiveAIConfig，并保持 SSE 契约。

**禁止事项：** 不改共享资源路由，不改前端。

---

## 9. Agent H：前端基础模块

**依赖：** Agent C 的 API 契约稳定即可；可与 D/E/F 并行，但受三执行槽限制。

**目标：** 用全新、纯模块建立统一请求安全、认证状态、所有权投影和不可变演示数据，不触碰当前脏前端文件。

**只新增文件：**

- frontend/js/core/api-client.mjs
- frontend/js/auth-state.mjs
- frontend/js/domain/ownership.mjs
- frontend/js/read-only-demo.mjs
- frontend/test_api_client.mjs
- frontend/test_auth_state.mjs
- frontend/test_ownership.mjs
- frontend/test_read_only_demo.mjs

### Task H1：统一 API 客户端

- [ ] 用注入 fetch 的 Node 测试先锁定 credentials: "same-origin"。
- [ ] 首次安全写前自动 GET /api/auth/csrf，把 csrf_token 仅保存在内存。
- [ ] POST/PUT/PATCH/DELETE 自动增加 X-CSRF-Token。
- [ ] 仅当响应 code=csrf_failed 时刷新 token 并重试一次；网络失败、401 或普通 403 不自动重放。
- [ ] 401 触发注入的 onAuthRequired 回调，并保留安全 return hash。
- [ ] 解析统一错误结构；非 JSON 错误转换为稳定的客户端错误，不显示 HTML。

### Task H2：认证状态

- [ ] createAuthState 提供 bootstrap、getSnapshot、subscribe、login、register、logout、changePassword。
- [ ] bootstrap 调用 /api/auth/me，区分 anonymous、authenticated、unavailable。
- [ ] 状态包含 legacyClaimPending，但不推测旧数据内容。
- [ ] logout 成功后清空内存 CSRF 和用户相关页面状态。
- [ ] return hash 只允许项目已知路由前缀，存入 sessionStorage；拒绝 //、协议、编码换行和未知管理路径。

### Task H3：所有权显示模型

- [ ] ownership.mjs 只消费后端 owner_username/can_edit。
- [ ] 返回可复用的 owner label、edit visibility、read-only reason。
- [ ] 不用 owner_username 和当前用户名比较来决定授权。

### Task H4：不可变演示数据

- [ ] 内置最小作品、卡片、世界书展示数据用 deepFreeze 或每次深拷贝保护。
- [ ] read-only adapter 的任何 create/update/delete/startAdventure/save 方法都抛 read_only_demo。
- [ ] 演示数据与真实 localStorage 命名空间无关，不读取旧用户会话。

### Task H5：验证

- [ ] 逐个运行四个新增 Node 测试。
- [ ] 运行全部前端测试，确认仅新增模块不影响现状。

**交付接口：** createApiClient、createAuthState、ownership projection、readOnlyDemoAdapter。

**禁止事项：** 不修改 main.js、data.mjs、index.html、style.css 或任何已有前端文件。

---

## 10. Agent I：前端页面与现有代码集成

**依赖：** Agent C、D、E、F、H 完成。

**目标：** 把认证、设置、所有权和只读演示接入现有 Hash SPA。此 Agent 是全部已有前端脏文件的唯一所有者。

**新增文件：**

- frontend/js/auth-page.mjs
- frontend/js/settings-page.mjs
- frontend/js/worldbook-page.mjs
- frontend/test_auth_page.mjs
- frontend/test_account_ui.mjs
- frontend/test_offline_read_only.mjs

**修改文件：**

- frontend/index.html
- frontend/css/style.css
- frontend/js/main.js
- frontend/js/data.mjs
- frontend/js/adventure-page.mjs
- frontend/js/icons.js
- 当前相关前端测试

**注意：** 这些现有文件已经有 Story OS、顶部栏和筛选相关用户修改。必须以当前工作树为基线，不得从 HEAD 覆盖。

### Task I1：先锁定当前基线

- [ ] 运行全部前端测试并保存测试数和结果。
- [ ] 对上述脏文件运行 git diff --，识别当前用户修改。
- [ ] 新测试必须建立在现有 route、workspace rail、topbar mode badge 和 library filter 契约上。

### Task I2：应用启动和认证导航

- [ ] main.js 启动时先初始化 api client/auth state，再渲染当前 Hash 路由。
- [ ] 公开共享库加载和 /api/auth/me 并行执行；认证接口异常不能阻塞公开浏览。
- [ ] 顶部栏匿名显示“登录 / 注册”，登录后显示用户名、设置和退出。
- [ ] 增加 #/login、#/register、#/settings；已登录访问登录页时安全返回首页或 return hash。
- [ ] 受保护动作被 401 拒绝时跳转登录，并只保存 allowlist 校验后的 Hash。
- [ ] 退出后立即清除私有会话 UI、编辑草稿和内存缓存。

### Task I3：登录注册与首次认领提示

- [ ] 表单支持用户名/密码、提交中、字段错误、统一凭据错误和限流倒计时。
- [ ] 登录页在 legacy_claim_pending=true 时显示明确警告：首个注册账号会接管本机已有作品、会话和 AI 配置。
- [ ] 不在前端声称迁移已完成；只根据注册响应和后续 /me 状态显示。
- [ ] CSRF 获取和 Cookie 处理全部委托 api-client，不手写第二套 fetch。

### Task I4：共享库所有权 UI

- [ ] 作品、角色卡、世界书列表和详情显示“创建者：用户名”。
- [ ] 自己的内容显示“我的”标记。
- [ ] can_edit=false 时隐藏编辑/删除入口，并用只读提示替代。
- [ ] 访客仍可搜索、筛选、打开共享详情。
- [ ] 访客点击新建、编辑、导入或开始冒险时引导登录。
- [ ] resource_in_use 显示引用作品标题列表，不用通用弹窗吞掉 details。
- [ ] 编辑被引用角色卡或世界书时列出受影响作品，并在保存前二次确认。
- [ ] 补齐此前未挂载的世界书页面路由，复用当前视觉语言。

### Task I5：私有会话与设置

- [ ] 对话列表、存档、恢复和分支只展示后端当前账号响应。
- [ ] 切换账号或退出时不保留上一账号的列表或当前 conversation id。
- [ ] 设置页展示 app 公开设置、个人 deepseek/generation、api_key_set 和 api_key_unreadable；Key 输入永不回填。
- [ ] 设置页在局域网 HTTP 下显示同网段 Cookie 监听风险，不把当前模式描述为公网安全。
- [ ] 保存时未填 Key 表示保留；独立“清除 Key”操作发送 clear_api_key=true，并二次确认。
- [ ] 启动时删除旧版 adventure_api_key_draft，之后 API Key 不进入 localStorage、sessionStorage 或 URL。
- [ ] 顶部模式标记根据当前用户 api_key_set && !api_key_unreadable 计算真实/模拟；公开 /api/health 移除全局 ai_enabled，不得泄露任何用户 Key 状态。

### Task I6：后端不可用与只读演示

- [ ] 启动 API 不可用时进入 unavailable/read-only demo 状态。
- [ ] 只展示内置作品、卡片和世界书；明显标注“离线只读演示”。
- [ ] 禁用创建、编辑、删除、导入、开始冒险、聊天和存档。
- [ ] 停止向原 localStorage mock store 写数据，也不把旧 localStorage 私有会话展示给另一个账号。
- [ ] 后端恢复后提供显式重试，重新 bootstrap /me；不自动上传离线演示内容。

### Task I7：样式和可访问性

- [ ] 登录/注册/设置页面沿用现有中国用户界面和 Story OS 视觉系统。
- [ ] 所有输入有 label，错误用 aria-live，键盘可操作，焦点在路由切换后落到主标题。
- [ ] 保持现有响应式顶部栏、workspace rail、封面、Live2D 和移动端布局。
- [ ] 新图标通过 icons.js 当前挂载机制接入，不引入外部资源。

### Task I8：验证

- [ ] 运行三个新增测试。
- [ ] 运行 frontend/test_settings_and_onboarding_fixes.mjs、test_library_filter.mjs、test_story_os_ui.mjs、test_topbar_mode_badge.mjs、test_workspace_rail_refinement.mjs。
- [ ] 运行完整前端测试：

~~~powershell
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
~~~

- [ ] 用窄视口和桌面视口做手工/浏览器检查，确认登录、库浏览、设置和冒险入口无布局回归。

**交付接口：** 完整账号 UI、创建者 UI、私有会话 UI、只读演示。

**禁止事项：** 不修改后端来绕过前端测试，不恢复可写 localStorage 用户数据库。

---

## 11. Agent J：系统验证、安全回归与文档

**依赖：** A-I 全部完成。

**目标：** 用独立数据目录和两个真实账号验证跨层行为，更新运行文档，并给总控 Agent 提供可复核的最终证据。

**建议新增/修改文件：**

- backend/test_account_system_smoke.py
- backend/smoke_test.py
- README.md
- docs/api-contract.md
- docs/deployment-account-security.md

### Task J1：范围和静态安全检查

- [ ] 运行 git status --short，列出计划内和计划外文件。
- [ ] 运行 git diff --check。
- [ ] 搜索无作用域私有仓储调用：

~~~powershell
rg -n "get_conversation\([^,)]*\)|list_conversations\(\)|get_snapshot\([^,)]*\)" backend
~~~

- [ ] 搜索前端旧可写离线存储入口：

~~~powershell
rg -n "localStorage\.(setItem|removeItem)|offline.*(create|update|delete|save)" frontend/js
~~~

- [ ] 搜索可能泄密的日志：

~~~powershell
rg -n "print\(|logger\.|Authorization|api_key|password|session" backend
~~~

所有命中都要人工分类，不能用忽略规则掩盖真实问题。

### Task J2：完整自动化测试

- [ ] 运行：

~~~powershell
python -m unittest discover -s backend -p 'test_*.py'
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
~~~

- [ ] backend/smoke_test.py 只作补充，不能替代单元套件。
- [ ] 任何失败使用 systematic-debugging 找根因；修复交回对应文件所有者或由总控做最小合并。

### Task J3：隔离服务器冒烟

- [ ] 创建项目工作区内明确的临时测试目录，设置 NEKO_DATA_DIR 和 NEKO_AUTH_KEY_PATH 指向其中。
- [ ] 设置测试专用 NEKO_AUTH_KEYS、NEKO_PUBLIC_ORIGIN 和 AI Origin 白名单；值不得来自用户真实环境。
- [ ] 以 python start.py --no-browser 或单 worker uvicorn 启动测试实例。
- [ ] 逐步验证：

1. 匿名 GET 共享库成功。
2. 匿名安全写返回 401 或认证流程要求的安全错误。
3. GET /api/auth/csrf 后首个账号注册成功并认领旧 fixture。
4. 第二账号开放注册成功。
5. 账号 A 创建作品/卡片/世界书；账号 B 可读但 can_edit=false。
6. 账号 B 修改/删除 A 内容失败。
7. 两账号分别创建会话；互相访问详情、消息、状态、存档和聊天均为 404。
8. 两账号配置不同 mock AI 设置，响应不串用。
9. 改密后旧会话 Cookie 失效，新密码可登录。
10. 登出后 Cookie 被清理。

- [ ] 停止测试服务器后，只删除已解析并确认位于该临时测试目录内的内容。

### Task J4：真实浏览器双上下文检查

- [ ] 用两个独立浏览器上下文或一个普通窗口加隐私窗口登录 A/B。
- [ ] 验证共享内容实时可见、编辑按钮只对创建者出现。
- [ ] 验证 URL 中不出现 session token、CSRF token 或 API Key。
- [ ] 验证刷新保持登录，退出或改密后受保护页面回到登录。
- [ ] 验证 API 停止时进入只读演示且所有写按钮不可用。
- [ ] 验证桌面和移动宽度下登录、顶部栏、共享库、设置和冒险页面。

### Task J5：文档

- [ ] README 增加注册、数据共享/隔离规则、单 worker 约束和环境变量说明。
- [ ] README 和设置页明确说明：局域网 HTTP 使用 Secure=false 的 Cookie，无法防止同网段监听，不等同于公网安全。
- [ ] docs/api-contract.md 更新认证、CSRF、owner_username/can_edit、个人 config、会话/分支接口和错误码。
- [ ] 新增 docs/deployment-account-security.md，说明局域网 HTTP 限制、公网前必须启用 HTTPS/Secure Cookie、可信代理、固定 Origin、备份主密钥和 Key 轮换。
- [ ] 文档不得包含真实配置值、真实用户名或本地绝对路径。

### Task J6：最终证据

- [ ] 再运行一次完整后端和前端测试，保存命令、通过数和退出码。
- [ ] 再运行 git diff --check 和 git status --short。
- [ ] 核对 data/app.db、config.json、data/auth_keys.json 未被 diff 或加入版本控制。
- [ ] 把仍存在的非本计划脏文件逐项标记为“用户原有改动”，不擅自清理。

**交付接口：** 可复现的验证证据、最新运行/安全文档、无秘密的最终 diff。

---

## 12. 每个 Agent 的交接模板

每个执行 Agent 完成时给总控 Agent 返回以下内容：

~~~text
工作包：
修改/新增文件：
关键接口：
窄测试命令与结果：
完整相关测试命令与结果：
保留的用户原有改动：
已知风险或未完成项：
建议下一波注意事项：
~~~

不得只回复“完成”或“测试通过”。如果测试因另一个未完成工作包失败，必须提供最小复现和明确依赖，不能自行修改别人的文件。

---

## 13. 总控 Agent 集成检查点

### Checkpoint 1：A 后

- [ ] Schema 对旧库和新库都幂等。
- [ ] 数据目录可隔离。
- [ ] requirements 安装成功。
- [ ] repositories 门面没有循环导入。

### Checkpoint 2：C 后

- [ ] 匿名 CSRF、注册、登录、me、退出、改密链路可测试。
- [ ] needs_secret_cleanup 和 secret_key_unavailable 门禁符合公开只读规则。
- [ ] 首次认领重启可恢复。

### Checkpoint 3：D/E/F/H 后

- [ ] 共享/私有边界没有可选 user_id。
- [ ] AI 配置严格按 user_id。
- [ ] 新前端基础模块不触碰现有脏文件。
- [ ] 总控 Agent 合并 repositories.py 和 schemas.py 兼容门面，运行一次完整后端测试。

### Checkpoint 4：G/I 后

- [ ] 聊天在 StreamingResponse 建立前授权。
- [ ] SSE、停止、压缩和自动存档回归通过。
- [ ] 当前 Story OS、顶部栏和筛选用户改动仍在。
- [ ] 前端所有请求通过统一 API 客户端。

### Checkpoint 5：J 后

- [ ] 两账号 API 和浏览器隔离验证通过。
- [ ] 全套后端、前端测试都以最新工作树运行。
- [ ] 没有真实数据、密钥或无关文件被加入交付。

---

## 14. 需求覆盖矩阵

| 已确认需求 | 负责 Agent | 最终验证 |
|---|---|---|
| 开放注册、用户名密码 | B、C、I | J 双账号注册/登录 |
| 首个账号认领旧数据和配置 | A、C | J 迁移 fixture |
| 作品/卡片/世界书共享 | D、I | J 匿名与 B 账号读取 |
| 只有创建者编辑删除 | D、I | J 跨账号写失败 |
| 会话和存档按账号隔离 | E、G、I | J 跨账号 404 |
| 服务端随机 Session | B、C | J 刷新/退出/改密 |
| CSRF、同源与限流 | B、C、H | auth 路由和浏览器测试 |
| 用户独立 DeepSeek 配置 | F、G、I | J 双账号配置 |
| API Key 加密和 SSRF 防护 | B、F | keyring/policy 测试 |
| 访客可浏览但不能写/玩 | C、D、E、I | J 匿名场景 |
| 后端不可用时只读演示 | H、I | J 断服浏览器检查 |
| 局域网首版，公网边界留清楚 | B、F、J | 部署安全文档 |

---

## 15. 计划自检清单

- [ ] 设计文档第 3-17 节均在需求覆盖矩阵中有负责人。
- [ ] 所有任务写明具体文件、RED 测试、GREEN 实现和验证命令。
- [ ] 没有两个并行 Agent 同时拥有同一个现有文件。
- [ ] 现有脏文件只分配给 G 或 I 两个不并行写同文件的 Agent。
- [ ] Wave 3 同时活跃执行 Agent 不超过三个。
- [ ] 所有私有数据路径都要求显式 user_id 或 ConversationAccess。
- [ ] 所有安全写都经过会话、同源和 CSRF。
- [ ] 未授权提交动作未列入步骤。
- [ ] 没有未决占位文本或待实现空洞。

---

## 16. 执行入口

实现时按 Wave 0 开始，并由总控 Agent 使用 superpowers:subagent-driven-development：

1. 给执行 Agent 只发送对应工作包及冻结契约。
2. Agent 先写失败测试，再写最小实现。
3. 每包结束做规格审查和代码质量审查。
4. 总控 Agent 在每个 Checkpoint 运行交叉验证。
5. 所有包完成后，使用 superpowers:verification-before-completion 执行 Agent J 的最终流程。

用户尚未授权提交，因此实现和验证完成后停在未暂存工作树，先汇报结果和精确 diff 范围。
