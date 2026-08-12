# 2026-08-12 清理批次行为基线

> 基线提交：`83243e7de9faa04087ae42e9fe4973c32e02e769`（`chore: freeze pre-cleanup baseline`）。本文件只描述现状，不是重构规范。`config.json` 未读取、未复制、未提交。

## 基线状态与已知问题

- 分支：`codex/ai-adventure-cleanup`。
- 工作树在清理开始前为空。
- 基线测试：后端 `python -m unittest discover -s backend -p 'test_*.py'`：142/142 通过；前端 `node --test`（frontend 下全部 `test_*.mjs`）：83/83 通过；`python -m unittest test_start_browser`：1/1 通过。
- `git diff --check` 在冻结前只报告既有未提交前端测试文件的尾随空格；本轮不将该既有问题混入清理提交。
- 已知既存缺陷：`frontend/js/main.js` 约第 288 行调用 `filterWorks(all, ...)`，当前 import 列表没有该符号。该问题冻结为已知基线，不在“去冗余”批次修复，也不因清理提交而改变。

## OpenAPI 路由清单

以下清单由当前 `backend.main.app.openapi()` 生成；每行是 HTTP 方法、路径和 operationId。所有业务错误由应用异常处理器包装为 `{"error":{"code","message"}}`；请求校验仍由 FastAPI 生成 422 响应。

```text
GET    /api/health
GET    /api/config
PUT    /api/config
GET    /api/models
POST   /api/models/preview
GET    /api/cards
POST   /api/cards
GET    /api/cards/{card_id}
PUT    /api/cards/{card_id}
DELETE /api/cards/{card_id}
POST   /api/imports/card-text
GET    /api/worldbooks
POST   /api/worldbooks
GET    /api/worldbooks/{worldbook_id}
PUT    /api/worldbooks/{worldbook_id}
DELETE /api/worldbooks/{worldbook_id}
GET    /api/worldbooks/{worldbook_id}/entries
POST   /api/worldbooks/{worldbook_id}/entries
PUT    /api/worldbooks/{worldbook_id}/entries/{entry_id}
DELETE /api/worldbooks/{worldbook_id}/entries/{entry_id}
GET    /api/works
POST   /api/works
POST   /api/works/bundle
GET    /api/works/{work_id}
PUT    /api/works/{work_id}
DELETE /api/works/{work_id}
PUT    /api/works/{work_id}/bundle
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/{conversation_id}
PUT    /api/conversations/{conversation_id}
DELETE /api/conversations/{conversation_id}
POST   /api/conversations/{conversation_id}/onboarding
POST   /api/conversations/{conversation_id}/corrections
GET    /api/conversations/{conversation_id}/messages
GET    /api/conversations/{conversation_id}/state
PUT    /api/conversations/{conversation_id}/state
POST   /api/conversations/{conversation_id}/roll
GET    /api/conversations/{conversation_id}/snapshots
POST   /api/conversations/{conversation_id}/snapshots
POST   /api/conversations/{conversation_id}/snapshots/{snapshot_id}/restore
DELETE /api/conversations/{conversation_id}/snapshots/{snapshot_id}
POST   /api/conversations/{conversation_id}/chat
POST   /api/conversations/{conversation_id}/stop
```

OpenAPI component schemas present at baseline:
`CardCreate`, `CardTextImport`, `CardUpdate`, `ChatRequest`, `ConfigUpdate`, `ConversationCorrection`, `ConversationCreate`, `ConversationUpdate`, `CreatorWorldbook`, `CreatorWorldbookEntry`, `GenerationUpdate`, `HTTPValidationError`, `ModelDiscoveryPreview`, `OnboardingComplete`, `ReplyTemplate`, `RollRequest`, `SnapshotCreate`, `StateUpdate`, `ValidationError`, `WorkBundleCreate`, `WorkBundleUpdate`, `WorkCreate`, `WorkUpdate`, `WorldbookCreate`, `WorldbookEntryCreate`, `WorldbookEntryUpdate`, `WorldbookUpdate`.

