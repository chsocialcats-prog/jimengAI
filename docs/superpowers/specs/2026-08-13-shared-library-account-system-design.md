# 共享内容库账号系统设计

**日期：** 2026-08-13  
**状态：** 产品设计已确认，待书面规格审阅后进入实现计划

## 1. 背景与目标

当前应用是本地单用户程序。作品、角色卡、世界书、会话、消息、状态和存档都保存在同一个 SQLite 数据库中，所有 API 均无身份认证；后端不可用时，前端还会使用浏览器本地数据提供完整离线写入和试玩。

本功能把应用升级为可供局域网内多名用户使用的账号系统，同时保留“共享创作资料库”的产品形态：

- 用户使用用户名和密码开放注册、登录和退出。
- 作品、角色卡和世界书对所有用户及访客公开可读。
- 共享内容只有创建者可以修改或删除。
- 会话、消息、状态、长期记忆、修正、存档和分支严格按账号隔离。
- 每个账号独立保存 DeepSeek 兼容接口、模型、API Key 和生成设置。
- 第一个成功注册的账号接管升级前的全部旧数据和旧 AI 配置。
- 首期支持局域网 HTTP 部署，但数据模型和认证机制必须可以平滑升级到公网 HTTPS。

## 2. 非目标

首版不实现以下能力：

- 邮箱、短信、第三方 OAuth 或通行密钥登录。
- 忘记密码、邮件找回、恢复码、改用户名或注销账号。
- 管理员后台、封禁操作界面、角色组或细粒度权限。
- 私有作品、指定用户共享、协同编辑或内容审核。
- 访客试玩、访客数据合并、浏览器离线数据同步。
- 多进程或多 worker 部署。
- 直接完成公网发布；公网化所需的基础结构会保留，但上线仍有单独的运维验收门槛。

用户忘记密码时，首版没有自助恢复路径。这一限制必须在注册和修改密码页面明确提示。

## 3. 已确认的产品规则

### 3.1 身份与注册

- 采用开放注册。
- 登录标识为“用户名 + 密码”，不要求邮箱。
- 基础账号功能包括注册、登录、退出、查看当前账号和验证旧密码后修改密码。
- 第一个成功注册的账号只具有“旧数据接管者”这一特殊含义，不自动成为管理员。
- 当数据库存在待接管旧数据时，启动日志和注册页必须明确提示“第一个注册账号将取得全部旧数据”。局域网运行者应先完成首账号注册，再向其他人开放地址；系统不另设隐藏的首账号口令。

### 3.2 共享内容

- 作品、角色卡、世界书及世界书条目公开可读。
- 所有登录用户都可以创建共享内容。
- 只有创建者可以修改或删除自己的共享内容。
- 内容响应公开显示创建者用户名，并为当前登录用户提供 <code>can_edit</code>。
- 登录用户创建作品时，可以引用任意用户的公开角色卡或世界书；引用不转移所有权。
- 角色卡或世界书被任意作品引用时禁止删除，创建者必须先解除全部引用。
- 删除作品不级联删除其引用的角色卡或世界书。
- 作品可以保留现有聚合游玩次数，但不得公开玩家身份、个人会话标题或个人活动记录。

本功能不改变现有内容快照语义：角色卡继续在创建会话时冻结快照；世界书继续使用当前项目已有的实时引用行为。因此，世界书创建者的编辑可能影响所有引用该世界书的作品和相关会话。世界书编辑页面必须显示引用作品并在保存前二次确认。冻结世界书版本不属于本次账号系统范围。

### 3.3 私有冒险数据

- 开始冒险必须登录。
- 会话直接归属于用户。
- 消息、状态、长期记忆、修正、存档和分支通过会话继承归属。
- 用户不能读取、修改、生成、停止或删除其他用户的会话数据。
- 私有资源越权访问统一表现为“资源不存在”，避免泄露其是否存在。

### 3.4 访客与离线模式

- 访客可以浏览共享作品、角色卡和世界书。
- 访客点击开始冒险、创建、导入、编辑或个人设置时，进入登录/注册流程。
- 后端不可用时只显示内置示例的只读版本；创建、编辑、导入和试玩入口全部禁用。
- 旧版本留在浏览器中的离线作品数据不删除，但账号版离线模式不读取、不展示、不同步这些数据。

## 4. 总体架构

账号系统拆分为五个边界清晰的单元：

