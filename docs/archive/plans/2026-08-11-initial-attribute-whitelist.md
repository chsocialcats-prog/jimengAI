# 冒险初始属性白名单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存每局冒险的初始玩家/剧情角色属性白名单，只允许 AI 修改其中已有的数字属性，并把这份白名单注入 AI 提示词。

**Architecture:** 在 `conversations.attribute_schema` 中保存会话创建时的属性快照；`repositories` 负责生成、读取和兼容旧会话的快照；`state_service` 负责统一过滤属性 delta，防止新增属性或角色；`adventure_engine` 和 `chat_routes` 分别负责提示 AI 使用正确属性，并确保流式回复只展示过滤后的真实变化。

**Tech Stack:** Python 3、FastAPI/SQLite 现有后端、`unittest`、原生 JavaScript Node 测试。

## Global Constraints

- 玩家和剧情角色只能修改本局开局时已经存在的数字属性。
- 禁止 AI 通过状态变化新增属性、改名或新增剧情角色。
- 只调整数值属性的更新规则；金钱、物品、任务、关系、标记和日志保持现有合并规则。
- 只接受已有数字属性的正负数字变化；文本属性不参与数值更新。
- `attribute_schema` 在会话创建后不可被剧本或角色卡修改；分支会话复制来源会话的快照。
- 无效属性变化静默忽略，不污染数据库，也不出现在玩家可见的状态变化提示中。
- 不新增前端属性编辑器字段，不改变现有状态栏 API 结构。
- 兼容旧数据库和旧会话；迁移和旧会话白名单回填必须幂等。
- 保留工作区已有的用户修改，只提交本功能明确修改的文件。

## 文件结构与职责

- `backend/database.py`：声明 `conversations.attribute_schema` 并为旧数据库增加列。
- `backend/repositories.py`：规范化属性快照、在创建/分支会话时保存快照、为旧会话懒回填快照。
- `backend/services/state_service.py`：过滤玩家和剧情角色属性 delta，并在状态合并入口统一执行约束。
- `backend/services/adventure_engine.py`：生成属性白名单提示词，限制默认兜底变化只使用已有数字属性。
- `backend/routers/chat_routes.py`：在应用状态、格式化提示和写入消息元数据前使用过滤后的 delta。
- `backend/test_multi_role_cards.py`：数据库迁移、会话快照和分支继承测试。
- `backend/test_character_states.py`：属性白名单、未知角色和非数字属性合并测试。
- `backend/test_adventure_engine.py`：提示词、默认变化和流式回复过滤测试。

---

### Task 1: 持久化会话初始属性白名单

**Files:**

- Modify: `backend/database.py:18-160, 418-505`
- Modify: `backend/repositories.py:82-103, 646-904`
- Test: `backend/test_multi_role_cards.py:92-220, 470-680`

**Interfaces:**

- `repositories.build_attribute_schema(state: dict) -> dict` 返回固定结构：`{"attributes": dict, "characters": dict}`。
- `repositories.normalize_attribute_schema(raw: object) -> dict` 只保留上述两个对象字段；完全缺失时返回空对象 `{}`，使旧会话可以触发回填。
- `repositories.get_or_create_attribute_schema(conversation_id: int) -> dict` 返回已有快照，或根据旧会话实时状态/冻结角色卡生成并幂等保存快照。
- `row_to_conversation()` 返回解析后的 `attribute_schema`；新建无属性会话也必须返回 `{"attributes": {}, "characters": {}}`，不能被误判为未初始化。

- [ ] **Step 1: 写迁移、创建和分支的失败测试**

在 `MultiRoleCardMigrationTests` 的旧 schema 中增加断言：调用 `database.init_db()` 后 `conversations` 包含 `attribute_schema`。插入一个旧会话后，调用 `repositories.get_or_create_attribute_schema()` 两次，验证第一次得到的快照来自实时玩家属性和角色卡快照，第二次不改变结果。

在会话测试中增加：

```python
conversation = repositories.create_conversation(work["id"], "白名单会话")
schema = conversation["attribute_schema"]
self.assertEqual(schema["attributes"], {"学业": 60})
self.assertEqual(
    schema["characters"]["温挽"],
    {"心情": 50, "好感度": 0},
)

branch = repositories.create_conversation_branch(
    conversation["id"], "白名单分支", "test"
)
self.assertEqual(branch["attribute_schema"], schema)
```

