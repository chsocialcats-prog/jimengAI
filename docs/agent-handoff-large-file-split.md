# 超大文件渐进拆分交接

更新时间：2026-08-11

## 目标与原则

本轮已完成以下两个超大文件的渐进拆分：

- `frontend/js/main.js`
- `backend/repositories.py`

拆分只移动已有职责，没有修改 HTTP API、SSE、数据库 schema、hash 路由、localStorage key 或用户文案。后端调用方继续使用原 facade，前端入口继续负责应用壳和路由。

不要再按单个函数拆小文件。模块应对应稳定领域、完整页面或事务边界，通常保持约 100 至 500 行。`conversation_repository.py`、`data.mjs`、`creator-page.mjs` 和 `adventure-page.mjs` 略超过 500 行是有意的：继续拆分会破坏会话生命周期、唯一数据源或页面 controller 的内聚性。

## 前端拆分

新增模块：

- `frontend/js/core/format.mjs`：`esc`、时间格式化和数值 clamp。
- `frontend/js/chat/reply-length.mjs`：回复长度档位、归一化和按会话持久化。
- `frontend/js/domain/role-cards.mjs`：角色卡归一化、有序作品角色、会话冻结角色解析和摘要。
- `frontend/js/data.mjs`：HTTP/SSE、online/mock/offline 三态、离线 store、配置以及全部数据用例。
- `frontend/js/creator-page.mjs`：完整创作台页面、表单状态、作品属性、世界书条目、onboarding、回复模板和有序角色卡编辑。
- `frontend/js/adventure-page.mjs`：完整冒险/开局页面、session controller、消息流、状态栏、存档、修正、停止和离页状态。

`frontend/js/main.js` 继续作为浏览器 ESM 入口，文件从约 3314 行降至约 1230 行。当前只保留应用启动、hash 路由、全局 modal/theme/age gate，以及尚未迁移的作品库、作品详情、角色卡和设置页面。

使用 `.mjs` 是有意的：项目没有 `package.json`，Node 测试可以直接导入 `.mjs`，不需要改变整个项目的模块类型。FastAPI 静态服务已确认以 `application/javascript` 返回这些文件。

### Data 边界

`data.mjs` 是前端数据的唯一真源。`main.js` 中已无直接 `fetch`、`/api/` 请求、mock store 或数据存储 key 操作。主题和年龄确认仍由应用壳持有，回复长度仍由 `chat/reply-length.mjs` 持有。

必须保持：

- `MODE` 的 `online/mock/offline` 三态语义，其中 `mock` 仍调用真实后端。
- 统一 API error 的 `message/status/detail`。
- SSE handler、尾部无换行事件和结构化事件分发契约。
- `adventure_mock_data`、`adventure_mock_settings`、API key draft 的兼容迁移。

### 页面 API

`creator-page.mjs` 导出 `configureCreatorPage()`、`renderCreator()` 和角色卡编辑器仍需复用的动态行 helper。`workCardIds()` 与 `cardPersonalitySummary()` 已归入 `domain/role-cards.mjs`。

`adventure-page.mjs` 导出 `configureAdventurePage()`、`renderAdventure()`、`renderOnboarding()`、`activeAdventureHash()`、`hasUnsavedProgress()`、`saveBeforeLeave()` 和 `dispose()`。`main.js` 不再持有 `session`；离页 guard 只查询 controller。`dispose()` 会移除 `appEl` listener，避免重复进入冒险页后累积事件处理器。

相关测试已改为读取所属页面模块或直接 import 纯函数。新增页面时不要重新使用“所有逻辑都塞回 main.js 再截取源码”的测试方式。

## 后端拆分

新增包 `backend/repository/`，当前文件如下：

- `normalizers.py`：onboarding、回复模板和状态归一化。
- `cards.py`：角色卡 CRUD、引用检查和删除事务。
- `worldbooks.py`：世界书及条目 CRUD。
- `works.py`：作品 CRUD、有序角色卡关系和 legacy 字段兼容。
- `work_bundles.py`：作品、世界书、条目和角色卡顺序的跨领域原子保存。
- `conversation_repository.py`：会话、消息、状态和长期记忆的完整生命周期。
- `snapshot_repository.py`：存档 public/private 映射、手动/自动存档和原子恢复。

`backend/repositories.py` 仍是兼容 facade。现有 routers、services 和 tests 不需要修改 import，公开符号仍可通过 `repositories.<name>` 使用。文件从约 1706 行降至约 191 行。

