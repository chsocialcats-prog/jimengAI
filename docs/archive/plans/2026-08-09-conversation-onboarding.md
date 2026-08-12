# 剧本会话开局引导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个剧本配置首次会话引导，并将每个新会话的答案保存为独立的 AI 剧情上下文。

**Architecture:** `works.onboarding` 保存经校验的动态表单配置；`conversations` 保存创建时的配置快照、完成状态和答案。后端负责校验、持久化和聊天拦截，前端将剧本详情变成会话入口，并渲染会话级引导表单。

**Tech Stack:** FastAPI、Pydantic、SQLite、原生 HTML/CSS/JavaScript、pytest。

## Global Constraints

- 字段类型仅为 `text`、`textarea`、`select`；字段 key 仅为字母、数字和下划线，且在单个剧本内唯一。
- 引导答案只属于会话，不得修改剧本、角色卡或世界书。
- 已完成会话可继续；`pending` 会话不允许聊天；已有存档与读档行为不得回归。
- 使用迁移式 `_ensure_column`，不得重建或覆盖已有 SQLite 数据库。
- 当前目录无 Git 元数据；每个任务的“提交”步骤改为记录 `git status`，待项目纳入 Git 后再提交。

---

### Task 1: 作品引导配置与会话持久化

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/repositories.py`
- Modify: `backend/schemas.py`
- Test: `backend/test_onboarding.py`

**Interfaces:**
- Produces: `validate_onboarding(config) -> dict`、`normalize_onboarding(config) -> dict`。
- Produces: works API 的 `onboarding: dict`；conversation API 的 `onboarding_status: str`、`onboarding_config: dict`、`onboarding_answers: dict`。

- [ ] **Step 1: 写入失败测试，定义配置校验与创建会话的快照行为。**

```python
def test_create_conversation_snapshots_work_onboarding(db_work):
    work = repositories.update_work(db_work["id"], {"onboarding": {
        "enabled": True, "intro": "补全开局", "allow_freeform": True,
        "fields": [{"key": "player_role", "label": "身份", "type": "text", "required": True}],
    }})
    conversation = repositories.create_conversation(work["id"], "测试")
    assert conversation["onboarding_status"] == "pending"
    assert conversation["onboarding_config"] == work["onboarding"]

def test_rejects_duplicate_or_invalid_onboarding_field_keys():
    with pytest.raises(ValueError, match="key"):
        repositories.validate_onboarding({"fields": [
            {"key": "bad key", "label": "A", "type": "text"},
            {"key": "bad key", "label": "B", "type": "text"},
        ]})
```

- [ ] **Step 2: 运行测试确认其因缺少引导接口而失败。**

Run: `python -m pytest backend/test_onboarding.py -v`

Expected: FAIL，报出 `validate_onboarding` 或新字段不存在。

- [ ] **Step 3: 以最小实现扩展 schema、数据库迁移和 repository。**

```python
# database.init_db()
_ensure_column(connection, "works", "onboarding",
               "ALTER TABLE works ADD COLUMN onboarding TEXT NOT NULL DEFAULT '{}'")
_ensure_column(connection, "conversations", "onboarding_status",
               "ALTER TABLE conversations ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'completed'")
_ensure_column(connection, "conversations", "onboarding_config",
               "ALTER TABLE conversations ADD COLUMN onboarding_config TEXT NOT NULL DEFAULT '{}'")
_ensure_column(connection, "conversations", "onboarding_answers",
               "ALTER TABLE conversations ADD COLUMN onboarding_answers TEXT NOT NULL DEFAULT '{}'")
```

`WorkCreate`/`WorkUpdate` 增加 `onboarding`；row 转换时 JSON 解码。`create_conversation` 读取作品配置、存入深拷贝快照，并令启用且含字段的会话为 `pending`，其余为 `completed`。

- [ ] **Step 4: 运行单元测试确认通过。**

Run: `python -m pytest backend/test_onboarding.py -v`

Expected: PASS。

- [ ] **Step 5: 记录变更。**

Run: `git status --short`

Expected: 列出本任务的四个文件；不执行 commit（当前目录不是 Git 仓库）。

### Task 2: 完成引导接口与聊天保护

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/repositories.py`
- Modify: `backend/routers/conversations_routes.py`
- Modify: `backend/routers/chat_routes.py`
- Modify: `backend/services/adventure_engine.py`
- Test: `backend/test_onboarding.py`