再验证修改剧本/角色卡返回值不会改变已经创建会话的 `attribute_schema`。

- [ ] **Step 2: 运行聚焦测试，确认当前实现失败**

运行：

```powershell
python -m unittest backend.test_multi_role_cards -v
```

预期：因为旧 schema 没有 `attribute_schema`，以及创建/分支 INSERT 尚未写入快照而失败。

- [ ] **Step 3: 增加数据库列和规范化辅助函数**

在 `SCHEMA` 的 `conversations` 表增加：

```sql
attribute_schema TEXT NOT NULL DEFAULT '{}'
```

在 `database.init_db()` 使用 `_ensure_column()` 为现有数据库补列。不要依赖删除或重建表，保留旧会话数据。

在 `repositories.py` 增加：

```python
def normalize_attribute_schema(raw):
    if not isinstance(raw, dict):
        return {}
    has_shape = "attributes" in raw or "characters" in raw
    if not has_shape:
        return {}
    attributes = raw.get("attributes")
    characters = raw.get("characters")
    return {
        "attributes": dict(attributes) if isinstance(attributes, dict) else {},
        "characters": {
            str(name): dict(profile)
            for name, profile in (characters or {}).items()
            if isinstance(profile, dict)
        } if isinstance(characters, dict) else {},
    }


def build_attribute_schema(state):
    return normalize_attribute_schema({
        "attributes": state.get("attributes", {}),
        "characters": {
            str(name): (profile or {}).get("attributes", {})
            for name, profile in (state.get("characters") or {}).items()
            if isinstance(profile, dict)
        },
    })
```

解析数据库行时用 `json_loads` 加 `normalize_attribute_schema`；缺失列的旧数据库由 `_ensure_column` 提供空 JSON。

- [ ] **Step 4: 在新会话和分支事务中写入不可变快照**

`create_conversation()` 在生成 `initial_state["characters"]` 后调用 `build_attribute_schema(initial_state)`，将 `attribute_schema` 加入 conversations INSERT。快照必须与 `current_state`、`card_snapshots` 在同一个事务中写入。

`create_conversation_branch()` 优先复制 `source["attribute_schema"]`；来源是旧会话且为空时，用分支复制的实时状态构造一次兼容快照。将字段加入分支 INSERT，不能从当前作品重新生成已有会话的白名单。

在 `get_or_create_attribute_schema()` 中：

1. 读取会话，若 `attribute_schema` 已包含 `attributes` 或 `characters` 字段，直接返回。
2. 否则读取当前状态；若当前角色属性为空，则用 `get_conversation_cards()` 和 `_initial_character_states()` 从冻结卡片补出角色初始状态。
3. 用玩家当前属性和上述角色属性调用 `build_attribute_schema()`。
4. 仅在数据库字段仍为空时更新，使用事务/条件更新保证重复调用不覆盖已保存值。

该回填允许旧会话继续使用，不修改实时状态数值。

- [ ] **Step 5: 运行迁移和会话测试，确认通过**

运行：

```powershell
python -m unittest backend.test_multi_role_cards -v
python -m py_compile backend/database.py backend/repositories.py
```

检查重复 `database.init_db()`、重复 `get_or_create_attribute_schema()` 和分支创建都不会重复或覆盖快照。

- [ ] **Step 6: 只提交本任务文件**

```powershell
git add -- backend/database.py backend/repositories.py backend/test_multi_role_cards.py
git commit -m "feat: persist conversation attribute schema" -- backend/database.py backend/repositories.py backend/test_multi_role_cards.py
```

提交前确认 `git diff --cached --name-only` 不包含工作区已有的 `config.json`、前端品牌修改或其他无关文件。

### Task 2: 实现属性 delta 白名单过滤

**Files:**

- Modify: `backend/services/state_service.py:29-178, 225-317`
- Test: `backend/test_character_states.py:8-40`
- Test: `backend/test_state_delta_display.py:7-28`

**Interfaces:**

