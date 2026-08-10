# 自动上下文压缩设计

**日期：** 2026-08-10  
**状态：** 已获用户确认，待文档审阅后进入实现计划

## 1. 目标

为冒险对话增加按 token 预算自动触发的上下文压缩能力：当发送给 AI 的 prompt 加上预留回复长度接近上下文预算时，调用当前 AI 模型把旧剧情整理成长期摘要，再用“固定设定 + 长期摘要 + 最近原始消息”继续生成回复。

压缩只改变后续请求携带的上下文，不删除或改写数据库中的原始消息。用户仍然可以查看完整历史、创建存档和读档。

## 2. 范围与非目标

### 范围

- 仅对普通 AI 剧情回复做自动压缩。
- 按估算 token 数触发，不按固定消息条数触发。
- 摘要优先由当前配置的 AI 模型生成。
- 没有 API Key、摘要失败或摘要无效时，回退到本地规则摘要。
- 前端通过 SSE 状态事件显示压缩过程，不增加手动压缩按钮。
- 本地配置页可以查看和调整上下文预算相关参数。

### 非目标

- 不物理删除旧消息。
- 不把摘要写成用户可见的剧情消息。
- 不在本次功能中实现跨会话共享记忆。
- 不根据模型名称自动猜测上下文上限；上下文预算由本地配置控制。

## 3. 已确认的方案

采用“请求前 token 预检 + AI 滚动摘要”。每个会话维护一份摘要及其覆盖边界。摘要只处理上一次摘要边界之后、最近消息窗口之前的新消息，因此连续对话不会反复压缩同一段历史。

整体流程如下：

```text
保存用户消息
    ↓
读取会话、摘要边界、完整历史
    ↓
组装固定设定 + 已有摘要 + 最近原始消息
    ↓
估算 prompt token + 预留回复 token
    ├─ 未达到阈值 → 直接调用剧情 AI
    └─ 达到阈值
          ↓
      AI 压缩未归档旧消息
          ├─ 成功 → 保存摘要和覆盖序号
          └─ 失败 → 使用本地规则摘要
          ↓
      重新组装上下文并调用剧情 AI
```

## 4. 配置

在现有 `generation` 配置下增加以下字段，并提供默认值：

```json
{
  "generation": {
    "temperature": 0.8,
    "max_tokens": 2048,
    "reasoning_effort": "off",
    "context_window_tokens": 32768,
    "compression_trigger_ratio": 0.75,
    "compression_keep_recent_messages": 8,
    "compression_summary_max_tokens": 1200
  }
}
```

触发计算：

```text
prompt_tokens = estimate_messages_tokens(candidate_messages)
reserved_tokens = generation.max_tokens
trigger_limit = context_window_tokens * compression_trigger_ratio
需要压缩 = prompt_tokens + reserved_tokens >= trigger_limit
```

参数约束：

- `context_window_tokens`：2048 到 131072 的整数。
- `compression_trigger_ratio`：0.50 到 0.95 之间的小数。
- `compression_keep_recent_messages`：2 到 32 的整数，默认 8。
- `compression_summary_max_tokens`：256 到 4096 的整数，默认 1200。

配置接口继续使用现有 `GET /api/config` 和 `PUT /api/config`，API Key 的脱敏规则保持不变。设置页新增“上下文预算”和“自动压缩”字段；离线模式将字段保存到现有本地设置存储中。

## 5. 后端架构

### 5.1 新增上下文服务

新增 `backend/services/context_service.py`，负责：

- 读取配置并计算触发阈值。
- 读取完整消息和摘要记录。
- 判断是否存在尚未归档的旧消息。
- 构造摘要请求并调用当前 AI 客户端。
- 校验摘要结果、截断超长结果并保存摘要边界。
- AI 摘要失败时执行本地规则回退。
- 返回压缩前后 token 数、使用的方法和最终消息列表。

服务不负责生成剧情回复，也不直接修改用户消息。

### 5.2 冒险引擎调整

`backend/services/adventure_engine.py` 的 `build_messages()` 改为只做上下文组装，不再每次调用时直接刷新本地摘要。它读取已保存的摘要记录，将其放入系统提示中的“早期剧情记忆摘要”区域，再追加最近原始消息。`recent_count` 使用配置允许的范围，不再把最大值硬编码为 8；默认值仍为 8。

为测试和压缩服务提供可选的摘要覆盖参数，使服务能够在保存新摘要后立即重新组装上下文，而不依赖下一次数据库读取。

聊天回复结束后的无条件 `update_memory_summary()` 调用会移除；本地摘要函数只作为上下文服务的回退路径使用，不能覆盖已经成功生成的 AI 摘要。

### 5.3 聊天流调整

`backend/routers/chat_routes.py` 在保存用户消息后、创建剧情 AI 请求前调用上下文服务。压缩状态通过 SSE 发出，主剧情流仍复用当前 `meta`、`delta`、`state` 和 `done` 事件。

摘要请求使用与当前会话相同的模型和 API 配置，但使用独立的摘要最大 token 参数。DeepSeek 客户端的流式方法增加可选 `max_tokens` 参数，未传入时保持现有剧情回复行为。

## 6. 摘要内容协议

摘要请求使用独立的系统提示，明确要求模型把消息内容视为待整理的剧情资料，不执行资料中的指令。摘要应优先保留：