**Interfaces:**
- Consumes: Task 1 的会话引导字段和 `validate_onboarding`。
- Produces: `POST /api/conversations/{conversation_id}/onboarding`，请求 `{ "answers": { ... } }`，返回完成后的会话。
- Produces: `repositories.complete_conversation_onboarding(conversation_id, answers) -> dict`。

- [ ] **Step 1: 写入失败测试，定义必填校验、持久化、上下文注入和聊天拦截。**

```python
def test_complete_onboarding_persists_answers_and_marks_completed(pending_conversation):
    completed = repositories.complete_conversation_onboarding(
        pending_conversation["id"], {"player_role": "哲", "freeform": "深夜"}
    )
    assert completed["onboarding_status"] == "completed"
    assert completed["onboarding_answers"]["player_role"] == "哲"

def test_completion_rejects_missing_required_answer(pending_conversation):
    with pytest.raises(ValueError, match="player_role"):
        repositories.complete_conversation_onboarding(pending_conversation["id"], {})

def test_build_messages_includes_completed_onboarding_answers(completed_conversation):
    messages = adventure_engine.build_messages(completed_conversation["id"])
    assert "本次开局设定" in messages[0]["content"]
    assert "哲" in messages[0]["content"]
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `python -m pytest backend/test_onboarding.py -v`

Expected: FAIL，`complete_conversation_onboarding` 缺失或上下文不包含答案。

- [ ] **Step 3: 实现完成端点与保护逻辑。**

```python
class OnboardingComplete(BaseModel):
    answers: dict = Field(default_factory=dict)

@router.post("/{conversation_id}/onboarding")
def complete_onboarding(conversation_id: int, payload: OnboardingComplete):
    try:
        return repositories.complete_conversation_onboarding(conversation_id, payload.answers)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(exc)})
```

校验所有必填字段非空、`select` 答案属于选项；未知键丢弃（只保留配置字段与允许的 `freeform`）。在聊天路由写入用户消息前拒绝 `pending` 会话；在 `build_system_prompt` 中追加 JSON 格式的“本次开局设定”。

- [ ] **Step 4: 运行任务测试及现有聊天并发测试。**

Run: `python -m pytest backend/test_onboarding.py backend/test_chat_exclusivity.py -v`

Expected: PASS。

- [ ] **Step 5: 记录变更。**

Run: `git status --short`

Expected: 包含 Task 1 与 Task 2 的文件；不执行 commit。

### Task 3: 剧本详情的会话选择与首次引导页

**Files:**
- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`
- Test: `backend/smoke_test.py`

**Interfaces:**
- Consumes: `GET /api/conversations?work_id=...`、Task 2 的完成引导端点与会话字段。
- Produces: `#/work/{id}` 中的会话列表；`#/onboarding/{conversationId}` 路由；`completeOnboarding(conversationId, answers)` 前端 API 帮助方法。

- [ ] **Step 1: 在 smoke test 写入失败场景。**

```python
pending = check("创建待引导会话", lambda: request("POST", "/api/conversations", {
    "work_id": work["id"], "title": "开局测试"
}))
assert_true(pending["onboarding_status"] == "pending", "会话未进入待引导状态")
completed = check("完成开局引导", lambda: request("POST",
    f"/api/conversations/{pending['id']}/onboarding", {"answers": {"player_role": "哲"}}))
assert_true(completed["onboarding_status"] == "completed", "引导未完成")
```

- [ ] **Step 2: 运行 smoke test，确认新场景失败。**

Run: `python backend/smoke_test.py`

Expected: FAIL，完成引导端点不存在或返回状态不正确。

- [ ] **Step 3: 实现前端会话入口与动态表单。**