1. **认证仓储与服务**：管理用户、密码摘要、服务端会话、登录过期和密码修改。
2. **请求安全层**：解析 Cookie、加载可选或必需用户、执行 CSRF、同源和限流检查。
3. **资源授权层**：统一检查共享内容创建者和私有会话所有者，避免权限逻辑散落在页面或单一路由中。
4. **用户 AI 设置服务**：规范化个人设置、加密或解密 API Key，并为聊天、模型发现和上下文压缩提供完整配置。
5. **旧数据接管服务**：在首次注册事务中认领无主数据，并用可恢复状态机清理旧明文密钥。

前端增加一个全局认证状态和统一请求封装。页面只根据认证状态调整交互，真正的授权始终由后端执行。

## 5. 数据模型

### 5.1 用户

新增 <code>users</code> 表：

| 字段 | 含义 |
| --- | --- |
| <code>id</code> | 自增主键 |
| <code>username</code> | 公开展示的 NFKC 规范化用户名 |
| <code>username_key</code> | 用户名经大小写折叠后的唯一检索键 |
| <code>password_hash</code> | Argon2id 密码摘要 |
| <code>is_active</code> | 为未来停用能力预留，首版默认启用 |
| <code>password_changed_at</code> | 最近修改密码时间 |
| <code>created_at</code>、<code>updated_at</code> | UTC 时间戳 |

<code>username_key</code> 建立唯一索引。密码明文永不进入数据库。

### 5.2 服务端登录会话

新增 <code>auth_sessions</code> 表：

| 字段 | 含义 |
| --- | --- |
| <code>id</code> | 会话主键，也是 CSRF 绑定标识 |
| <code>user_id</code> | 所属用户，删除用户时级联删除 |
| <code>token_hash</code> | 256 位随机令牌的 SHA-256 摘要，唯一 |
| <code>created_at</code> | 创建时间 |
| <code>last_seen_at</code> | 最近活动时间 |
| <code>absolute_expires_at</code> | 最长有效期 |
| <code>revoked_at</code> | 主动撤销时间，可为空 |

浏览器持有的原始令牌不写入数据库、日志、URL 或响应正文。过期记录在认证时惰性清理，并在应用启动时做一次批量清理。

### 5.3 用户 AI 设置

新增 <code>user_ai_settings</code> 表，每个用户最多一行：

| 字段 | 含义 |
| --- | --- |
| <code>user_id</code> | 主键及外键 |
| <code>deepseek_config</code> | 不含密钥的接口地址、模型和超时 JSON |
| <code>generation_config</code> | 温度、最大输出、推理和上下文压缩配置 JSON |
| <code>api_key_ciphertext</code> | Fernet 加密后的 API Key，可为空 |
| <code>updated_at</code> | UTC 更新时间 |

继续复用当前配置规范化和边界校验，避免数据库中出现超范围生成参数。

### 5.4 资源所有权

- <code>cards.owner_user_id</code>：角色卡创建者。
- <code>worldbooks.owner_user_id</code>：世界书创建者；条目继承世界书所有权。
- <code>works.owner_user_id</code>：作品创建者。
- <code>conversations.user_id</code>：会话所有者。

这些列为兼容旧数据库而允许迁移阶段暂时为空；首次数据接管完成后，应用层禁止创建无主记录。外键使用 <code>ON DELETE RESTRICT</code>，因为首版不支持注销账号。每个所有权列建立索引。

消息、状态、摘要和存档不重复保存 <code>user_id</code>，以会话外键作为唯一归属链，避免两份所有权字段不一致。

### 5.5 迁移状态

新增通用 <code>app_meta</code> 键值表，并使用固定键 <code>account_migration_state</code> 保存账号迁移状态：

- <code>unclaimed</code>：尚无账号接管旧数据。
- <code>needs_secret_cleanup</code>：数据库认领已提交，但旧配置文件中的明文密钥尚未成功清理。
- <code>complete</code>：认领和可清理的明文密钥清理均完成。

状态转换必须幂等，重复启动不会重新分配所有权。

## 6. 用户名与密码规则

### 6.1 用户名

用户名处理顺序固定为：

1. 去除首尾空白。
2. 使用 Unicode NFKC 规范化。
3. 校验长度为 3 至 32 个 Unicode 字符。
4. 只允许 Unicode 字母、Unicode 数字、下划线和连字符。
5. 使用 Unicode <code>casefold</code> 生成 <code>username_key</code>。

