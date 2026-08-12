# 回复长度与透明续写交接

更新时间：2026-08-11

## 本轮目标

解决模型单次回复未达到所选字数档位的问题，同时避免在界面中产生第二条 AI 消息。续写由后端在同一轮 SSE 中透明完成，最终只保存一条 assistant 消息。

## 已完成行为

核心实现位于 `backend/routers/chat_routes.py`：

- 首轮可见正文低于当前档位的 `min_characters` 时，可以自动续写。
- 只有上一请求的 `finish_reason` 为 `stop` 或 `length` 时才续写。
- 最多续写 2 次，即单轮最多发起 3 次模型请求。
- 每次续写继续使用当前回复长度档位的完整 `max_tokens`。
- 续写内容继续通过同一 SSE 的 `delta` 事件发送，并追加到同一条数据库消息。
- 用户停止生成后不会再发起续写。
- 没有 API Key 的本地 mock 模式不会触发续写。

续写提示要求模型从上一句自然接续，只扩充当前场景的环境、感官、动作、对话和情绪，并明确禁止：

- 重新开头、总结或重复已有正文。
- 推进新的剧情阶段。
- 引入新的判定、状态变化或选项。
- 输出 XML、JSON 或其他元数据。

每次续写仍经过 `StructuredOutputFilter`。续写意外输出的结构化块会被隐藏并丢弃，不会覆盖首轮解析出的 `state_delta`、`judge` 或 `options`。

## 失败降级

首轮请求失败仍沿用原有 `event: error` 行为。

如果首轮已有可用正文，但后续续写抛出 `DeepSeekError`：

- 保留并保存已经生成的正文。
- 消息仍以 `status: done` 完成。
- 正常发送 `state` 和 `done` SSE 事件。
- 消息元数据记录 `continuation_failed: true`。

正常完成或未触发续写时，该字段为 `false`。

## 选项输出调整

系统提示位于 `backend/services/adventure_engine.py`。

此前模型被同时要求输出正文中的“选项：”列表和隐藏的 `<options>` 块。短回复续写时，可见选项可能出现在后续正文中间，因此现在改为：

- 只要求在正文后输出 `<options>[...]</options>`。
- 明确禁止在剧情正文中重复列出选项。
- `StructuredOutputFilter` 隐藏结构化块。
- 前端继续使用 `done.options` 渲染“可选行动”按钮，无需前端改动。
- `parse_visible_options()` 仍保留，兼容旧模型输出和历史内容。

## 有意保留的取舍

本轮明确不优化 token 用量：

- 续写使用完整回复预算，不按剩余字数缩减 `max_tokens`。
- 多次模型请求的 provider usage 没有累计，现有 `usage` 仍会被最后一次请求覆盖。
- 通过最多两次续写限制避免无限请求。

如果后续需要精确计费或用量展示，应单独设计 usage 累计规则，不要与正文续写逻辑混在一次无关重构中。

## 相关测试

主要测试位于：

- `backend/test_chat_reply_length.py`
- `backend/test_adventure_engine.py`
- `backend/test_options_output.py`

新增或更新的覆盖包括：

- 短回复自动续写并达到最低字数。
- 最多执行两次续写。
- 每次续写使用完整档位 token 预算。
- 非 `stop`/`length` 结束原因不续写。
- 续写失败后保留首轮正文并正常完成。
- 用户停止后不再续写。
- 续写提示禁止新判定、状态变化和选项。
- 系统提示只要求结构化选项，不再要求可见选项列表。

本轮验证结果：

```text
定向后端测试：35 tests passed
完整后端测试：142 tests passed
```

使用的完整测试命令：

```powershell
python -m unittest discover -s backend -p 'test_*.py'
```

当前 WSL 的 `python3` 未安装 FastAPI，实际使用 Windows `python.exe` 执行测试。未运行前端测试，因为本轮没有修改前端代码。

## 后续注意

- `_MAX_CONTINUATION_ATTEMPTS = 2` 是当前硬上限，位于 `backend/routers/chat_routes.py`。
- 不要把续写作为新的 user/assistant 消息写入会话历史；内部 continuation messages 只用于当次模型请求。
- 如果允许续写推进新事件，就必须同时设计多次 `state_delta`、判定和选项的合并语义。当前提示明确禁止这种行为。
- 工作树中已有大量与本功能无关的未提交改动和 CRLF 变化。不要 reset、checkout、批量格式化或覆盖整文件。