### 连接注入兼容

以下 facade 函数不是简单别名，而是 wrapper：

- `delete_card()`
- `create_work()`
- `update_work()`
- `save_work_bundle()`
- `create_conversation()`
- `create_conversation_branch()`
- `complete_conversation_onboarding()`
- `create_message()`
- `replace_messages()`
- `get_state()` / `save_state()`
- `save_memory_summary()`
- `create_snapshot()` / `restore_snapshot()`

wrapper 会把 `repositories.connect` 传给新实现。这保留了已有测试通过 patch `repositories.connect` 注入失败连接的能力，也避免事务内意外切换连接。

### 作品兼容约束

`backend/repository/works.py` 必须继续保持：

- 显式 `card_ids` 优先于 legacy `card_id`。
- 更新时两者都未传表示保留现状。
- `card_ids=[]` 或 `card_id=None` 表示明确清空。
- `work_cards` 保存顺序，同时把第一项同步到 `works.card_id`。
- 输出同时包含 `card_ids/cards` 和首项兼容字段 `card_id/card`。

不要在拆分过程中顺手修改 `row_to_work()` 的查询策略或 N+1 行为；性能优化应作为独立变更并增加测试。

### Bundle 事务位置

`save_work_bundle()` 的实际实现已从 `backend/repositories.py` 迁到：

```text
backend/repository/work_bundles.py
```

兼容入口仍是 `backend.repositories.save_work_bundle()`。`docs/agent-handoff-snapshot-and-atomic-save.md` 中记录的事务语义仍然有效，但其中实现路径已过时。

Bundle 必须在同一个 `BEGIN IMMEDIATE` 中完成世界书、条目、作品和角色卡顺序写入。connection-aware 的 `validate_card_ids()` 与 `replace_work_cards()` 位于 `works.py`，事务实现调用它们时不会新开连接。

### 会话与存档边界

`conversation_repository.py` 必须整体保留以下语义：

- `ConversationRecord` 的非序列化属性用于区分“明确无角色”与 legacy 空快照，不能替换为普通 dict。
- 非空 `card_snapshots`、无卡 marker 和旧数据 live fallback 构成三态兼容。
- branch 复制冻结角色、状态、修正和关联信息，但不复制消息，并初始化空长期记忆。
- 消息 `MAX(sequence)+1` 和 INSERT 位于同一个 `BEGIN IMMEDIATE`。
- 长期记忆同时保存 `summary` 和 `covered_until_sequence`。

`snapshot_repository.py` 只能依赖 conversation 模块的 connection-aware primitive。存档创建必须在同一事务读取状态、消息、摘要 coverage 和修正；恢复必须在同一事务写回状态、消息、摘要、修正和 `conversations.current_state`。

旧存档 corrections 的 SQL `NULL` 表示保留当前修正，新存档的 `[]` 表示明确清空。不要把两者归一化。自动存档仍通过名称“自动存档”查找最新记录并覆盖，没有独立 autosave 列。

## 测试结果

最后一次完整验证：

```text
后端：142 tests passed
前端：83 tests passed
```

本机 WSL `python3` 未安装 FastAPI/Pydantic，完整后端测试使用 Windows Python 3.11：

```text
/mnt/c/Users/Admin/AppData/Local/Programs/Python/Python311/python.exe
```

标准项目命令仍为：

```powershell
python -m unittest discover -s backend -p 'test_*.py'
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

开发服务器已使用 `start.py --no-browser` 重启，地址为 `http://127.0.0.1:8000`。

## 后续建议

当前拆分目标已经完成。后续只有在继续增加对应功能时，才考虑把 `main.js` 中剩余页面按完整页面迁出，例如作品库/详情、角色卡或设置；不要仅为了降低行数继续拆分。

真实后端流式聊天尚未进行浏览器手工回归。现有测试覆盖 SSE、停止、partial/done、上下文压缩、状态变化、快照恢复和离页行为；修改这些链路后仍建议通过浏览器完成一次真实或 mock 后端会话。

## 协作注意

工作树在本轮开始前已经包含大量其他未提交修改，包括数据库迁移、存档修正、创作台原子保存、前端样式和 Live2D 文件。不要 reset、checkout、整文件覆盖或批量格式化这些文件。

`config.json` 可能含真实 API key，不要读取、打印或提交其中的密钥。`data/app.db` 是运行时数据，不要编辑或纳入版本控制。