展示时保留 NFKC 后的大小写，唯一性比较使用 <code>username_key</code>。因此 <code>Neko</code> 与 <code>neko</code> 不能注册为两个账号。

### 6.2 密码

- 长度为 10 至 128 个 Unicode 字符。
- 允许中文、空格、标点和密码管理器生成的字符。
- 不去除空白，不进行 Unicode 规范化，不强制大小写或数字组合。
- 使用 <code>pwdlib[argon2]</code> 的推荐 Argon2id 配置生成带盐摘要。
- 不存在的用户名也执行一次固定的虚拟摘要验证，降低基于响应时间的账号枚举风险。
- 登录失败统一返回“用户名或密码错误”。

## 7. 登录会话与 Cookie

- 每次登录使用密码学安全随机源生成 32 字节原始令牌。
- Cookie 名使用项目自定义的中性名称，设置 <code>HttpOnly</code>、<code>SameSite=Lax</code>、<code>Path=/</code>，不设置 <code>Domain</code>。
- 局域网 HTTP 模式下 <code>Secure=false</code>；公网模式必须配置 <code>Secure=true</code> 和 HTTPS。
- 服务端会话闲置 7 天失效，创建后最长 30 天失效。
- 为避免每个请求都写 SQLite，<code>last_seen_at</code> 最多每 5 分钟刷新一次；权限校验仍按真实请求时间判断。
- 登录永远签发新令牌，防止会话固定。
- 退出只撤销当前会话并清除 Cookie。
- 修改密码必须验证旧密码。成功后撤销该用户全部会话，再为当前浏览器签发一个新会话。
- 私有 API 响应和设置 Cookie 的响应使用 <code>Cache-Control: no-store</code>。

局域网 HTTP 无法防止同网段攻击者监听 Cookie。界面和启动日志必须明确提示这一风险，不能把 HTTP 局域网模式描述为公网安全。

## 8. CSRF、同源校验与限流

### 8.1 CSRF

新增 <code>GET /api/auth/csrf</code>。它返回一个短期有效的签名令牌，同时设置同值、主机限定的 CSRF Cookie。前端只把令牌保存在内存中，不写入 <code>localStorage</code>。

所有 <code>POST</code>、<code>PUT</code>、<code>PATCH</code> 和 <code>DELETE</code> 请求必须同时满足：

- <code>X-CSRF-Token</code> 请求头与 CSRF Cookie 使用常量时间比较相等。
- 令牌签名、用途和有效期正确。
- 登录后的令牌绑定当前 <code>auth_sessions.id</code>。
- 注册和登录使用短期匿名令牌；登录成功后立即轮换为绑定新会话的令牌。
- <code>Sec-Fetch-Site</code> 不得为 <code>cross-site</code>。
- <code>Origin</code> 存在时必须与目标 Origin 精确相同；缺失时使用 <code>Referer</code> 回退；两者都缺失的写请求拒绝。

CSRF 签名密钥通过 HKDF-SHA256 从每把加密主密钥派生，并使用固定的、版本化上下文字符串做用途隔离；验证依次尝试当前和旧派生密钥，以便轮换。

### 8.2 登录与注册限流

首期单进程部署使用进程内滑动窗口限流：

- 登录：同一“来源 IP + 规范化用户名”在 15 分钟内最多 5 次失败。
- 登录：同一来源 IP 在 15 分钟内最多 30 次失败。
- 注册：同一来源 IP 每小时最多 5 次尝试。
- 达到限制返回 <code>429</code> 和 <code>Retry-After</code>。
- 成功登录清除该 IP 与用户名组合的失败记录，不清除 IP 总量记录。

局域网直连时只使用 <code>request.client.host</code>。只有显式开启可信代理配置后才读取转发来源头，不能默认信任用户提交的 <code>X-Forwarded-For</code>。公网部署前必须把限流迁移到可持久化、可跨进程的存储。

## 9. API Key 加密与出站请求安全

### 9.1 主密钥