- `state_service.filter_state_delta(current: dict, delta: dict, attribute_schema: dict | None = None) -> dict` 返回不修改输入的过滤后 delta；非属性字段保持原样。
- `state_service.sanitize_state_delta(conversation_id: int, delta: dict) -> dict` 读取当前状态和会话白名单后调用过滤器；无效属性只会被丢弃。
- `state_service.merge_state(current, delta, attribute_schema=None) -> tuple[dict, set[str]]` 在合并前使用相同过滤规则。
- `apply_state_delta()` 和 `update_state()` 必须通过会话白名单调用 `merge_state()`。

- [ ] **Step 1: 写失败测试覆盖合法、非法和混合变化**

在 `CharacterStateTests` 增加：

```python
def test_attribute_delta_only_updates_initial_numeric_attributes(self):
    current = repositories.normalize_state({
        "attributes": {"学业": 60, "说明": "学生"},
        "characters": {
            "温挽": {"attributes": {"心情": 50}, "flags": []},
        },
    })
    schema = {
        "attributes": {"学业": 60, "说明": "学生"},
        "characters": {"温挽": {"心情": 50}},
    }

    updated, changed = state_service.merge_state(
        current,
        {
            "attributes": {"学业": "+5", "体力": "+10", "说明": "+1"},
            "characters": {
                "温挽": {"attributes": {"心情": "-2", "魅力": "+3"}},
                "陌生角色": {"attributes": {"心情": "+9"}},
            },
            "money": "+10",
        },
        attribute_schema=schema,
    )

    self.assertEqual(updated["attributes"], {"学业": 65.0, "说明": "学生"})
    self.assertEqual(updated["characters"]["温挽"]["attributes"], {"心情": 48.0})
    self.assertNotIn("陌生角色", updated["characters"])
    self.assertEqual(updated["money"], 10.0)
    self.assertEqual(changed, {"attributes", "characters", "money"})

def test_attribute_delta_does_not_create_default_mood(self):
    current = repositories.normalize_state({"attributes": {}, "characters": {}})
    updated, changed = state_service.merge_state(
        current,
        {"attributes": {"心情": "+1"}},
        attribute_schema={"attributes": {}, "characters": {}},
    )
    self.assertEqual(updated["attributes"], {})
    self.assertEqual(changed, set())
```

保留现有 `format_state_delta_for_player()` 测试，另加一个过滤后空 delta 不产生状态变化文本的断言。

- [ ] **Step 2: 运行状态测试，确认当前实现失败**

运行：

```powershell
python -m unittest backend.test_character_states backend.test_state_delta_display -v
```

预期：当前 `_apply_dict_delta()` 会写入 `体力`，`_merge_characters()` 会创建 `陌生角色`，且文本属性可能被改写。

- [ ] **Step 3: 增加数字属性和白名单过滤函数**

在 `state_service.py` 增加不把布尔值当数字的辅助函数，并只接受数字或可解析的正负数字字符串：

```python
def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_numeric_delta(value):
    if _is_number(value):
        return True
    if isinstance(value, str) and value[:1] in ("+", "-"):
        try:
            float(value)
        except ValueError:
            return False
        return True
    return False
```

实现 `_filter_numeric_attributes(target, updates, allowed)`：只有 key 在 `allowed`、`allowed[key]` 和 `target[key]` 都是数字、且 update 是数字/正负数字字符串时才保留。保留已有数值绝对赋值格式以兼容可见状态解析，但提示词只要求 AI 使用正负增量。

实现 `filter_state_delta()`：深拷贝/浅拷贝保留非属性字段；为 `attributes` 应用玩家白名单；为 `characters` 只处理当前状态中已存在且在白名单中的角色，并对其 `attributes` 使用同一数字过滤器。未知角色不调用 `setdefault()`。

- [ ] **Step 4: 让合并入口复用过滤结果**

把 `merge_state()` 改为先得到过滤后 delta，再执行既有 money/items/quests/flags/logs 合并。`_merge_characters()` 接受已过滤数据，并保留现有 flags 合并行为。

`apply_state_delta()` 和 `update_state()` 调用 `repositories.get_or_create_attribute_schema(conversation_id)`，再调用 `merge_state(current, payload, attribute_schema=schema)`。日志的 changed keys 只来自真实合并结果，不记录全是非法属性的 delta。

增加 `sanitize_state_delta()` 供流式路由使用；它返回空字典时，调用方不得显示状态变化提示。

