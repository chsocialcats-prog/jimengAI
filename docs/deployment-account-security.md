# 账号安全部署与恢复

本文面向本地、局域网和反向代理部署。它不包含真实 API key、密码、Cookie 或主密钥；示例中的尖括号值必须由部署者在安全环境中替换。

## 启动

开发机安装依赖后使用单进程启动：

```powershell
python -m pip install -r requirements.txt
python start.py --no-browser
```

默认监听 `127.0.0.1:8000`。后端的会话生成锁和 stop 事件在进程内存中，不能使用 Uvicorn 多 worker、多进程或会把请求分发到多个独立实例的配置。

隔离测试应使用临时数据目录和临时主密钥路径，例如：

```powershell
$env:NEKO_DATA_DIR = '<temporary-data-dir>'
$env:NEKO_AUTH_KEY_PATH = '<temporary-auth-key-file>'
$env:NEKO_COOKIE_SECURE = 'false'
python start.py --no-browser
```

不要用项目真实 `data/`、真实 `config.json` 或生产主密钥做注册迁移测试。仓库内的 `backend/smoke_test.py` 要求服务已启动，并会注册一个带时间后缀的测试账号；完成后应删除该临时数据目录。

## 环境变量

| 变量 | 用途与建议 |
| --- | --- |
| `NEKO_DATA_DIR` | SQLite 和运行数据目录；生产应放在受限目录并纳入备份。 |
| `NEKO_AUTH_KEYS` | Fernet 主密钥轮换列表；只从密钥管理系统注入，不进 Git、shell 历史或日志。 |
| `NEKO_AUTH_KEY_PATH` | 主密钥文件路径；文件权限应只允许服务账号读取。 |
| `NEKO_COOKIE_SECURE` | HTTPS 必须为 `true`；仅本机 HTTP 开发可为 `false`。 |
| `NEKO_PUBLIC_ORIGIN` | 固定浏览器 origin，例如 `https://adventure.example`；不要留空后依赖任意 Host。 |
| `NEKO_TRUSTED_PROXY_CIDRS` | 仅填写自有反向代理的 CIDR，禁止信任任意转发头。 |
| `NEKO_AI_ALLOWED_ORIGINS` | AI provider origin 白名单；限制为实际使用的 HTTPS origin。 |
| `NEKO_AI_HTTPS_ONLY` | 生产建议为 `true`，拒绝明文 AI endpoint。 |
| `DEEPSEEK_API_KEY` | 可选的旧版/环境配置来源；不要在文档、日志或提交中写入值。 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | provider 地址和模型；地址必须通过允许列表校验。 |

局域网 HTTP 下 `Secure=false` 的 Cookie 可能被同网段观察或劫持，且未加密的 AI 请求可能暴露提示词和响应。它只适合可信开发网络；公开或不可信网络必须由 HTTPS 反向代理终止 TLS，并设置 `NEKO_COOKIE_SECURE=true`、固定 `NEKO_PUBLIC_ORIGIN` 和可信代理网段。

## 账号隔离与浏览器安全

会话、消息、状态、快照、分支和 AI 设置按账号隔离。公共角色卡、世界书和作品可读，但只有所有者可写；跨账号私有资源按不可见处理。服务端不信任请求体中的 owner 字段。

浏览器保存 HttpOnly、SameSite=Lax 的 `neko_session` 和双提交用的 `neko_csrf`。所有非安全方法都必须通过同源 `Origin`/`Referer` 检查并提交 `X-CSRF-Token`。反向代理必须正确传递且只在可信网段接受转发来源；不要用通配来源、关闭 CSRF 或把会话 token 放进 URL。

AI key 在服务端加密存储，API 只返回 `api_key_set`，日志只能记录 provider、模型、耗时和错误类别，不能记录 key、Authorization、Cookie、密码或完整 prompt。对 provider 地址启用 origin/HTTPS allowlist，避免把设置接口变成 SSRF 入口。

## 迁移、密钥轮换与恢复

第一个账号注册时，旧数据库中的无主资源会在事务中认领到该账号；旧配置中的明文 key 会被加密迁移，然后清理旧字段。如果密钥不可读或清理失败，状态会保持 pending，业务写请求返回 `migration_pending`，不要强行编辑数据库或删除状态记录。

恢复步骤：

1. 先停止服务，恢复同一版本的数据目录和 Fernet 主密钥备份。
2. 在隔离副本上验证能读取账号、资源和加密 AI 设置，再恢复服务。
3. 轮换主密钥时保留旧 key 直到所有数据重新加密并完成回读验证，然后再撤销旧 key。
4. 仅在确认备份可恢复后清理旧介质；不要把数据库或密钥文件发到 issue、聊天或日志系统。

数据库备份必须与主密钥备份成对保存。丢失主密钥时，加密 AI key 不可恢复；可以重置账号 AI 设置，但不得尝试猜测或打印旧密文。

## 发布前检查

- 使用临时 `NEKO_DATA_DIR` 和临时主密钥运行账号注册、双账号隔离和 SSE smoke；不要连接真实配置。
- 运行 `python -m unittest discover -s backend -p 'test_*.py'`、`python -m compileall -q backend` 和 `git diff --check`。
- 确认只运行一个 Uvicorn worker，反向代理已启用 TLS，Cookie Secure 和 public origin 与外部地址一致。
- 检查日志、错误追踪和备份中没有 key、密码、Cookie、Authorization 或完整用户提示词。
- 对局域网部署明确告知：任何能访问明文端口的设备都应视为可窃听或干扰者；需要账号隐私时使用 HTTPS 和网络访问控制。