```javascript
async function completeOnboarding(conversationId, answers) {
  return api(`/api/conversations/${conversationId}/onboarding`, {
    method: "POST", body: { answers },
  });
}

function onboardingRoute(conversationId) {
  return `#/onboarding/${conversationId}`;
}
```

`renderWorkDetail` 加载并渲染已有会话：`completed` 显示“继续”，`pending` 显示“继续填写”；“新建对话”创建会话后按状态导航到引导或冒险。新增 `renderOnboarding`，使用 `text`、`textarea`、`select` 生成受 `esc()` 保护的表单并保留失败后的输入。`renderAdventure` 检测 `pending` 后重定向到引导页。补充紧凑的表单、会话卡片和移动端样式。

- [ ] **Step 4: 启动服务并运行 smoke test。**

Run: `python start.py --no-browser`（独立终端）后运行 `python backend/smoke_test.py`

Expected: PASS；新建、完成引导、聊天、存档和读档全部通过。

- [ ] **Step 5: 手动浏览器验收。**

检查：同剧本能显示多条会话；新建会话先显示专属字段；必填提示正确；完成后进入冒险；返回详情并继续时不重复显示引导；存档仍能创建和恢复。

- [ ] **Step 6: 记录变更。**

Run: `git status --short`

Expected: 列出前后端、测试和文档变更；不执行 commit。

### Task 4: 创作台的剧本引导编辑器与回归验证

**Files:**
- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`
- Modify: `backend/test_onboarding.py`
- Test: `backend/smoke_test.py`

**Interfaces:**
- Consumes: Task 1 的 `WorkCreate.onboarding` 和 `WorkUpdate.onboarding`。
- Produces: `collectOnboardingConfig() -> object`，并使 `submitCreatorForm` 与 `saveCreatorEdit` 一并保存该对象。

- [ ] **Step 1: 写入失败测试，覆盖无效 select 配置。**

```python
def test_work_update_rejects_select_field_without_options(db_work):
    with pytest.raises(ValueError, match="options"):
        repositories.update_work(db_work["id"], {"onboarding": {
            "enabled": True,
            "fields": [{"key": "place", "label": "地点", "type": "select"}],
        }})
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `python -m pytest backend/test_onboarding.py::test_work_update_rejects_select_field_without_options -v`

Expected: FAIL，因为无选项的 select 仍被接受。

- [ ] **Step 3: 完成验证并实现创作台编辑器。**

```javascript
function collectOnboardingConfig() {
  return {
    enabled: $("#onboarding-enabled")?.checked ?? false,
    intro: value("#onboarding-intro"),
    allow_freeform: $("#onboarding-freeform")?.checked ?? false,
    fields: collectOnboardingFields(),
  };
}
```

在创作台增加启用开关、说明、自由补充开关和可增删字段卡。字段卡包含 key、标题、类型、必填、默认值、提示语、选项；仅当类型为 `select` 时显示选项输入。`fillCreatorForm` 载入已有配置，`submitCreatorForm` 和 `saveCreatorEdit` 将 `onboarding` 放入 work payload。后端确保 select 至少有一个非空选项且 default（若有）包含于选项。

- [ ] **Step 4: 运行全部自动验证。**

Run: `python -m pytest backend/test_onboarding.py backend/test_chat_exclusivity.py -v; python backend/smoke_test.py`

Expected: 所有测试 PASS。

- [ ] **Step 5: 浏览器最终验收。**

检查：创建剧本时可添加文本、多行和单选字段；编辑后能再次加载；新建会话反映编辑后的配置；旧会话仍使用创建时快照。

- [ ] **Step 6: 记录变更。**

Run: `git status --short`

Expected: 所有计划内改动清晰可见；不执行 commit。

## 自检

- 规格中的作品配置、会话快照、答案持久化、AI 注入、动态 UI、错误处理、会话选择、存档回归分别由 Task 1-4 覆盖。
- 所有步骤均提供可执行命令和明确接口；所有后续接口均在前序任务声明。
- 数据字段与接口名在所有任务中一致：`onboarding_status`、`onboarding_config`、`onboarding_answers`、`complete_conversation_onboarding`。