- [ ] **Step 5: 运行状态测试，确认通过**

运行：

```powershell
python -m unittest backend.test_character_states backend.test_state_delta_display -v
python -m py_compile backend/services/state_service.py
```

### Task 3: 更新默认变化逻辑和 AI 提示词

**Files:**

- Modify: `backend/services/adventure_engine.py:236-318, 427-536`
- Test: `backend/test_adventure_engine.py:32-50, 295-452, 659-735`

**Interfaces:**

- `adventure_engine.build_system_prompt(..., attribute_schema=None) -> str` 接收可选白名单；直接单元测试未传时从当前 state 构造兼容白名单。
- `adventure_engine.build_messages()` 在组装系统提示词时传入 `repositories.get_or_create_attribute_schema(conversation_id)`。
- `adventure_engine.default_turn_state_delta(state, player_text, attribute_schema=None) -> dict | None` 只返回已有数字属性的变化；无可用属性时返回 `None`。

- [ ] **Step 1: 写提示词和默认兜底的失败测试**

扩展提示词测试：

```python
prompt = adventure_engine.build_system_prompt(
    None, None, None, [],
    {"attributes": {"学业": 60, "心情": 70}, "items": [], "money": 0,
     "relations": {}, "quests": [], "flags": [],
     "characters": {"温挽": {"attributes": {"心情": 50}, "flags": []}}},
    "",
    {"attributes": {"学业": 60, "心情": 70},
     "characters": {"温挽": {"心情": 50}}},
)
self.assertIn("学业", prompt)
self.assertIn("温挽", prompt)
self.assertIn("禁止新增属性", prompt)
self.assertIn("根据本回合剧情选择真正相关的已有属性", prompt)
```

增加默认兜底测试：空玩家/空角色状态返回 `None`；只有文本属性时返回 `None`；存在 `学业` 时返回 `{"attributes": {"学业": "+1"}}`，不返回硬编码的 `心情`。

- [ ] **Step 2: 运行冒险引擎测试，确认当前实现失败**

运行：

```powershell
python -m unittest backend.test_adventure_engine -v
```

预期：当前提示词没有白名单规则，且 `default_turn_state_delta()` 会在无属性时创建 `心情`。

- [ ] **Step 3: 让默认兜底只选择已有数字属性**

更新 `default_turn_state_delta()`：

1. 遍历当前存在的剧情角色；优先选择已有且为数字的 `好感度`，其次是数字 `心情`，再其次是第一个数字属性。
2. 若角色无可用属性，遍历玩家已有数字属性；优先数字 `心情`，再取第一个数字属性。
3. 若仍无目标，返回 `None`，禁止返回 `{"attributes": {"心情": ...}}`。
4. 如果传入 `attribute_schema`，只从白名单中存在的数字属性选择；最终仍由 `state_service` 做权威过滤。

保留现有正面互动 `+1`、敌对关键词 `-1` 和角色好感度优先级的行为。

- [ ] **Step 4: 把会话白名单注入系统提示词**

在 `build_system_prompt()` 中增加一段稳定的 JSON 白名单和明确规则。提示词应包含以下语义，并使用当前实际名称和值，不写死 `心情`：

```python
lines.append("本局可更新的初始属性白名单 JSON：")
lines.append(json.dumps(attribute_schema, ensure_ascii=False))
lines.append(
    "属性规则：只能修改白名单中本局开局已有的数字属性，使用 +5 或 -2 这类正负数字变化；"
    "玩家属性写入 attributes，剧情角色属性写入对应角色的 characters；"
    "禁止新增属性、改名、新增角色或把角色属性写入玩家属性；"
    "必须根据本回合剧情选择真正相关的已有属性，不要为了凑状态变化修改无关属性；"
    "没有合适的已有属性时不要输出属性变化。"
)
```

替换现有“优先使用玩家属性、金钱或剧情角色的心情/好感度”这类会诱导默认属性名的句子，保留 `<state_delta>`、`<judge>`、`<options>` 的其他合约。

在 `build_messages()` 获取白名单并传入 `build_system_prompt()`；避免直接调用 `get_work()` 或当前剧本设置来覆盖会话快照。

- [ ] **Step 5: 运行冒险引擎测试，确认通过**