Compatibility-sensitive request properties include `WorkCreate/WorkUpdate.card_id` and `.card_ids`; work payloads also carry `worldbook_id`, `player_attributes`, `onboarding`, `cover_url`, `reply_templates` and `active_reply_template_id`.

## Storage and compatibility matrix

| Area | Current/legacy representation | Required meaning to preserve |
|---|---|---|
| Work role-card reference | `card_id` | Legacy single-card field remains accepted and normalized to one active card when no ordered list supersedes it. |
| Work role-card reference | `card_ids` | Ordered multi-card field controls selected card order. An explicit empty list means no cards; cards outside the selected IDs are excluded. |
| Conversation frozen cards | `card_snapshot` | Legacy single frozen-card object remains readable and is the first card of a session when applicable. |
| Conversation frozen cards | `card_snapshots` | New ordered frozen-card array has authority when populated. A deliberately empty authoritative array means a valid no-character session and must not fall back to live work/card data. |
| Conversation legacy fallback | `work_id`/`card_id` with empty snapshots | Older sessions may resolve cards from the embedded work or legacy card reference until a frozen snapshot is present. |
| Empty snapshot marker | private marker in the legacy `card_snapshot` column, normalized back to `{}` plus provenance | Preserves the distinction between “no frozen cards was intentionally selected” and an old row that has no snapshot yet. |
| Corrections | `persona_corrections`, `memory_corrections` arrays on conversations | Always exposed as arrays by repository normalization; corrections are copied into snapshots when present. |
| Old snapshot corrections | `NULL` in snapshot correction columns | Means the snapshot predates correction capture; restore must not treat it as an explicit empty correction list. |
| New snapshot corrections | `[]` | Means corrections were captured and are explicitly empty. This differs from `NULL` and must remain distinguishable on read/restore. |
| Snapshot private state | `messages`, `memory_summary`, `memory_summary_covered_until_sequence`, correction columns | Public snapshot list hides private fields; restore uses them transactionally. |
| Offline storage | `adventure_mock_data`, `adventure_mock_settings`, `adventure_api_key_draft` | Existing mock data/settings/API-key draft migration and shape remain unchanged. |
| Theme/age | `adventure_theme`, `adventure_age_confirmed` | Existing theme and age-gate behavior remains unchanged. |
| Reply length | `adventure_reply_length:<conversationId>` | Per-conversation reply-length preference remains unchanged. |

## SSE contract transcript

The backend emits `event: <name>` followed by one JSON `data:` line and a blank line. The frontend maps `meta`→`onMeta`, `delta`→`onDelta`, `context`→`onContext`, `state`→`onState`, `done`→`onDone`, and `error`→`onError`, then calls `onFinish` after the stream ends.

### Normal AI stream

1. Optional `context {status: "compressing"}` when inspection requests compression.
2. Optional `context {status: "compressed"|"fallback", before_tokens, after_tokens, method}` after preparation; if compression was requested but not performed, a fallback context event is still emitted.
3. `meta {conversation_id, message_id}` after the empty assistant message is created.
4. Zero or more `delta {content}` events for filtered visible prose, tail text, stop marker, state notice and judge text, in that production order.
5. `state {current_state, attributes, items, quests, flags}` after persistence/autosave, including any applied state delta.
6. `done {message_id, usage, options}`.
7. On provider error, the stream persists the partial assistant message and emits `error {code: "api_error", message: "DeepSeek 请求失败"}` instead of the normal terminal state/done sequence.

### Command stream

1. `meta {conversation_id, message_id}`.
2. `delta {content}`.
3. `state` with current state fields.
4. `done {message_id, usage}`.

### Stop behavior

