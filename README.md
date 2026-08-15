# AI 对话冒险平台

本地优先的多账号中文 AI 文字冒险应用。后端使用 FastAPI、Uvicorn 和 SQLite，前端是静态导出的 Next.js 应用。配置 DeepSeek 兼容 API 后使用真实流式生成；未配置密钥时使用确定性的 mock 回复。

账号之间严格隔离会话、消息、状态、快照、分支和个人 AI 设置。角色卡、世界书和作品是可发现的公共资源，但只有所有者可以创建、修改和删除；列表和详情会返回 `owner_username` 与 `can_edit`，用于区分可读和可写权限。

## 当前能力

- 作品库、作品详情和创作台
- 有序多角色卡、角色卡独立库、世界书和关键词触发
- 开局设定、玩家属性、回复模板和封面
- SSE 流式对话、剧情选项、结构化状态变化和快捷指令
- 上下文压缩、长期记忆、手动/自动存档、读档和会话分支
- 在线 DeepSeek、后端 mock，以及前端离线兼容存储

## 启动

在项目根目录安装依赖并启动单个 Uvicorn 进程：

```powershell
python -m pip install -r requirements.txt
python start.py
```

服务地址为 `http://127.0.0.1:8000`。自动打开浏览器时使用 `python start.py`；只启动服务时使用：

```powershell
python start.py --no-browser
```

应用依赖进程内的会话生成锁和停止事件，请不要使用 Uvicorn 多 worker 或多进程模式。

## 本地配置

账号安全和运行时配置通过环境变量提供；AI 配置也可通过登录后的应用设置页提供：

- `NEKO_DATA_DIR`：SQLite 数据目录，默认是 `data/`
- `NEKO_AUTH_KEYS`：Fernet 主密钥轮换列表（逗号分隔）；不要写入仓库或日志
- `NEKO_AUTH_KEY_PATH`：主密钥文件路径，默认位于数据目录
- `NEKO_COOKIE_SECURE`：HTTPS 部署设为 `true`；本地 HTTP 才使用 `false`
- `NEKO_PUBLIC_ORIGIN`：浏览器实际访问的固定 origin，例如 `https://adventure.example`
- `NEKO_TRUSTED_PROXY_CIDRS`：仅填写自有反向代理网段
- `NEKO_AI_ALLOWED_ORIGINS`：AI provider origin 白名单
- `NEKO_AI_HTTPS_ONLY`：生产环境建议设为 `true`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

本地 `config.json` 可能包含真实密钥，不要读取、复制或提交其秘密值。SQLite 运行数据位于 `data/app.db`，也不应手动编辑或提交。

新实例的第一个注册账号会在事务中认领旧的无主资源，并将旧配置中的明文 API key 加密迁移到该账号；清理未完成时写请求会被拒绝，恢复方式见 [`docs/deployment-account-security.md`](docs/deployment-account-security.md)。请先备份数据目录和主密钥，再做迁移或轮换。不要使用多 worker：会话生成锁和 stop 事件保存在单进程内存中。

浏览器使用 HttpOnly 的 `neko_session` 会话 Cookie 和非 HttpOnly 的 `neko_csrf` 双提交 Cookie。所有写请求都必须带同源 `Origin`/`Referer` 和 `X-CSRF-Token`。局域网 HTTP 仅适合可信开发网络；它不能防止同网段窃听或会话劫持，公开部署必须使用 HTTPS、Secure Cookie 和固定 public origin。

## 项目结构

```text
backend/
├── ai/                    DeepSeek/OpenAI 兼容客户端与 mock 客户端
├── repository/            cards、works、worldbooks、conversations、snapshots
├── routers/               配置、资源 CRUD、导入和 SSE 聊天路由
├── services/              冒险引擎、上下文、状态、命令和存档服务
├── database.py            SQLite 初始化与迁移
├── schemas.py             API 请求模型
└── smoke_test.py          运行中服务的后端冒烟测试
frontend/
├── app/                   Next 路由和全局样式
├── components/            页面视图与通用 UI 组件
├── lib/                   API、会话和前端状态工具
├── public/                公开静态资源
├── out/                   由 Next 导出的运行时静态文件
└── package.json           前端构建脚本与依赖
docs/
├── api-contract.md        SSE 与兼容语义 notes
├── superpowers/baselines/ 清理前行为基线
└── archive/               历史计划、handoff 和一次性 QA 资源
start.py                   Windows 启动器
```

## 测试

完整后端测试（包含根目录启动器测试迁移后的标准发现范围）：

```powershell
python -m unittest discover -s backend -p 'test_*.py'
```

前端类型检查与静态导出：

```powershell
Push-Location frontend
pnpm exec tsc --noEmit
pnpm build
Pop-Location
```

启动服务后可运行后端冒烟测试：

```powershell
python backend/smoke_test.py
```

当前 API 路由和 schema 以 `backend.main.app.openapi()`、`backend/schemas.py`、路由实现及测试为准；[`docs/api-contract.md`](docs/api-contract.md) 记录认证、隔离、SSE 和兼容行为，避免维护一份容易过期的完整 API 副本。
