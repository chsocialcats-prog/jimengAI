# 作品回复模板设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个作品保存多套 AI 回复模板，并在作品编辑页选择当前模板，使后续 AI 回复使用该模板的格式与写法约束。

**Architecture:** 在 `works` 表中以 JSON 保存模板数组，以字符串保存当前模板 ID，沿用现有作品 CRUD，不新增模板资源页面或聊天页切换器。作品编辑器负责增删改模板和选择当前模板；冒险引擎只把当前模板追加到系统提示中。

**Tech Stack:** FastAPI、Pydantic、SQLite、原生 HTML/CSS/JavaScript、Python `unittest`、Node.js 内置 `assert`。

## Global Constraints

- 旧作品没有模板时必须保持现有行为。
- 模板是 AI 的回复格式/写法指令，不是固定回复文本。
- 同一作品可以保存多套模板，但只有一个当前模板。
- 模板只能在作品设置页切换，聊天页不提供模板切换控件。
- 切换模板只影响后续 AI 回复，不修改历史消息。
- 不新增第三方依赖；在线 API、Mock/offline 模式都要支持。
- 当前工作区不是 Git 仓库，不执行 Git commit。

## 文件结构与职责

- Modify: `backend/database.py` — 为 `works` 增加模板字段，并为旧数据库添加迁移。
- Modify: `backend/schemas.py` — 声明模板项、创建作品和更新作品的请求字段。
- Modify: `backend/repositories.py` — 规范化模板数组、保存/读取模板和校验当前 ID。
- Modify: `backend/services/adventure_engine.py` — 将当前模板注入系统提示。
- Create: `backend/test_reply_templates.py` — 后端持久化、校验和提示注入测试。
- Modify: `frontend/js/main.js` — 作品编辑器、创建/编辑提交和 Mock 数据支持。
- Modify: `frontend/css/style.css` — 回复模板卡片和当前模板控件样式。
- Create: `frontend/test_reply_templates.mjs` — 前端源代码级回归测试。
- Modify: `docs/api-contract.md` — 补充作品模板字段示例。

---

### Task 1: 为作品增加模板数据模型和持久化

**Files:**
- Create: `backend/test_reply_templates.py`
- Modify: `backend/database.py`
- Modify: `backend/schemas.py`
- Modify: `backend/repositories.py`

**Interfaces:**
- `ReplyTemplate`：字段 `id: str`、`name: str`、`content: str`。
- `WorkCreate` / `WorkUpdate`：字段 `reply_templates` 和 `active_reply_template_id`。
- `repositories.create_work()`、`repositories.update_work()`、`repositories.get_work()`：返回 `reply_templates: list[dict]` 和 `active_reply_template_id: str`。

- [ ] **Step 1: 写失败测试**

在 `backend/test_reply_templates.py` 中创建临时数据库，先写以下行为测试：

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import database, repositories
from backend.schemas import WorkCreate


class ReplyTemplatePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "DB_PATH", Path(self.tempdir.name) / "test.db")
        self.db_patch.start()
        database.init_db()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_work_schema_accepts_multiple_reply_templates(self):
        payload = WorkCreate(
            title="模板作品",
            reply_templates=[{"id": "narrative", "name": "叙事", "content": "使用小说式正文。"}],
            active_reply_template_id="narrative",
        )
        data = payload.model_dump()
        self.assertEqual(data["reply_templates"][0]["id"], "narrative")
        self.assertEqual(data["active_reply_template_id"], "narrative")

    def test_work_round_trip_preserves_multiple_templates_and_active_id(self):
        work = repositories.create_work({
            "title": "模板作品",
            "reply_templates": [
                {"id": "narrative", "name": "叙事", "content": "使用小说式正文。"},
                {"id": "compact", "name": "简洁", "content": "只回复三段。"},
            ],
            "active_reply_template_id": "compact",
        })

        self.assertEqual([item["id"] for item in work["reply_templates"]], ["narrative", "compact"])
        self.assertEqual(work["active_reply_template_id"], "compact")

    def test_invalid_active_id_is_cleared_and_empty_items_are_ignored(self):
        work = repositories.create_work({
            "title": "模板作品",
            "reply_templates": [
                {"id": "usable", "name": "可用", "content": "保留。"},
                {"id": "", "name": "", "content": ""},
            ],
            "active_reply_template_id": "missing",
        })

        self.assertEqual(len(work["reply_templates"]), 1)
        self.assertEqual(work["active_reply_template_id"], "")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m unittest backend.test_reply_templates -v`

Expected: FAIL because `WorkCreate` and persisted work data do not yet expose the new fields.

- [ ] **Step 3: 实现最小数据模型**

在 `backend/schemas.py` 增加：

```python
class ReplyTemplate(BaseModel):
    id: str = ""
    name: str = ""
    content: str = ""


