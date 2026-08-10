# 会话人设与记忆修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让玩家在当前会话中保存并使用人设和记忆修正，不影响剧本原始设定。

**Architecture:** 会话表保存两类时间戳修正列表，生成提示时将其追加为高优先级规则。快照保存/恢复会携带这两个字段；前端通过快捷按钮和统一模态框调用专用接口。

**Tech Stack:** FastAPI、Pydantic、SQLite、原生 JavaScript、pytest。

## Global Constraints

- 修正仅作用于当前会话和后续 AI 回复，不修改作品、角色卡、世界书或历史消息。
- 修正类型仅为 `persona` 与 `memory`，单类最多保留 50 条。
- 修正必须随手动存档、自动存档与读档保持一致。
- 当前目录不是 Git 仓库；完成后仅记录变更，不执行提交。

---

### Task 1: 会话修正持久化与提示词优先级

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/repositories.py`
- Modify: `backend/schemas.py`
- Modify: `backend/services/adventure_engine.py`
- Test: `backend/test_conversation_corrections.py`

**Interfaces:**
- Produces: `repositories.add_conversation_correction(conversation_id, kind, content) -> dict`。
- Produces: 会话字段 `persona_corrections: list[dict]`、`memory_corrections: list[dict]`。

- [ ] **Step 1: 写入失败测试。**

```python
def test_persona_correction_is_persisted_and_injected(created_conversation):
    conversation = repositories.add_conversation_correction(
        created_conversation["id"], "persona", "艾莲不会突然变得热情"
    )
    assert conversation["persona_corrections"][0]["content"] == "艾莲不会突然变得热情"
    assert "会话人设修正" in adventure_engine.build_messages(conversation["id"])[0]["content"]
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `python -m pytest backend/test_conversation_corrections.py -v`

Expected: FAIL，缺少修正函数或提示词未包含内容。

- [ ] **Step 3: 最小实现数据库迁移、校验与注入。**

```python
def add_conversation_correction(conversation_id, kind, content):
    if kind not in ("persona", "memory"):
        raise ValueError("修正类型无效")
    content = str(content or "").strip()
    if not content:
        raise ValueError("修正内容不能为空")
```

在 `conversations` 增加两个 JSON 列并用 `_ensure_column` 迁移；`row_to_conversation` 解码字段。追加 `{content, created_at}` 并截取最后 50 项。`build_messages` 在开局设定后追加两段高优先级修正规则。

- [ ] **Step 4: 运行测试确认通过。**

Run: `python -m pytest backend/test_conversation_corrections.py -v`

Expected: PASS。

### Task 2: 修正 API 与存档恢复

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/routers/conversations_routes.py`
- Modify: `backend/repositories.py`
- Test: `backend/test_conversation_corrections.py`

**Interfaces:**
- Produces: `POST /api/conversations/{conversation_id}/corrections`，请求 `{ "kind": "persona|memory", "content": "..." }`。

- [ ] **Step 1: 写入失败测试。**

```python
def test_snapshot_restore_restores_corrections(created_conversation):
    repositories.add_conversation_correction(created_conversation["id"], "memory", "从未见过白塔")
    snapshot = repositories.create_snapshot(created_conversation["id"], "测试", autosave=False)
    repositories.add_conversation_correction(created_conversation["id"], "memory", "后来补充")
    repositories.restore_snapshot(created_conversation["id"], snapshot["id"])
    assert len(repositories.get_conversation(created_conversation["id"])["memory_corrections"]) == 1
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `python -m pytest backend/test_conversation_corrections.py -v`

Expected: FAIL，快照未保存修正字段。

- [ ] **Step 3: 实现请求模型、路由和快照字段。**

```python
class ConversationCorrection(BaseModel):
    kind: str
    content: str = Field(..., min_length=1, max_length=2000)
```

路由调用 repository 并把 `ValueError` 转换为 422。快照创建时序列化修正列表；恢复时将其写回 conversations。

- [ ] **Step 4: 运行后端测试与回归测试。**

Run: `python -m pytest backend/test_conversation_corrections.py backend/test_onboarding.py backend/test_chat_exclusivity.py -v`

Expected: PASS。

### Task 3: 快捷按钮与修正模态框

**Files:**
- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`
- Test: `backend/smoke_test.py`

**Interfaces:**
- Consumes: Task 2 的 corrections API。
- Produces: `openCorrectionModal(kind)` 与 `saveConversationCorrection(kind, content)`。

- [ ] **Step 1: 在冒险页快捷指令区添加按钮和统一模态框。**

```javascript
async function saveConversationCorrection(kind, content) {
  return api(`/api/conversations/${session.conv.id}/corrections`, {
    method: "POST", body: { kind, content },
  });
}
```

按钮文本为“修正人设”“修正记忆”。模态框根据类型显示对应说明，空内容禁用确认；保存成功后关闭并显示 toast，失败时保留文本。

- [ ] **Step 2: 手动验证界面行为。**

检查：两按钮出现在快捷指令下；两者显示正确标题；保存不会发送聊天消息；刷新会话详情仍包含修正。

- [ ] **Step 3: 运行完整验证。**

Run: `node --check frontend/js/main.js; python -m pytest backend/test_conversation_corrections.py backend/test_onboarding.py backend/test_chat_exclusivity.py -v; python backend/smoke_test.py`

Expected: 所有命令成功。
