# API notes：SSE 与兼容语义

本文不是完整 API 清单。路由、请求模型、响应模型和错误码以当前代码、OpenAPI schema 及测试为准；本文只记录容易被重构误改的流式协议和历史兼容语义。

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