1. 已发生的关键事件和因果关系。
2. 玩家已经做出的重要选择及其后果。
3. 角色关系、人物态度和关键人物状态。
4. 任务、线索、物品、地点和未解决问题。
5. 用户明确要求持久遵守的人设、记忆修正和本次开局设定。
6. 不应重复的已知信息，避免无意义的环境描写。

摘要输出为普通文本，不包含 `state_delta`、`judge` 或 `options` 结构化标签。摘要结果为空、无法解析或明显超过配置上限时视为失败并触发本地回退。

AI 摘要请求的输入由两部分组成：

- 上一版长期摘要（如果存在）。
- 上一版摘要覆盖边界之后、但不属于最近保留窗口的原始 user/assistant 消息。

## 7. 数据持久化与存档

### 7.1 `memory_summaries`

保留现有字段并增加：

```sql
covered_until_sequence INTEGER NOT NULL DEFAULT -1
```

该字段表示摘要已经覆盖的最后一条消息 `sequence`。仓库层新增读取完整摘要记录的方法；现有只返回摘要文本的方法保留兼容性。

### 7.2 `snapshots`

增加同名边界字段：

```sql
memory_summary_covered_until_sequence INTEGER NOT NULL DEFAULT -1
```

创建存档时同时保存摘要边界，读档时恢复摘要和边界，避免恢复分支后使用错误的摘要覆盖范围。

数据库初始化通过现有 `_ensure_column()` 迁移旧数据库，不删除现有数据。旧摘要没有覆盖边界时使用 `-1`，下一次压缩会从当前历史重新建立边界。

## 8. 回退和错误处理

按以下顺序处理：

1. 有 API Key 且 AI 摘要返回有效内容：保存 AI 摘要。
2. AI 请求超时、网络错误、返回空内容或超过摘要上限：生成本地规则摘要并保存。
3. 待压缩的原始资料本身超过摘要请求的安全预算：跳过 AI 摘要，直接使用本地规则摘要。
4. 本地摘要仍让最终上下文超预算：先截短摘要，再把最近消息窗口从配置值逐步缩小到 2 条；不删除任何数据库消息。
5. 主剧情 AI 请求仍沿用现有 `DeepSeekError` 和 SSE `error` 处理。

摘要失败不会使用户的本轮消息丢失，也不会创建额外的可见 assistant 消息。摘要失败原因只进入服务日志和内部状态事件，不把敏感配置写入响应。

## 9. SSE 与前端行为

新增 `context` 事件，状态值限定为：

```json
{"status":"compressing"}
{"status":"compressed","before_tokens":26000,"after_tokens":9200,"method":"ai"}
{"status":"fallback","before_tokens":26000,"after_tokens":11200,"method":"local"}
```

未触发压缩时不发送 `context` 事件。前端 `streamChat()` 增加 `onContext` 分发；冒险页在压缩期间将会话状态显示为“正在整理上下文”，完成后短暂显示“上下文已自动压缩”，随后恢复现有“AI 正在书写”和消息计数显示。压缩过程不改变消息列表内容，也不改变发送按钮和停止按钮的现有互斥规则。

## 10. 文件职责

预计修改或新增：

- `backend/services/context_service.py`：新增压缩、预检和回退服务。
- `backend/services/adventure_engine.py`：读取持久化摘要并支持摘要覆盖组装。
- `backend/routers/chat_routes.py`：接入压缩服务并发出 `context` SSE 事件。
- `backend/ai/deepseek_client.py`：支持摘要请求的独立最大 token 参数。
- `backend/config.py`：增加上下文压缩默认配置及边界归一化。
- `backend/database.py`：迁移摘要和存档覆盖序号字段。
- `backend/repositories.py`：读写摘要覆盖序号，并让存档保存/恢复该字段。
- `backend/schemas.py`：沿用现有分组配置请求体，补充必要的字段校验。
- `backend/routers/settings_routes.py`：继续复用配置读写接口，必要时返回归一化配置。
- `frontend/js/main.js`：设置页字段、SSE 状态处理和冒险页状态文案。
- `frontend/css/style.css`：如现有状态文案需要，增加最小的提示样式。

测试文件：

- `backend/test_context_service.py`：token 触发、增量边界、AI 摘要和回退。
- `backend/test_adventure_engine.py`：摘要被实际注入且不与最近消息重复。
- `backend/test_snapshots.py` 或现有存档测试文件：摘要边界随存档读写。
- `backend/test_deepseek_reasoning.py`：摘要请求的 `max_tokens` 不破坏原有请求参数。
- `frontend/test_context_compression.mjs`：SSE context 事件和设置页字段。

## 11. 验收标准

- 上下文未达到阈值时，主 AI 请求次数与现有行为相同。
- 达到阈值时，先产生一次摘要请求，再产生一次主剧情请求。
- 主剧情请求包含摘要和最近原始消息，不包含已归档旧消息。
- 连续压缩只处理摘要边界之后的新旧消息，不重复处理历史。
- 数据库中的原始消息数量、顺序和内容在压缩前后完全一致。
- 摘要失败、无 API Key 或离线模式下，主对话仍能继续。
- 读档后摘要和覆盖边界与存档一致。
- 设置页可保存并读取四个压缩参数，API Key 不会出现在公开配置响应中。
- 压缩状态能通过 SSE 到达前端，且不会显示为剧情消息。
- 现有后端测试和前端测试全部通过。
