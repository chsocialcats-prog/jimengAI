# AI 对话冒险平台 API 契约（W1 版）

本契约供后续 W2/W3/W4 线程使用。W1 当前只实现 `GET /api/health` 与前端静态页，其余接口按本文约定实现，避免前后端接口不一致。

## 1. 通用约定

- Base URL：`http://127.0.0.1:8000`
- 普通请求与响应使用 `application/json; charset=utf-8`
- 流式对话使用 `text/event-stream; charset=utf-8`
- 字段命名统一为 `snake_case`
- 时间格式统一为 ISO 8601 本地时间字符串，例如 `2026-08-09T12:00:00`
- 列表接口使用 `page`（从 1 开始）与 `page_size`（默认 20，最大 100）
- 列表响应统一为：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 20
}
```

- 错误响应统一为：

```json
{
  "error": {
    "code": "not_found",
    "message": "资源不存在"
  }
}
```

- 常见错误码：`validation_error`、`not_found`、`conflict`、`config_error`、`api_error`、`internal_error`

## 2. 当前已实现

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |

响应示例：

```json
{
  "status": "ok",
  "service": "ai-adventure",
  "database": "initialized",
  "ai_enabled": false
}
```

## 3. 配置读写

配置存储在项目根目录 `config.json`，DeepSeek API Key 只保存在本机。

### GET `/api/config`

读取当前配置。`api_key` 不返回明文，只返回 `api_key_set`。

```json
{
  "app": {
    "host": "127.0.0.1",
    "port": 8000,
    "open_browser": true
  },
  "deepseek": {
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "api_key_set": false,
    "timeout_seconds": 60
  },
  "generation": {
    "temperature": 0.8,
    "max_tokens": 2048
  }
}
```

### PUT `/api/config`

请求体支持全量或局部覆盖，`api_key` 允许写空字符串表示清除密钥。

```json
{
  "deepseek": {
    "api_key": "sk-...",
    "model": "deepseek-chat"
  },
  "generation": {
    "temperature": 0.7
  }
}
```

响应为保存后的完整配置，格式与 `GET /api/config` 相同。

## 4. 作品 CRUD

### 数据字段

```json
{
  "id": 1,
  "title": "作品名",
  "description": "作品简介",
  "card_id": 1,
  "worldbook_id": 1,
  "opening": "开场剧情文本",
  "tags": ["20+", "奇幻"],
  "is_archive": false,
  "created_at": "2026-08-09T12:00:00",
  "updated_at": "2026-08-09T12:00:00"
}
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/works?q=&tag=&page=&page_size=` | 作品列表，支持标题搜索与标签过滤 |
| POST | `/api/works` | 创建作品 |
| GET | `/api/works/{work_id}` | 作品详情 |
| PUT | `/api/works/{work_id}` | 更新作品 |
| DELETE | `/api/works/{work_id}` | 删除作品，成功返回 204 |

`POST /api/works` 请求体：

```json
{
  "title": "作品名",
  "description": "作品简介",
  "card_id": 1,
  "worldbook_id": 1,
  "opening": "开场剧情文本",
  "tags": ["20+", "奇幻"]
}
```

## 5. 角色卡 CRUD

### 数据字段

```json
{
  "id": 1,
  "name": "角色名",
  "persona": "身份、性格、说话方式、记忆锚点",
  "personality": "性格细节",
  "speaking_style": "语气与口头禅",
  "relationships": {
    "玩家": "重要关系说明"
  },
  "directives": ["保持人设"],
  "initial_state": {
    "attributes": { "魅力": 60, "武力": 40 },
    "items": [],
    "relations": {}
  },
  "source": "local",
  "created_at": "2026-08-09T12:00:00",
  "updated_at": "2026-08-09T12:00:00"
}
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/cards?q=&page=&page_size=` | 角色卡列表 |
| POST | `/api/cards` | 创建角色卡 |
| GET | `/api/cards/{card_id}` | 角色卡详情 |
| PUT | `/api/cards/{card_id}` | 更新角色卡 |
| DELETE | `/api/cards/{card_id}` | 删除角色卡，成功返回 204 |

## 6. 世界书 CRUD

### 数据字段

```json
{
  "id": 1,
  "title": "世界书标题",
  "description": "世界书说明"
}
```

世界书条目：

```json
{
  "id": 1,
  "worldbook_id": 1,
  "title": "条目标题",
  "keywords": ["王城", "王都"],
  "content": "条目内容，命中关键词时注入上下文",
  "priority": 10,
  "enabled": true
}
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/worldbooks?page=&page_size=` | 世界书列表 |
| POST | `/api/worldbooks` | 创建世界书 |
| GET | `/api/worldbooks/{worldbook_id}` | 世界书详情与条目列表 |
| PUT | `/api/worldbooks/{worldbook_id}` | 更新世界书 |
| DELETE | `/api/worldbooks/{worldbook_id}` | 删除世界书及其条目 |
| GET | `/api/worldbooks/{worldbook_id}/entries` | 条目列表 |
| POST | `/api/worldbooks/{worldbook_id}/entries` | 新增条目 |
| PUT | `/api/worldbooks/{worldbook_id}/entries/{entry_id}` | 更新条目 |
| DELETE | `/api/worldbooks/{worldbook_id}/entries/{entry_id}` | 删除条目 |

## 7. 冒险会话

### 数据字段

```json
{
  "id": 1,
  "work_id": 1,
  "card_id": 1,
  "worldbook_id": 1,
  "title": "新的冒险",
  "status": "active",
  "current_state": {},
  "parent_conversation_id": null,
  "branch_label": "",
  "created_at": "2026-08-09T12:00:00",
  "updated_at": "2026-08-09T12:00:00",
  "last_message_at": null
}
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/conversations?work_id=&page=&page_size=` | 会话列表 |
| POST | `/api/conversations` | 创建会话 |
| GET | `/api/conversations/{conversation_id}` | 会话详情 |
| DELETE | `/api/conversations/{conversation_id}` | 删除会话及其消息、存档 |

`POST /api/conversations` 请求体：

```json
{
  "work_id": 1,
  "title": "新的冒险"
}
```

## 8. 流式对话 SSE

### POST `/api/conversations/{conversation_id}/chat`

请求体：

```json
{
  "content": "我推开门",
  "metadata": {}
}
```

响应为 `text/event-stream`，事件按以下顺序发送：

```text
event: meta
data: {"conversation_id": 1, "message_id": 12}