- 使用 <code>cryptography.fernet.MultiFernet</code> 加密个人 API Key。
- 局域网模式首次启动生成 <code>data/auth_keys.json</code>，并把该路径加入 <code>.gitignore</code>。
- 公网模式使用环境变量 <code>NEKO_AUTH_KEYS</code> 提供逗号分隔、最新密钥在前的 Fernet 密钥列表。
- 加密永远使用第一把密钥，解密依次尝试全部密钥，从而支持轮换。
- 使用旧密钥成功解密设置后，服务端用第一把密钥惰性重新加密并保存。
- 主密钥不得写入 SQLite、API 响应、日志或 Git。
- 如果本地密钥文件丢失但数据库已有密文，服务端生成新的本地主密钥，但不覆盖旧密文；设置响应返回 <code>api_key_unreadable=true</code>，用户仍能显式替换或清除损坏的密钥。聊天在替换或清除前返回 <code>503 api_key_unreadable</code>，不静默改用 Mock。部署文档必须要求备份主密钥。
- 如果环境变量或本地密钥文件存在但格式无效、权限不足或无法安全创建，认证写接口和个人设置接口返回 <code>503 secret_key_unavailable</code>，不得使用临时进程密钥继续运行。

数据库加密只降低数据库文件单独泄露时的风险；如果攻击者同时控制应用主机、数据库和主密钥，则无法靠此设计保护 API Key。

### 9.2 用户设置语义

- <code>GET /api/config</code> 返回只读的机器级 <code>app</code> 公开设置、当前用户的非敏感 AI/生成设置、<code>api_key_set</code> 和 <code>api_key_unreadable</code>。
- <code>PUT /api/config</code> 只接受个人 <code>deepseek</code> 和 <code>generation</code> 字段；提交 <code>app</code> 字段返回校验错误。未提供 <code>api_key</code> 时保留旧值；提供新值时替换；<code>clear_api_key=true</code> 时清除。新值与清除标志不能同时出现。
- 已保存 API Key 永不回填浏览器。
- <code>GET /api/models</code> 使用已保存的个人设置。
- <code>POST /api/models/preview</code> 可以使用本次请求提供的临时密钥，未提供时使用已保存密钥；临时密钥不落库、不进入日志。
- 用户没有 API Key 时，聊天继续使用现有确定性后端 Mock，不读取任何其他用户或全局密钥。
- 聊天、续写、选项恢复、上下文压缩和模型发现均显式加载当前会话所有者的配置。

### 9.3 SSRF 防护

开放注册用户不能让服务器向任意地址发起模型请求。机器级环境变量 <code>NEKO_AI_ALLOWED_ORIGINS</code> 保存允许的 AI 服务 Origin 列表，默认只包含 <code>https://api.deepseek.com</code>。升级前已由本机运行者配置的有效 Origin 在首次迁移时视为已批准 Origin。

用户提交的 Base URL 必须满足：

- Origin 与机器允许列表精确匹配；本地模型服务需要运行者显式加入列表。
- 只允许 HTTP 或 HTTPS；公网配置只允许 HTTPS。
- URL 不得包含用户名、密码、查询参数或片段。
- HTTP 客户端不得自动跟随到未批准 Origin 的重定向。

这样既保留每个账号独立的接口地址，又避免开放注册变成访问服务器内网服务的通道。

## 10. 授权规则与数据流

| 操作 | 访客 | 登录非创建者 | 创建者 |
| --- | --- | --- | --- |
| 浏览共享作品、角色卡、世界书 | 允许 | 允许 | 允许 |
| 创建或导入共享内容 | 拒绝 | 允许 | 允许 |
| 编辑、删除某项共享内容 | 拒绝 | 拒绝 | 允许 |
| 开始冒险 | 拒绝 | 允许 | 允许 |
| 访问自己的会话及存档 | 拒绝 | 允许 | 允许 |
| 访问他人的会话及存档 | 拒绝 | 404 | 404 |
| 读取或修改个人 AI 设置 | 拒绝 | 仅本人 | 仅本人 |

权限在两层执行：

1. 路由层使用 <code>optional_user</code>、<code>require_user</code>、<code>require_shared_owner</code> 和 <code>require_conversation_owner</code> 等统一依赖。
2. 仓储层的私有查询与写入也必须带 <code>user_id</code>，不能依靠调用方先查一次再裸写主键。

具体规则：