运行：

```powershell
python -m unittest backend.test_adventure_engine -v
python -m py_compile backend/services/adventure_engine.py
```

### Task 4: 在流式回复中使用过滤后的 delta

**Files:**

- Modify: `backend/routers/chat_routes.py:183-358`
- Test: `backend/test_adventure_engine.py:326-452`

**Interfaces:**

- `_stream_ai_reply()` 在 `apply_state_delta()`、`format_state_delta_for_player()`、消息 metadata 和 SSE state 事件之前统一使用 `state_service.sanitize_state_delta()` 的结果。

- [ ] **Step 1: 写流式回复过滤失败测试**

增加一个模型输出未知属性的测试：模型输出
`<state_delta>{"attributes":{"体力":"+5","学业":"+2"}}</state_delta>`，当前状态白名单只有 `学业`。断言：

```python
apply_delta.assert_called_once_with(
    99, {"attributes": {"学业": "+2"}}, source="test-model"
)
self.assertNotIn("体力 +5", "".join(events))
```

再增加未知属性全部被过滤的测试，确认不会调用格式化状态提示，消息 metadata 中的 `state_delta` 为空/无效 delta。

- [ ] **Step 2: 运行流式相关测试，确认当前实现失败**

运行：

```powershell
python -m unittest backend.test_adventure_engine.VisibleStateDeltaFallbackTests -v
```

预期：当前路由把原始 delta 直接传给状态服务和格式化函数，未知属性仍会被展示或写入。

- [ ] **Step 3: 在路由中清洗 delta 后再使用**

在完成 `output_filter.finish()`、可见兜底解析和默认兜底选择后加入：

```python
if state_delta:
    state_delta = state_service.sanitize_state_delta(
        conversation_id, state_delta
    ) or None
```

之后保留现有 `if state_delta:` 分支，但该分支内部的 `apply_state_delta()`、`format_state_delta_for_player()` 和 metadata 都只能使用清洗后的变量。可见状态兜底仍不重复追加“状态变化”标题；全部非法时不追加任何状态提示。

更新现有流式测试的 mocks，使 `sanitize_state_delta()` 返回传入的合法 delta，避免测试只验证 mock 调用而绕过新边界。

- [ ] **Step 4: 运行流式测试，确认通过**

运行：

```powershell
python -m unittest backend.test_adventure_engine.VisibleStateDeltaFallbackTests -v
python -m py_compile backend/routers/chat_routes.py
```

### Task 5: 完整回归与交付前验证

**Files:**

- Test only: all existing `backend/test_*.py` and `frontend/test_*.mjs`

- [ ] **Step 1: 运行完整后端测试**

```powershell
python -m unittest discover -s backend -p "test_*.py" -v
```

预期：全部通过；若既有测试断言旧提示词或旧默认 `心情` 行为，则只更新与本设计直接冲突的断言。

- [ ] **Step 2: 运行前端 Node 测试**

```powershell
Get-ChildItem frontend -Filter "test_*.mjs" | ForEach-Object {
    node --test $_.FullName
}
```

预期：状态栏、状态变化样式、冒险流式消息和现有品牌测试全部通过；本功能不应要求新增前端结构。

- [ ] **Step 3: 做语法、差异和污染检查**

```powershell
python -m py_compile backend/database.py backend/repositories.py backend/services/state_service.py backend/services/adventure_engine.py backend/routers/chat_routes.py
git diff --check
git status --short
```

确认没有生成数据库、缓存、截图或临时文件；确认已有用户修改仍未被纳入本功能提交。

- [ ] **Step 4: 只提交本功能代码和测试**

```powershell
git add -- backend/database.py backend/repositories.py backend/services/state_service.py backend/services/adventure_engine.py backend/routers/chat_routes.py backend/test_multi_role_cards.py backend/test_character_states.py backend/test_state_delta_display.py backend/test_adventure_engine.py
git commit -m "feat: constrain AI attribute updates" -- backend/database.py backend/repositories.py backend/services/state_service.py backend/services/adventure_engine.py backend/routers/chat_routes.py backend/test_multi_role_cards.py backend/test_character_states.py backend/test_state_delta_display.py backend/test_adventure_engine.py
```

提交前再次检查 staged 文件列表只包含本任务文件。