class WorkCreate(BaseModel):
    # 保留现有字段
    reply_templates: list[ReplyTemplate] = Field(default_factory=list)
    active_reply_template_id: str = ""


class WorkUpdate(BaseModel):
    # 保留现有字段
    reply_templates: Optional[list[ReplyTemplate]] = None
    active_reply_template_id: Optional[str] = None
```

在 `backend/database.py` 的 `works` 建表语句加入两个默认值字段，并在 `init_db()` 中调用 `_ensure_column`：

```python
reply_templates TEXT NOT NULL DEFAULT '[]',
active_reply_template_id TEXT NOT NULL DEFAULT '',
```

在 `backend/repositories.py` 增加 `validate_reply_templates(raw)`：只接受列表；保留非空对象，统一 `id`、`name`、`content` 为字符串；缺少 ID 的项生成稳定的 `template-<序号>`；空名称使用“未命名模板”；空内容和空名称的项丢弃；重复 ID 生成新的序号 ID。创建和更新作品时将规范化结果写入 JSON，并把不存在的当前 ID清空。`row_to_work()` 解析两个字段并始终返回列表和字符串。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m unittest backend.test_reply_templates.ReplyTemplatePersistenceTests -v`

Expected: PASS。

### Task 2: 让系统提示只使用当前模板

**Files:**
- Modify: `backend/services/adventure_engine.py`
- Modify: `backend/test_reply_templates.py`

**Interfaces:**
- Add `get_active_reply_template(work) -> dict | None` in `backend/services/adventure_engine.py`.
- `build_system_prompt()` continues accepting the existing `work` dictionary and appends only the selected template.

- [ ] **Step 1: 写失败测试**

在测试文件增加：

```python
from backend.services import adventure_engine


class ReplyTemplatePromptTests(unittest.TestCase):
    def test_prompt_contains_only_the_active_template(self):
        prompt = adventure_engine.build_system_prompt(
            {
                "title": "模板作品",
                "reply_templates": [
                    {"id": "active", "name": "叙事", "content": "active-template-marker"},
                    {"id": "other", "name": "简洁", "content": "inactive-template-marker"},
                ],
                "active_reply_template_id": "active",
            },
            None,
            None,
            [],
            {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []},
            "",
        )

        self.assertIn("active-template-marker", prompt)
        self.assertNotIn("inactive-template-marker", prompt)

    def test_prompt_without_active_template_has_no_template_section(self):
        prompt = adventure_engine.build_system_prompt(
            {"title": "无模板作品", "reply_templates": [], "active_reply_template_id": ""},
            None,
            None,
            [],
            {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []},
            "",
        )

        self.assertNotIn("回复模板（当前）", prompt)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m unittest backend.test_reply_templates.ReplyTemplatePromptTests -v`

Expected: FAIL because the system prompt currently ignores work template fields.

- [ ] **Step 3: 实现最小提示注入**

实现 `get_active_reply_template(work)`，遍历 `work.get("reply_templates")`，只返回 ID 与 `active_reply_template_id` 相同且内容非空的对象。将下面内容追加到 `build_system_prompt()` 的输出规则区域：

```python
active_template = get_active_reply_template(work)
if active_template:
    lines.append("回复模板（当前）：")
    lines.append(f"模板名称：{active_template.get('name', '')}")
    lines.append(active_template.get("content", ""))
```

模板内容作为指令传递，不改变现有 `<state_delta>`、`<judge>` 和 `<options>` 结构化输出约定。

- [ ] **Step 4: 运行后端测试**

Run: `python -m unittest backend.test_reply_templates backend.test_adventure_engine backend.test_options_output -v`

Expected: PASS。

### Task 3: 在作品编辑页支持多模板编辑和切换

**Files:**
- Create: `frontend/test_reply_templates.mjs`
- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`

**Interfaces:**
- Add `addReplyTemplateCard(template = {})` to render one editable template card.
- Add `collectReplyTemplates()` to return `{ id, name, content }[]`.
- Extend `fillCreatorForm()` and `submitCreatorForm()` with `reply_templates` and `active_reply_template_id`.

- [ ] **Step 1: 写失败的前端源代码测试**

创建 `frontend/test_reply_templates.mjs`：

```javascript
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainJs = fs.readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
const creatorStart = mainJs.indexOf("async function renderCreator");
const creatorEnd = mainJs.indexOf("async function renderSettings");
const creatorSource = mainJs.slice(creatorStart, creatorEnd);