- 共享列表和详情使用可选用户，响应增加 <code>owner_username</code> 与 <code>can_edit</code>。
- 创建角色卡、世界书、作品和导入角色卡时，由服务端写入当前用户 ID，忽略客户端伪造的所有者字段。
- 更新作品与世界书的组合接口时，作品和世界书分别检查所有权。
- 如果作品引用他人的世界书，作品创建者只能更换引用或复制为自己的世界书，不能借组合接口修改原世界书。
- 会话列表始终过滤当前用户；详情、更新、开局、修正、消息、状态、骰子、快照、分支、聊天和停止生成都先验证会话所有权。
- 存档 ID 必须同时匹配已验证的会话 ID，不能只按存档主键操作。
- 聊天进程内锁仍按会话 ID 管理，但取得锁、停止事件或开始流式生成之前必须完成所有权检查。
- 生成过程中所有内部读取都沿用已经验证的会话 ID 和所有者 ID，不能再次退回无所有者条件的查询。

## 11. API 设计

### 11.1 新增认证接口

- <code>GET /api/auth/csrf</code>：签发或刷新 CSRF 令牌。
- <code>GET /api/auth/me</code>：返回 <code>authenticated</code> 和当前公开用户资料；匿名访问返回 200。
- <code>POST /api/auth/register</code>：注册并登录；首个账号可能同时触发旧数据接管。
- <code>POST /api/auth/login</code>：验证用户名密码并签发会话。
- <code>POST /api/auth/logout</code>：撤销当前会话并清 Cookie，返回 204。
- <code>PUT /api/auth/password</code>：验证旧密码、更新摘要、撤销旧会话并签发新会话。

注册成功响应包含公开用户资料和布尔字段 <code>legacy_data_claimed</code>；只有本次事务把状态从 <code>unclaimed</code> 推进时该字段为 <code>true</code>，供首个账号显示一次性接管提示。公开用户资料只包含 ID、用户名和创建时间。

### 11.2 现有接口调整

- 共享资源的 <code>GET</code> 接口保持公开。
- 共享资源的写接口、导入接口和全部会话接口要求登录。
- <code>/api/config</code>、<code>/api/models</code> 和 <code>/api/models/preview</code> 要求登录并使用个人设置。
- <code>/api/health</code> 保持公开，但移除或替换全局 <code>ai_enabled</code>，因为个人密钥状态不能作为机器级健康信息公开。
- 保持现有字段的 <code>snake_case</code>、统一错误包装和 SSE 事件名称。

## 12. 前端体验

### 12.1 认证状态与导航

- 应用初始化时并行读取共享库和 <code>/api/auth/me</code>，认证接口异常不能阻塞公开浏览。
- 顶栏匿名状态显示“登录 / 注册”；登录状态显示用户名、账号设置、AI 设置和退出。
- 增加登录、注册和账号设置页面。
- 需要登录的操作保存当前合法 Hash 路由到 <code>sessionStorage</code>，登录成功后返回；不接受外部 URL，避免开放重定向。
- 收到 <code>401 authentication_required</code> 时，统一请求层触发登录流程；<code>403</code> 和 <code>404</code> 保持各自业务提示。

### 12.2 内容权限提示

- 内容卡片和详情显示创建者用户名。
- 自己的内容显示“我的”标记和编辑、删除操作。
- 非创建者只能查看和引用。
- 被引用内容删除失败时展示后端返回的引用作品列表。
- 编辑被引用角色卡或世界书时，列出可能受影响的作品并二次确认。

### 12.3 请求安全

- 同源 <code>fetch</code> 明确使用 Cookie 凭据。
- 统一请求层从 <code>/api/auth/csrf</code> 获取令牌，在所有写请求中添加 <code>X-CSRF-Token</code>。
- CSRF 令牌只保存在内存；过期或登录轮换后自动刷新一次并重试原请求。
- API Key 输入框留空表示保留；清除必须使用单独按钮和确认。
- 启动时删除旧版 <code>adventure_api_key_draft</code>，之后 API Key 不进入 <code>localStorage</code>、<code>sessionStorage</code> 或 URL。

### 12.4 只读演示

- 后端不可用时只从不可变的内置默认数据渲染作品、角色卡和世界书。
- 忽略旧浏览器本地写入数据，但不主动删除。
- 页面显示“只读演示”状态，所有创建、编辑、删除、导入、设置和开始冒险按钮禁用并说明原因。
- 不创建本地伪账号，也不声称离线数据已归属用户。

## 13. 首次注册与旧数据迁移

数据库结构迁移在应用启动时幂等增加新表、列和索引，不删除、不重建现有业务表。

首次注册流程：