event: delta
data: {"content": "你推开门，"}

event: delta
data: {"content": "夜风灌了进来。"}

event: state
data: {"current_state": {}, "attributes": {}, "items": [], "quests": []}

event: done
data: {"message_id": 12, "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
```

发生错误时发送：

```text
event: error
data: {"code": "api_error", "message": "DeepSeek 请求失败"}
```

### POST `/api/conversations/{conversation_id}/stop`

停止当前正在流式生成的回复，成功返回 204。

## 9. 存档与读档

### 数据字段

```json
{
  "id": 1,
  "conversation_id": 1,
  "name": "第一章结束",
  "state": {},
  "branch_label": "branch-001",
  "note": "手动存档",
  "created_at": "2026-08-09T12:00:00"
}
```

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/conversations/{conversation_id}/snapshots` | 存档列表 |
| POST | `/api/conversations/{conversation_id}/snapshots` | 创建存档 |
| POST | `/api/conversations/{conversation_id}/snapshots/{snapshot_id}/restore` | 读档 |
| DELETE | `/api/conversations/{conversation_id}/snapshots/{snapshot_id}` | 删除存档 |

创建存档请求体：

```json
{
  "name": "第一章结束",
  "note": "手动存档"
}
```

读档响应：

```json
{
  "status": "restored",
  "conversation_id": 1,
  "snapshot_id": 3,
  "state": {}
}
```

## 10. 状态查询与修改

### GET `/api/conversations/{conversation_id}/state`

```json
{
  "conversation_id": 1,
  "attributes": { "魅力": 60, "武力": 40 },
  "items": ["旧钥匙"],
  "money": 100,
  "relations": {},
  "quests": [],
  "logs": [],
  "updated_at": "2026-08-09T12:00:00"
}
```

### PUT `/api/conversations/{conversation_id}/state`

请求体支持局部更新，可修改 `attributes`、`items`、`money`、`relations`、`quests`、`logs`。

```json
{
  "money": 80,
  "quests": [{ "title": "寻找旧钥匙", "status": "进行中" }]
}
```

响应为保存后的完整状态，格式与 `GET` 相同。

## 11. AI 适配层

后续 W2 在 `backend/ai/deepseek_client.py` 中实现 DeepSeek 流式对话。实现要求：

- 使用 `config.json` 中的 `base_url`、`model`、`api_key`
- 请求采用 OpenAI 兼容格式
- 所有回复通过 SSE 流式返回
- 请求失败时返回 `api_error` 事件，不在前端显示明文密钥