test("作品编辑器提供多模板编辑和当前模板选择", () => {
  assert.match(creatorSource, /reply-template-rows/);
  assert.match(creatorSource, /add-reply-template/);
  assert.match(creatorSource, /active_reply_template_id/);
  assert.match(mainJs, /function addReplyTemplateCard\(template = \{\}\)/);
  assert.match(mainJs, /function collectReplyTemplates\(\)/);
  assert.match(css, /reply-template-card/);
});

test("模板字段会进入创建和更新作品请求", () => {
  assert.match(mainJs, /reply_templates/);
  assert.match(mainJs, /active_reply_template_id/);
  assert.match(mainJs, /collectReplyTemplates\(\)/);
});

test("聊天渲染区域没有模板切换控件", () => {
  const adventureStart = mainJs.indexOf("function renderAdventure");
  const adventureEnd = mainJs.indexOf("function bindAdventureEvents");
  const adventureSource = mainJs.slice(adventureStart, adventureEnd);
  assert.doesNotMatch(adventureSource, /reply-template-rows|add-reply-template|reply-template-card/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test frontend/test_reply_templates.mjs`

Expected: FAIL because the editor has no template controls or collection helpers.

- [ ] **Step 3: 实现最小编辑器交互**

在 `renderCreator()` 的开场剧情之后增加“回复模板”区，包含 `#reply-template-rows` 和 `#add-reply-template`。每张卡包含：

```html
<input class="input reply-template-name" placeholder="模板名称">
<textarea class="textarea compact reply-template-content" placeholder="AI 回复模板内容"></textarea>
<label class="entry-toggle"><input type="radio" name="active-reply-template" class="reply-template-active"> 当前模板</label>
<button type="button" class="btn btn-sm btn-ghost reply-template-delete">删除</button>
```

`addReplyTemplateCard()` 为没有 ID 的卡生成 `template-<时间戳>-<随机数>`，填充已有值，并把删除按钮绑定为移除卡片。`fillCreatorForm()` 清空容器后按作品模板数组重建卡片，并将当前 ID对应卡片设为选中。`collectReplyTemplates()` 读取名称、内容、ID，过滤名称和内容均为空的项目；`active_reply_template_id` 从当前单选项读取，未选择时返回空字符串。

`submitCreatorForm()` 将以下字段加入现有 `work` 对象：

```javascript
reply_templates: collectReplyTemplates(),
active_reply_template_id: document.querySelector(".reply-template-active:checked")?.closest(".reply-template-card")?.dataset.templateId || "",
```

创建和编辑都沿用现有保存流程；Mock 模式通过已有 `saveMockData()` 保存这些字段。

- [ ] **Step 4: 增加样式并运行前端测试**

在 `frontend/css/style.css` 增加 `.reply-template-list`、`.reply-template-card`、`.reply-template-header` 和 `.reply-template-active` 样式，复用现有面板、输入框和 `entry-card` 的视觉变量，确保窄屏下模板卡片纵向排列。

Run: `node --test frontend/test_reply_templates.mjs`

Expected: PASS。

### Task 4: 更新接口文档并完成全量验证

**Files:**
- Modify: `docs/api-contract.md`
- Modify: `backend/test_reply_templates.py` if an integration assertion needs to be added.

- [ ] **Step 1: 更新 API 文档**

在作品详情示例和 `POST /api/works` 请求体示例加入：

```json
"reply_templates": [
  {"id": "narrative", "name": "叙事", "content": "使用小说式正文。"},
  {"id": "compact", "name": "简洁", "content": "只回复三段。"}
],
"active_reply_template_id": "narrative"
```

说明空数组和空 ID 表示不启用回复模板。

- [ ] **Step 2: 运行后端全量测试**

Run: `python -m unittest discover -s backend -p "test_*.py" -v`

Expected: all tests PASS with no new warnings.

- [ ] **Step 3: 运行前端回归测试和语法检查**

Run: `node --test frontend/test_reply_templates.mjs frontend/test_role_card_library.mjs frontend/test_adventure_header.mjs frontend/test_status_sidebar_toggle.mjs`

Run: `node --check frontend/js/main.js`

Expected: all selected tests PASS and syntax check exits with code 0.

- [ ] **Step 4: 做一次运行时冒烟验证**

启动本地服务，进入作品编辑页，新增两套模板，选择其中一套保存；重新打开编辑页确认模板和选择仍在；开启冒险后检查系统提示包含当前模板内容且不包含另一套模板内容；切换当前模板并发送下一条消息，确认新模板生效；进入聊天页确认没有模板切换控件。

由于工作区没有 Git 仓库，本任务以规格文档、实现文件和测试结果作为交付记录，不执行 commit。