1. 在进入数据库事务前确保加密主密钥可用，并准备好旧有效 AI 配置的加密副本。
2. 使用 SQLite <code>BEGIN IMMEDIATE</code>，阻止两个并发注册同时成为接管者。
3. 创建用户；如果迁移状态为 <code>unclaimed</code>，把全部空所有者的角色卡、世界书、作品和旧会话分配给该用户。
4. 把升级前的有效 DeepSeek、模型和生成配置写入该用户设置。只有 API Key 使用 Fernet 密文。
5. 如果配置文件中没有可清理的明文 Key，在同一事务中把状态设为 <code>complete</code>；否则设为 <code>needs_secret_cleanup</code> 后提交。
6. 使用临时文件和原子替换只清空 <code>config.json</code> 中的旧 <code>deepseek.api_key</code>，保留应用启动配置及其他字段。
7. 清理成功后把迁移状态更新为 <code>complete</code>，再为注册浏览器创建登录会话。

如果第 6 步失败：

- 已提交的用户、所有权和加密设置不回滚，避免丢失唯一可恢复副本。
- 注册请求返回明确的 <code>503 migration_pending</code>，不签发登录会话。
- 公开只读接口继续工作；注册、登录及所有业务写接口暂停。
- 下次启动先自动重试清理。清理完成后，首个用户可以正常登录；后续注册才能继续。

如果旧 Key 来自 <code>DEEPSEEK_API_KEY</code> 环境变量，程序无法删除环境变量。它仍只迁给首个用户；完成数据库迁移和配置文件清理后允许系统运行，但输出不含密钥值的运维警告，要求运行者移除该旧环境变量。账号系统进入正常状态后，聊天不再把全局环境变量作为任何用户的回退密钥。

迁移测试必须使用临时数据库、临时配置和临时密钥，不能启动真实 <code>data/app.db</code> 的认领流程，也不能读取或打印真实 <code>config.json</code> 的密钥。

## 14. 错误处理

所有业务错误保持：

~~~json
{"error":{"code":"...","message":"..."}}
~~~

固定状态码和错误码：

- 未登录访问私有功能：<code>401 authentication_required</code>。
- 修改其他用户的共享内容：<code>403 forbidden</code>。
- 查询其他用户的会话或存档：<code>404 not_found</code>。
- 用户名已占用：<code>409 username_taken</code>。
- 角色卡或世界书仍被引用：<code>409 resource_in_use</code>，附安全的引用作品摘要。
- CSRF 或同源校验失败：<code>403 csrf_failed</code>。
- 登录或注册限流：<code>429 rate_limited</code>。
- 旧密钥清理待恢复：<code>503 migration_pending</code>。
- 加密主密钥不可用：<code>503 secret_key_unavailable</code>。
- 已有个人 API Key 因主密钥丢失而无法解密：<code>503 api_key_unreadable</code>。

认证失败、解密失败和上游 AI 错误不得把密码、Cookie、CSRF 令牌、API Key、完整 Authorization 头或密钥文件内容写入日志或响应。

SSE 保持当前 <code>meta</code>、<code>delta</code>、<code>context</code>、<code>state</code>、<code>error</code> 和 <code>done</code> 契约。认证和 CSRF 在开始流式响应前完成；流建立后仍沿用当前的停止、部分消息持久化、结构化输出过滤和自动存档行为。

## 15. 测试策略

### 15.1 后端

新增或扩展自动化测试覆盖：

1. 用户名 NFKC、大小写折叠、字符范围、重复注册和并发注册。
2. 密码长度、Unicode 和空格保留、Argon2id 摘要、虚拟摘要验证和错误登录。
3. 原始会话令牌不落库，闲置与绝对过期、惰性活动刷新、退出和改密撤销。
4. 匿名及登录 CSRF、Origin/Referer、Fetch Metadata 和统一错误结构。
5. 登录与注册限流以及 <code>Retry-After</code>。
6. 访客能读共享库，但不能创建、导入、编辑、删除或开始冒险。
7. 两个用户之间的角色卡、世界书、条目、作品及组合保存所有权。
8. 两个用户之间的会话、消息、状态、骰子、开局、修正、存档、读档、分支、聊天和停止越权。
9. 角色卡与世界书的引用删除保护。
10. 个人 AI 配置、密钥加密、替换、清除、脱敏和允许 Origin 校验。
11. 聊天、选项恢复和上下文压缩使用会话所有者配置，不串用其他用户或旧全局 Key。
12. 首次接管、无旧数据、并发注册、重复启动、数据库回滚、配置清理失败和启动重试。
13. 旧环境变量 Key 的一次性继承与不再回退。
14. SSE 正常生成、停止、上游错误、部分消息持久化、状态事件与自动存档回归。