`POST /api/conversations/{id}/stop` sets the per-conversation stop event and returns 204. The generator stops at the next provider chunk, appends the visible stop marker, persists status `stopped`, then emits the final `state` and `done`; a stream interrupted before finalization is persisted as `interrupted` in the generator cleanup. The single-process activity lock keeps one stream per conversation and returns 409 for concurrent generation.

## Frontend hash routes

`parseRoute()` recognizes:

- `#/` or unknown route → library
- `#/work/{id}` → work detail
- `#/adventure/{id}` → adventure
- `#/onboarding/{id}` → onboarding
- `#/cards` → role-card library
- `#/card/new` → new role-card editor
- `#/card/{id}` → existing role-card editor
- `#/creator` → new work creator
- `#/creator/{id}` → existing work creator
- `#/settings` → settings

## Key DOM IDs

Global shell: `app`, `mode-badge`, `theme-toggle`, `toast-root`, `modal-root`.

Library/work detail: `creator-btn`, `library-search`, `library-tag`, `sort-segment`, `demo-btn`, `work-grid`, `back-btn`, `edit-work-btn`, `delete-work-btn`, `conversation-section-title`, `new-adventure-btn`, `conversation-list`.

Role-card library/editor: `card-library-search`, `card-library-results`, `card-load-retry`, `card-file`, `card-json-format-btn`, `card-editor-back`, `card-load-error`, `card-reference-warning`, `card-form`, `card-name`, `card-personality`, `card-persona`, `card-speaking`, `directive-rows`, `add-directive`, `character-attribute-rows`, `add-character-attribute`, `relation-rows`, `add-relation`, `card-save-btn`, `json-format-help` (modal content when opened).

Creator: `creator-load-status`, `back-btn`, `creator-form`, `work-title`, `work-description`, `work-opening`, `disable-reply-template`, `reply-template-rows`, `add-reply-template`, `onboarding-field-rows`, `add-onboarding-field`, `work-card-rows`, `work-card-add`, `add-work-card`, `player-attribute-rows`, `add-player-attribute`, `work-tags`, `work-cover-url`, `work-cover-file`, `wb-title`, `wb-description`, `entry-rows`, `add-entry`, `creator-save-btn`, `preview-btn`.

Adventure/onboarding: `onboarding-form`, `onboarding-back`, `back-btn`, `sidebar-toggle`, `onboarding-review-btn`, `delete-btn`, `stop-btn`, `message-list`, `options-area`, `reply-length-select`, `composer-input`, `send-btn`, `status-sidebar`, `sidebar-body`, `adventure-onboarding-form`, `custom-settings`, `add-custom-setting`, `correction-content`, `save-correction`, `save-snapshot-btn`.

Settings/age gate: `test-btn`, `cfg-base-url`, `cfg-model`, `fetch-models-btn`, `cfg-key`, `cfg-temperature`, `cfg-reasoning-effort`, `cfg-max-tokens`, `cfg-context-window`, `cfg-compression-ratio`, `cfg-compression-keep-recent`, `cfg-compression-summary-tokens`, `save-settings-btn`, `gate-exit`, `gate-confirm`.

## Test baseline

- Python backend suite: 142 tests, 0 failures.
- Node frontend suite: 83 tests, 0 failures.
- Root launcher test: 1 test, 0 failures.
- These counts are the frozen pre-cleanup results; any later count change must be explained as a deliberate test consolidation/addition and must preserve assertion strength.

## Cleanup guardrails

- Do not change API paths, schema field names, response/error shapes, SSE event order, database schema/migrations, JSON/localStorage shapes, UI structure, Chinese copy, hash routes or offline behavior.
- Keep compatibility facades, legacy migration code and wrappers directly called by tests.
- Do not touch `chat_routes.py` streaming state machine, `adventure_engine.py` structured-output parsing, `database.py` migration order, `frontend/js/data.mjs` SSE/offline/storage migration, large CSS merges or main.js controller split in the first cleanup round.
