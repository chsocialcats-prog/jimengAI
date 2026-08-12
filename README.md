# AI 对话冒险平台

个人单机、单用户的中文 AI 文字冒险应用。后端使用 FastAPI、Uvicorn 和 SQLite，前端是无构建步骤的 HTML/CSS/ES module。配置 DeepSeek 兼容 API 后使用真实流式生成；未配置密钥时使用确定性的 mock 回复，前端在后端不可用时也保留离线演示数据。

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

API 配置可通过应用设置页或环境变量提供：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

本地 `config.json` 可能包含真实密钥，不要读取、复制或提交其秘密值。SQLite 运行数据位于 `data/app.db`，也不应手动编辑或提交。

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
├── index.html             应用壳和静态资源入口
├── css/style.css          页面样式
└── js/                    hash 路由、数据层、页面模块和聊天模块
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

完整前端测试：

```powershell
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

启动服务后可运行后端冒烟测试：

```powershell
python backend/smoke_test.py
```

当前 API 路由和 schema 以 `backend.main.app.openapi()`、`backend/schemas.py`、路由实现及测试为准；`docs/api-contract.md` 只保留流式事件与兼容行为，避免维护一份容易过期的完整 API 副本。