### 15.2 前端

新增或扩展 Node 测试覆盖：

1. 登录、注册、退出、改密和登录后返回原页面。
2. 匿名、创建者和非创建者三种页面权限。
3. 顶栏账号状态、创作者显示和“我的”标记。
4. 统一请求层携带 Cookie 与 CSRF，令牌轮换及 401 登录跳转。
5. API Key 不回填、不落本地存储，保留、替换和显式清除语义。
6. 后端不可用时只读内置示例，全部写入与试玩入口禁用。
7. 旧浏览器离线数据被忽略但不删除。
8. 现有作品库、创作台、角色卡、开局、聊天、存档和设置行为继续通过。

### 15.3 完整验证

实现完成后依次执行：

1. 新增认证、迁移、权限和用户设置窄测试。
2. 全部后端 <code>unittest</code>。
3. 全部前端 <code>node:test</code>。
4. 使用临时数据目录启动单进程服务器做浏览器烟测：
   - 访客浏览共享库；
   - 注册首个账号并接管旧测试数据；
   - 第二账号验证共享内容可读、不可编辑；
   - 两个账号分别创建和访问私有会话；
   - 两个账号分别配置 AI；
   - 流式生成、停止、存档和退出。
5. 检查 Git 状态，确认未改动真实 <code>data/app.db</code>、未泄露密钥、未覆盖任务开始前已有的用户修改。

## 16. 部署与公网升级边界

### 16.1 局域网首版

- 继续使用一个 Uvicorn 进程，不启用多 worker。
- 可由运行者配置监听局域网地址。
- HTTP 下使用非 Secure Cookie，并在启动日志与设置页提示同网段监听风险。
- 默认不信任代理转发头。
- 限流状态保存在单进程内存中。
- 加密主密钥可保存在已忽略的本地密钥文件中。

### 16.2 公网化前必须完成

- 反向代理或应用入口启用 HTTPS，Cookie 设置 <code>Secure</code>。
- 配置固定可信 Host、Origin 和代理来源，只信任明确的转发头。
- <code>NEKO_AUTH_KEYS</code> 由部署密钥管理提供，不使用项目目录文件。
- 登录与注册限流迁移到持久化存储，并补充监控告警。
- AI 服务 Origin 采用严格机器级允许列表，只允许 HTTPS。
- 补充安全响应头、备份恢复演练和会话/认证事件审计。
- 完成公网环境的 CSRF、Cookie、反向代理和越权渗透测试。

这些变化不需要重写用户、所有权、个人 AI 设置或服务端会话数据模型。

## 17. 验收标准

- 访客可以浏览共享内容，不能执行任何写入或开始冒险。
- 任意用户可开放注册、登录、退出、查看账号和验证旧密码后改密。
- 密码仅以 Argon2id 摘要保存，原始登录令牌和 API Key 不以明文进入数据库。
- 共享内容创建者可管理自己的内容，不能管理他人内容。
- 登录用户可引用他人的公开角色卡和世界书，但不能借引用关系修改它们。
- 任意两个用户之间的会话、消息、状态、长期记忆、修正、存档、分支和流式生成完全隔离。
- 首个账号且仅首个账号接管全部旧业务数据与旧有效 AI 配置。
- 旧配置文件明文 Key 清理可恢复、可重试，不会静默留下两份明文副本。
- 每个账号的 AI 设置和 API Key 相互隔离；无个人 Key 时只使用 Mock。
- 后端不可用时仅保留内置示例只读浏览，不创建本地账号或可写冒险。
- 现有 SSE、停止、结构化输出、状态合并、上下文压缩和自动存档契约保持兼容。
- 新增窄测试、完整后端测试和完整前端测试全部通过。
- 真实数据库、真实配置密钥和任务开始前已有的未提交改动均得到保留。

## 18. 参考资料

- [FastAPI：OAuth2、密码哈希与令牌示例](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Starlette Middleware 与 Cookie 安全属性](https://www.starlette.io/middleware/)
- [Cryptography Fernet 与 MultiFernet](https://cryptography.io/en/latest/fernet/)

实现只借鉴上述官方接口和安全模式，不直接复制来源不明的完整账号代码。
