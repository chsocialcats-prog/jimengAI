# Role Card Library and Script References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent, reusable role-card library, make scripts reference existing cards, block deletion of referenced cards, and freeze each conversation's role-card version at creation time.

**Architecture:** Reuse the existing SQLite `cards` table as the role-card library. Add a backend reference guard and a `conversations.card_snapshot` JSON column; the conversation snapshot becomes the source for old-session AI context and UI display. Split the frontend into a role-card library/editor route and a script editor that only submits `card_id`, while maintaining equivalent Mock/offline local-storage behavior.

**Tech Stack:** FastAPI, Pydantic, SQLite, vanilla JavaScript modules, existing CSS system, Python `unittest`, Node built-in test runner.

## Global Constraints

- The new product surface must be an independent role-card library; a script may reference the same card as other scripts.
- A role card referenced by one or more scripts must not be deleted; the backend must return HTTP 409 and the UI must show the referencing script names.
- Editing a referenced role card must explicitly say it affects future sessions for those scripts; existing conversations must retain their original role-card content.
- `WorkCreate.card_id` and `WorkUpdate.card_id` remain optional; `null` means the script does not use a role card.
- Do not add or render an initial numeric relationship editor. Preserve existing `card.initial_state.relations` when saving an existing card so hidden legacy data is not overwritten.
- Do not create or update a role card as a side effect of saving a script.
- Existing cards, works, worldbooks, conversations, snapshots, and offline local-storage data must remain usable.
- This workspace is not a Git repository; do not run `git commit`. Verify with tests and file diffs instead.

---

### Task 1: Protect referenced role cards from deletion

**Files:**
- Create: `backend/test_role_card_library.py`
- Modify: `backend/repositories.py:82-169`
- Modify: `backend/routers/cards_routes.py:50-75`

**Interfaces:**
- Produces `repositories.CardReferenceConflict`, `repositories.list_card_references(card_id)`, and guarded `repositories.delete_card(card_id)` for the cards router.
- `list_card_references(card_id)` returns dictionaries with `id` and `title`, ordered by `updated_at DESC, id DESC`.
- `CardReferenceConflict.works` contains the same reference dictionaries used in the HTTP 409 detail.

- [ ] **Step 1: Write the failing repository and route tests**

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import database, repositories
from backend.routers import cards_routes


class CardReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_delete_rejects_card_referenced_by_a_work(self):
        card = repositories.create_card({"name": "共用角色"})
        work = repositories.create_work({
            "title": "引用剧本",
            "opening": "开场",
            "card_id": card["id"],
        })

        references = repositories.list_card_references(card["id"])

        self.assertEqual(references, [{"id": work["id"], "title": "引用剧本"}])
        with self.assertRaises(repositories.CardReferenceConflict) as error:
            repositories.delete_card(card["id"])
        self.assertEqual(error.exception.works, references)
        self.assertIsNotNone(repositories.get_card(card["id"]))

    def test_delete_allows_unreferenced_card(self):
        card = repositories.create_card({"name": "独立角色"})

        repositories.delete_card(card["id"])

        self.assertIsNone(repositories.get_card(card["id"]))

    def test_cards_route_returns_conflict_with_work_names(self):
        card = repositories.create_card({"name": "路由角色"})
        repositories.create_work({
            "title": "路由引用",
            "opening": "开场",
            "card_id": card["id"],
        })

        with self.assertRaises(HTTPException) as error:
            cards_routes.delete_card(card["id"])

        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail["code"], "conflict")
        self.assertEqual(error.exception.detail["works"][0]["title"], "路由引用")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run: `python -m unittest backend.test_role_card_library -v`

Expected: FAIL because `list_card_references` and `CardReferenceConflict` do not exist and `delete_card` currently removes referenced cards.

- [ ] **Step 3: Add the reference query and guarded repository deletion**

Add this exception and query immediately above `delete_card` in `backend/repositories.py`:

```python
class CardReferenceConflict(Exception):
    def __init__(self, works):
        self.works = works
        super().__init__("角色卡正在被剧本引用")


def list_card_references(card_id):
    return fetch_all(
        "SELECT id, title FROM works WHERE card_id = ? "
        "ORDER BY updated_at DESC, id DESC",
        (card_id,),
    )


def delete_card(card_id):
    references = list_card_references(card_id)
    if references:
        raise CardReferenceConflict(references)
    execute("DELETE FROM cards WHERE id = ?", (card_id,))
```

- [ ] **Step 4: Translate the repository conflict into HTTP 409**

Update `backend/routers/cards_routes.py` so the existing 404 check remains first and the delete body is:

```python
@router.delete("/{card_id}", status_code=204, summary="删除角色卡")
def delete_card(card_id: int):
    _get_card_or_404(card_id)
    try:
        repositories.delete_card(card_id)
    except repositories.CardReferenceConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "conflict",
                "message": "角色卡正在被剧本引用",
                "works": exc.works,
            },
        ) from exc
```

- [ ] **Step 5: Run the focused tests and verify green**

Run: `python -m unittest backend.test_role_card_library -v`

Expected: all three tests PASS.

- [ ] **Step 6: Run the existing backend suite**

Run: `python -m unittest discover -s backend -p "test_*.py" -v`

Expected: all existing backend tests and the three role-card tests PASS.

---

### Task 2: Snapshot role-card content into conversations

**Files:**
- Modify: `backend/database.py:20-145`
- Modify: `backend/repositories.py:438-575`
- Modify: `backend/services/adventure_engine.py:415-460`
- Test: `backend/test_role_card_library.py`

**Interfaces:**
- `conversations.card_snapshot` is a parsed role-card dictionary in API responses.
- `repositories.create_conversation` writes the current role-card snapshot in the same transaction as the conversation.
- `adventure_engine.build_messages` uses `conversation.card_snapshot` before calling `get_card`.

- [ ] **Step 1: Add failing snapshot and immutability tests**

Append these tests to `backend/test_role_card_library.py`:

```python
from backend.services import adventure_engine


class CardSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_new_conversation_copies_the_current_card(self):
        card = repositories.create_card({
            "name": "快照角色",
            "persona": "初始人设",
        })
        work = repositories.create_work({
            "title": "快照剧本",
            "opening": "开场",
            "card_id": card["id"],
        })

        conversation = repositories.create_conversation(work["id"], "第一局")

        self.assertEqual(conversation["card_snapshot"]["persona"], "初始人设")

    def test_old_conversation_uses_snapshot_after_card_update(self):
        card = repositories.create_card({
            "name": "版本角色",
            "persona": "旧人设",
        })
        work = repositories.create_work({
            "title": "版本剧本",
            "opening": "开场",
            "card_id": card["id"],
        })
        old_conversation = repositories.create_conversation(work["id"], "旧会话")

        repositories.update_card(card["id"], {"persona": "新人设"})
        new_conversation = repositories.create_conversation(work["id"], "新会话")

        old_prompt = adventure_engine.build_messages(old_conversation["id"])[0]["content"]
        new_prompt = adventure_engine.build_messages(new_conversation["id"])[0]["content"]
        self.assertIn("旧人设", old_prompt)
        self.assertNotIn("新人设", old_prompt)
        self.assertIn("新人设", new_prompt)

    def test_snapshot_migration_fills_empty_values_without_overwriting_existing(self):
        card = repositories.create_card({"name": "迁移角色", "persona": "当前人设"})
        work = repositories.create_work({
            "title": "迁移剧本",
            "opening": "开场",
            "card_id": card["id"],
        })
        empty_snapshot = repositories.create_conversation(work["id"], "空快照")
        pinned_snapshot = repositories.create_conversation(work["id"], "固定快照")
        database.execute("UPDATE conversations SET card_snapshot = '{}' WHERE id = ?", (empty_snapshot["id"],))
        database.execute(
            "UPDATE conversations SET card_snapshot = ? WHERE id = ?",
            (database.json_dumps({"name": "历史版本", "persona": "历史人设"}), pinned_snapshot["id"]),
        )

        database.init_db()

        self.assertEqual(
            repositories.get_conversation(empty_snapshot["id"])["card_snapshot"]["persona"],
            "当前人设",
        )
        self.assertEqual(
            repositories.get_conversation(pinned_snapshot["id"])["card_snapshot"]["persona"],
            "历史人设",
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the snapshot tests and verify the expected red failure**

Run: `python -m unittest backend.test_role_card_library.CardSnapshotTests -v`

Expected: FAIL because `card_snapshot` is not a column, is not written during conversation creation, and the engine still loads the live card.

- [ ] **Step 3: Add the schema column and idempotent migration**

In `backend/database.py`:

1. Add `card_snapshot TEXT NOT NULL DEFAULT '{}'` to the `conversations` table definition.
2. Add `_ensure_column(connection, "conversations", "card_snapshot", "ALTER TABLE conversations ADD COLUMN card_snapshot TEXT NOT NULL DEFAULT '{}'")` in `init_db`.
3. After the column exists, update only rows whose `card_snapshot` is empty or `{}`. Build a complete snapshot from the joined `cards` row, parsing `relationships`, `directives`, `initial_state`, and `character_attributes` with `json_loads`, then save it with `json_dumps`.
4. Leave rows with non-empty snapshots untouched so repeated startup and manually preserved historical versions are safe.

Use this migration shape:

```python
rows = connection.execute(
    "SELECT conversations.id AS conversation_id, cards.* "
    "FROM conversations JOIN cards ON cards.id = conversations.card_id "
    "WHERE conversations.card_id IS NOT NULL "
    "AND (conversations.card_snapshot IS NULL "
    "OR TRIM(conversations.card_snapshot) IN ('', '{}'))"
).fetchall()
for row in rows:
    snapshot = dict(row)
    for key, default in (
        ("relationships", {}),
        ("directives", []),
        ("initial_state", {}),
        ("character_attributes", {}),
    ):
        snapshot[key] = json_loads(snapshot.get(key), default)
    conversation_id = snapshot.pop("conversation_id")
    connection.execute(
        "UPDATE conversations SET card_snapshot = ? WHERE id = ?",
        (json_dumps(snapshot), conversation_id),
    )
```

- [ ] **Step 4: Persist and parse the snapshot in the repository**

In `backend/repositories.py`:

1. Parse `card_snapshot` in `row_to_conversation` with `json_loads(..., {})`.
2. In `create_conversation`, use `json_dumps(card or {})` in the `INSERT INTO conversations` statement and add the `card_snapshot` column/value next to `card_id`.
3. Add a small helper used by both onboarding confirmation and the engine-facing call sites:

```python
def get_conversation_card(conversation):
    if not conversation or not conversation.get("card_id"):
        return None
    snapshot = conversation.get("card_snapshot") or {}
    return snapshot if snapshot else get_card(conversation["card_id"])
```

4. Replace the live `get_card(conversation["card_id"])` call in `complete_conversation_onboarding` with `get_conversation_card(conversation)`.

- [ ] **Step 5: Make the adventure engine use the snapshot**

In `backend/services/adventure_engine.py`, replace the card-loading block in `build_messages` with:

```python
card = repositories.get_conversation_card(conversation)
```

Keep live work and worldbook behavior unchanged; this feature freezes only the role-card resource requested by the user.

- [ ] **Step 6: Run the snapshot tests and verify green**

Run: `python -m unittest backend.test_role_card_library.CardSnapshotTests -v`

Expected: all snapshot tests PASS.

- [ ] **Step 7: Run all backend tests again**

Run: `python -m unittest discover -s backend -p "test_*.py" -v`

Expected: all backend tests PASS with no migration or prompt regressions.

---

### Task 3: Add role-card API helpers, Mock storage, and routes

**Files:**
- Modify: `frontend/index.html:17-22`
- Modify: `frontend/js/main.js:1-40,240-360,640-755`
- Create: `frontend/test_role_card_library.mjs`

**Interfaces:**
- `listCards(query = "")`, `createCard(payload)`, `updateCard(id, payload)`, and `deleteCard(id)` are available to all frontend page renderers.
- `mockCards` is persisted beside `mockWorks` and `mockConversations` under `MOCK_DATA_KEY`.
- `parseRoute()` returns `{ name: "cards" }`, `{ name: "card", id: null }` for `#/card/new`, and `{ name: "card", id: Number(id) }` for an existing card.

- [ ] **Step 1: Write the failing frontend source tests**

Create `frontend/test_role_card_library.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("顶部导航提供角色卡库入口", () => {
  assert.match(index, /href="#\/cards"/);
  assert.match(index, />角色卡<\/a>/);
});

test("前端提供角色卡 CRUD API helper 和独立存储", () => {
  assert.match(main, /let mockCards = \[\];/);
  assert.match(main, /async function listCards\(/);
  assert.match(main, /async function createCard\(/);
  assert.match(main, /async function updateCard\(/);
  assert.match(main, /async function deleteCard\(/);
  assert.match(main, /cards: mockCards/);
});

test("路由识别角色卡库和新建或编辑角色卡", () => {
  assert.match(main, /if \(name === "cards"\)/);
  assert.match(main, /if \(name === "card" && id === "new"\)/);
  assert.match(main, /if \(name === "card" && id\)/);
});
```

- [ ] **Step 2: Run the new frontend tests and verify the expected red failure**

Run: `node --test frontend/test_role_card_library.mjs`

Expected: FAIL because the navigation, `mockCards`, CRUD helpers, and routes do not exist.

- [ ] **Step 3: Add the navigation and route dispatch**

In `frontend/index.html`, add a navigation link beside “创作台”:

```html
<a href="#/cards" data-nav="cards" data-icon="users">角色卡</a>
```

In `parseRoute()` add these branches before the existing creator branch:

```js
if (name === "cards") return { name: "cards" };
if (name === "card" && id === "new") return { name: "card", id: null };
if (name === "card" && id) return { name: "card", id: Number(id) };
```

In `route()` dispatch `renderCards()` and `renderCardEditor(current.id)`, and in the active-nav predicate allow `nav === "cards"` to activate on the cards and card pages.

- [ ] **Step 4: Add Mock card migration and CRUD helpers**

Add `mockCards` and update `saveMockData()` to persist it:

```js
let mockCards = [];

function saveMockData() {
  localStorage.setItem(MOCK_DATA_KEY, JSON.stringify({
    works: mockWorks,
    cards: mockCards,
    conversations: mockConversations,
    seq: mockSeq,
  }));
}
```

When loading an old saved object without `cards`, derive one card per unique `card_id` from each embedded `work.card`, set the derived card id, and keep the existing work/worldbook data. When loading a new object, ensure each work resolves its `card` from `mockCards[card_id]` only for display and conversation creation.

Implement the helpers with the same backend/offline split as the existing work helpers:

```js
async function listCards(query = "") {
  if (MODE === "offline") return mockListCards(query);
  const params = new URLSearchParams({ page: "1", page_size: "100" });
  if (query) params.set("q", query);
  return toItems(await api(`/api/cards?${params.toString()}`));
}

async function createCard(payload) {
  if (MODE === "offline") {
    const card = { ...payload, id: ++mockSeq, source: payload.source || "local", created_at: nowISO(), updated_at: nowISO() };
    mockCards.unshift(card);
    saveMockData();
    return JSON.parse(JSON.stringify(card));
  }
  return api("/api/cards", { method: "POST", body: payload });
}

async function updateCard(id, payload) {
  if (MODE === "offline") {
    const card = mockCards.find((item) => Number(item.id) === Number(id));
    if (!card) throw new Error("角色卡不存在");
    Object.assign(card, payload, { updated_at: nowISO() });
    saveMockData();
    return JSON.parse(JSON.stringify(card));
  }
  return api(`/api/cards/${id}`, { method: "PUT", body: payload });
}

async function deleteCard(id) {
  if (MODE === "offline") {
    mockCards = mockCards.filter((item) => Number(item.id) !== Number(id));
    saveMockData();
    return null;
  }
  return api(`/api/cards/${id}`, { method: "DELETE" });
}
```

Keep the offline delete helper behind the page-level reference check; Task 4 will also handle a backend 409 so a stale UI cannot delete a referenced card.

- [ ] **Step 5: Run the new frontend tests and syntax-check the module**

Run: `node --test frontend/test_role_card_library.mjs && node --check frontend/js/main.js`

Expected: all three source tests PASS and Node reports no syntax error.

---

### Task 4: Build the role-card library and independent card editor

**Files:**
- Modify: `frontend/js/main.js:1680-2090,2110-2240`
- Modify: `frontend/css/style.css:1250-1340,1490-1600`
- Modify: `frontend/test_role_card_library.mjs`
- Modify: `frontend/test_settings_and_onboarding_fixes.mjs`

**Interfaces:**
- `renderCards()` renders the searchable role-card library and binds `data-card-action` buttons.
- `renderCardEditor(cardId = null)` renders the independent role-card form.
- `fillCardForm(card)` populates the card-only fields.
- `submitCardForm()` saves only the role-card resource.
- `referencedWorksForCard(cardId, works)` returns the works used for count, warning, and delete display.

- [ ] **Step 1: Extend the failing frontend tests for the card library/editor**

Append these tests to `frontend/test_role_card_library.mjs`:

```js
test("角色卡库提供搜索、创建、编辑和删除入口", () => {
  assert.match(main, /function renderCards\(/);
  assert.match(main, /id="card-library-search"/);
  assert.match(main, /data-card-action="create"/);
  assert.match(main, /data-card-action="edit"/);
  assert.match(main, /data-card-action="delete"/);
  assert.match(main, /function referencedWorksForCard\(/);
});

test("角色卡编辑器保留角色属性和文字关系", () => {
  assert.match(main, /function renderCardEditor\(/);
  assert.match(main, /id="character-attribute-rows"/);
  assert.match(main, /id="relation-rows"/);
  assert.match(main, /此角色卡已被/);
  assert.match(main, /已经开始的旧会话不会改变/);
});

test("角色卡保存保留旧的隐藏初始关系数据", () => {
  assert.match(main, /cardEditorState\.initialState/);
  assert.match(main, /relations: cardEditorState\.initialState\?\.relations/);
  assert.doesNotMatch(main, /id="initial-relation-rows"/);
});
```

Replace the old test named `编辑器展示并保存初始数值关系` in `frontend/test_settings_and_onboarding_fixes.mjs` with:

```js
test("剧本和角色卡编辑器不再渲染初始数值关系区", () => {
  assert.doesNotMatch(source, /id="initial-relation-rows"/);
  assert.doesNotMatch(source, /collectNumericPairRows\("#initial-relation-rows"\)/);
});
```

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs`

Expected: FAIL because the library/editor renderers and the new preservation state do not exist, and the current creator still renders `initial-relation-rows`.

- [ ] **Step 3: Add the card reference helper and library renderer**

Add this helper near the existing work filtering helpers:

```js
function referencedWorksForCard(cardId, works = []) {
  return works.filter((work) => Number(work.card_id) === Number(cardId));
}
```

Implement `renderCards()` with a page head containing a “创建角色卡” button, a search input with id `card-library-search`, and a grid where every card exposes `data-card-id` plus `data-card-action="edit"` and `data-card-action="delete"`. Load `listCards(cardLibraryFilter.q)` and `listWorks()` together, compute reference counts with `referencedWorksForCard`, and display the names of referencing works in the card metadata.

Implement `bindCardsEvents()` with these behaviors:

```js
async function handleCardDelete(cardId) {
  const works = referencedWorksForCard(cardId, await listWorks());
  if (works.length) {
    openModal(`<h2>无法删除角色卡</h2><p>该角色卡正在被以下剧本引用：</p><ul>${works.map((work) => `<li>${esc(work.title)}</li>`).join("")}</ul><div class="modal-actions"><button class="btn btn-primary" type="button" data-close>知道了</button></div>`);
    return;
  }
  if (!window.confirm("删除后无法恢复，确定删除这张角色卡吗？")) return;
  try {
    await deleteCard(cardId);
    toast("角色卡已删除", "success");
    await renderCards();
  } catch (error) {
    toast(error.message || "删除失败", "error");
  }
}
```

For a stale UI/API race, catch the backend 409 in the same handler and show the backend message plus returned work names when available.

- [ ] **Step 4: Move the role-card form into `renderCardEditor`**

Use the existing dynamic-row helpers and selectors `#card-name`, `#card-persona`, `#card-personality`, `#card-speaking`, `#directive-rows`, `#attribute-rows`, `#character-attribute-rows`, and `#relation-rows`. Include sections for:

```html
<section class="panel">
  <div class="panel-header"><h2>角色卡</h2></div>
  <div class="panel-body form-stack">
    <div id="card-impact-notice" class="notice" hidden></div>
    <label class="field"><span class="field-label">角色名</span><input id="card-name" class="input" required></label>
    <label class="field span-2"><span class="field-label">人设</span><textarea id="card-persona" class="textarea compact"></textarea></label>
    <label class="field"><span class="field-label">性格</span><input id="card-personality" class="input"></label>
    <label class="field span-2"><span class="field-label">说话方式</span><textarea id="card-speaking" class="textarea compact"></textarea></label>
    <div id="directive-rows" class="dynamic-list"></div>
    <div id="attribute-rows" class="dynamic-list"></div>
    <div id="character-attribute-rows" class="dynamic-list"></div>
    <div id="relation-rows" class="dynamic-list"></div>
  </div>
</section>
```

Keep the existing JSON import button in this card editor so importing a JSON card still fills the independent card form. Do not render `initial-relation-rows` or bind an initial-relation button.

Store the original hidden state while loading:

```js
let cardEditorState = { cardId: null, initialState: {} };

function fillCardForm(card = {}) {
  cardEditorState = {
    cardId: card.id || null,
    initialState: JSON.parse(JSON.stringify(card.initial_state || {})),
  };
  // populate visible fields and dynamic rows from card
}
```

Build the save payload by preserving the original state and changing only visible fields:

```js
const initialState = {
  ...cardEditorState.initialState,
  attributes: collectAttributeRows("#attribute-rows"),
  items: Array.isArray(cardEditorState.initialState?.items)
    ? cardEditorState.initialState.items
    : [],
  relations: cardEditorState.initialState?.relations || {},
};
const payload = {
  name: value("#card-name") || "未命名角色",
  persona: value("#card-persona"),
  personality: value("#card-personality"),
  speaking_style: value("#card-speaking"),
  relationships: collectPairRows("#relation-rows"),
  directives: collectSingleRows("#directive-rows"),
  character_attributes: collectAttributeRows("#character-attribute-rows"),
  initial_state: initialState,
};
```

Before saving an existing referenced card, show a confirmation with the exact future/old-session boundary from the design. On success navigate to `#/cards`; on cancel or failure retain the form and restore the submit button.

- [ ] **Step 5: Add focused card-library styles**

Add compact styles for `.resource-grid`, `.resource-card`, `.resource-card-actions`, and `.notice` near the existing creator styles. Reuse existing panel, field, button, tag, and responsive rules; on narrow screens make `.resource-grid` one column and keep the card action buttons full-width.

- [ ] **Step 6: Run the focused frontend tests and syntax check**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs && node --check frontend/js/main.js`

Expected: all focused tests PASS with no JavaScript syntax error.

---

### Task 5: Refactor script creation and editing to reference cards

**Files:**
- Modify: `frontend/js/main.js:1817-2040,2110-2240`
- Modify: `frontend/test_role_card_library.mjs`

**Interfaces:**
- `loadCreatorEditData(workId)` returns `{ work, worldbook, entries }`; it does not load or mutate a card.
- `creatorEditState` contains only `workId`, `worldbookId`, and `entryIds`.
- `submitCreatorForm()` submits `work.card_id` and never calls `POST /api/cards` or `PUT /api/cards`.

- [ ] **Step 1: Add failing creator reference tests**

Append these tests to `frontend/test_role_card_library.mjs`:

```js
test("剧本编辑器选择已有角色卡并提交 card_id", () => {
  const creatorStart = main.indexOf("async function renderCreator");
  const creatorEnd = main.indexOf("async function renderSettings", creatorStart);
  const creator = main.slice(creatorStart, creatorEnd);
  assert.match(creator, /id="work-card-id"/);
  assert.match(creator, /不使用角色卡/);

  const submitStart = main.indexOf("async function submitCreatorForm");
  const submitEnd = main.indexOf("function bindCreatorEvents", submitStart);
  const submit = main.slice(submitStart, submitEnd);
  assert.match(submit, /card_id/);
  assert.doesNotMatch(submit, /api\("\/api\/cards"/);
  assert.doesNotMatch(submit, /api\(`\/api\/cards\/\$\{/);
});

test("作品编辑器不再内嵌角色卡字段或初始数值关系区", () => {
  const creatorStart = main.indexOf("async function renderCreator");
  const creatorEnd = main.indexOf("async function renderSettings", creatorStart);
  const creator = main.slice(creatorStart, creatorEnd);
  assert.doesNotMatch(creator, /id="card-name"/);
  assert.doesNotMatch(creator, /id="initial-relation-rows"/);
  assert.match(creator, /function populateWorkCardSelect\(/);
});
```

- [ ] **Step 2: Run the new creator tests and verify the expected red failure**

Run: `node --test frontend/test_role_card_library.mjs`

Expected: FAIL because `renderCreator` still renders the embedded card form, `submitCreatorForm` builds a new card, and no script card selector exists.

- [ ] **Step 3: Replace the embedded card section with a reference selector**

In `renderCreator`, remove the section containing `#card-name`, `#card-persona`, `#card-personality`, `#card-speaking`, `#directive-rows`, `#attribute-rows`, `#character-attribute-rows`, `#relation-rows`, and `#initial-relation-rows`.

Add this work-information field after the opening/onboarding fields:

```html
<label class="field span-2">
  <span class="field-label">角色卡</span>
  <select id="work-card-id" class="select">
    <option value="">不使用角色卡</option>
  </select>
  <span id="work-card-summary" class="detail-meta">可在角色卡库中创建和编辑角色卡。</span>
</label>
```

Implement the selector population and summary:

```js
function populateWorkCardSelect(cards = [], selectedId = null) {
  const select = $("#work-card-id");
  if (!select) return;
  select.innerHTML = `<option value="">不使用角色卡</option>${cards.map((card) => `<option value="${Number(card.id)}">${esc(card.name)}</option>`).join("")}`;
  select.value = selectedId ? String(selectedId) : "";
  updateWorkCardSummary();
}

function updateWorkCardSummary() {
  const selected = $("#work-card-id")?.selectedOptions?.[0];
  const summary = $("#work-card-summary");
  if (summary) summary.textContent = selected?.value ? `本剧本将引用：${selected.textContent}` : "本剧本不使用角色卡。";
}
```

Load `listCards()` before or during `renderCreator` initialization, call `populateWorkCardSelect(cards, work.card_id)`, and bind the select `change` event to `updateWorkCardSummary`.

- [ ] **Step 4: Make creator submission write only the work reference**

Rewrite the beginning of `submitCreatorForm()` so it builds only work/worldbook/onboarding data. The work payload must contain:

```js
const selectedCardId = value("#work-card-id");
const work = {
  title: value("#work-title") || "未命名剧本",
  description: value("#work-description") || "一个高自由度文字冒险。",
  opening: value("#work-opening") || "故事从这里开始。",
  tags: value("#work-tags")
    ? value("#work-tags").split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
    : ["20+"],
  onboarding,
  cover_url: value("#work-cover-url"),
  card_id: selectedCardId ? Number(selectedCardId) : null,
};
```

Remove the `card` object construction, `initial_state` collection, and all card API calls from this function.

- [ ] **Step 5: Refactor save/load paths for existing scripts**

Update `loadCreatorEditData` to load the work and worldbook only. Update `creatorEditState` to omit `cardId`. In `saveCreatorEdit`:

- offline mode updates the existing work's `card_id`, work fields, and worldbook without changing any `mockCards` record;
- backend mode updates worldbook entries and calls `PUT /api/works/{workId}` with the selected `card_id`;
- no card `PUT` is issued.

For new backend scripts, create the worldbook and entries first, then call `POST /api/works` with the selected `card_id`. For new offline scripts, allocate only a work/worldbook id and store the selected `card_id`; do not allocate a card id or append to `mockCards`.

- [ ] **Step 6: Remove obsolete initial-relation setup and update creator initialization**

Delete `collectNumericPairRows` if no remaining call site uses it. Remove the `addDynamicRow("#initial-relation-rows", ...)` initialization and the `#add-initial-relation` listener. Keep the role-card editor’s hidden-state preservation from Task 4.

- [ ] **Step 7: Use conversation snapshots in the adventure page**

In `renderAdventure`, choose the card in this order:

```js
const card = MODE === "offline"
  ? session.conv.card_snapshot || work?.card || null
  : session.conv.card_snapshot || (work?.card_id ? await getCard(work.card_id) : null);
```

Keep the existing work/worldbook loading and conversation state behavior unchanged.

- [ ] **Step 8: Run focused creator tests and syntax check**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs && node --check frontend/js/main.js`

Expected: all focused tests PASS and no syntax error is reported.

---

### Task 6: Update Mock conversation snapshots and existing frontend regressions

**Files:**
- Modify: `frontend/js/main.js:290-325,610-650,330-360`
- Modify: `frontend/test_role_card_library.mjs`
- Modify: `frontend/test_adventure_header.mjs`
- Modify: `frontend/test_adventure_leave_prompt.mjs`
- Modify: `frontend/test_work_cover.mjs`

**Interfaces:**
- Every newly created Mock conversation has `card_snapshot` copied from the selected `mockCards` entry.
- Mock role-card edits affect only future Mock conversations; existing `mockConversations[id].card_snapshot` is never rewritten.

- [ ] **Step 1: Add failing Mock snapshot source tests**

Append to `frontend/test_role_card_library.mjs`:

```js
test("Mock 新会话保存角色卡快照且后续编辑不覆盖旧会话", () => {
  const createStart = main.indexOf("function createMockConversation");
  const createEnd = main.indexOf("async function listWorks", createStart);
  const create = main.slice(createStart, createEnd);
  assert.match(create, /card_snapshot/);
  assert.match(create, /JSON\.parse\(JSON\.stringify\(card/);
  assert.doesNotMatch(main, /mockConversations = .*mockCards/);
});
```

- [ ] **Step 2: Run the test and verify the expected red failure**

Run: `node --test frontend/test_role_card_library.mjs`

Expected: FAIL because `createMockConversation` currently copies only `current_state` and has no `card_snapshot` field.

- [ ] **Step 3: Snapshot the selected Mock card during conversation creation**

Update `createMockConversation(work)` to resolve the selected card from `mockCards`, deep-copy it, and store it on the conversation:

```js
const card = mockCards.find((item) => Number(item.id) === Number(work.card_id)) || work.card || {};
const cardSnapshot = JSON.parse(JSON.stringify(card));
const conv = {
  id,
  work_id: work.id,
  card_id: work.card_id || null,
  card_snapshot: cardSnapshot,
  // keep the existing state/messages/snapshot fields
};
```

When loading old Mock conversations without `card_snapshot`, fill it once from the old embedded `work.card` and persist the migrated object; never recompute it from the current `mockCards` after it is non-empty.

- [ ] **Step 4: Run Mock snapshot tests and the existing frontend suite**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_adventure_header.mjs frontend/test_adventure_leave_prompt.mjs frontend/test_work_cover.mjs frontend/test_character_state_panel.mjs frontend/test_inline_story_options.mjs frontend/test_state_change_colors.mjs frontend/test_status_sidebar_toggle.mjs frontend/test_no_manual_dice_command.mjs frontend/test_settings_api_draft.mjs frontend/test_settings_and_onboarding_fixes.mjs`

Expected: all frontend tests PASS.

---

### Task 7: Full verification and requirement audit

**Files:**
- Inspect: `docs/superpowers/specs/2026-08-10-role-card-library-design.md`
- Inspect: `docs/superpowers/plans/2026-08-10-role-card-library.md`
- Inspect: all modified backend/frontend files

- [ ] **Step 1: Run the complete backend test command**

Run: `python -m unittest discover -s backend -p "test_*.py" -v`

Expected: exit code 0 and every backend test passes.

- [ ] **Step 2: Run the complete frontend test command**

Run: `node --test frontend/*.mjs`

Expected: exit code 0 and every frontend test passes.

- [ ] **Step 3: Run syntax and startup checks**

Run: `node --check frontend/js/main.js; python -m unittest test_start_browser -v`

Expected: exit code 0 with no JavaScript syntax error and the existing startup test passing.

- [ ] **Step 4: Audit the requirements against the implementation**

Confirm each item directly in the changed files and test output:

1. `frontend/index.html` has a top-level “角色卡” link.
2. `renderCards` supports search/create/edit/delete.
3. `renderCardEditor` owns role-card fields and preserves hidden `initial_state.relations` without rendering an editor.
4. `renderCreator` has only a `card_id` selector and never posts or puts a card.
5. `backend/repositories.delete_card` rejects any referenced card and the route returns 409.
6. `conversations.card_snapshot` is created and migrated idempotently.
7. Backend and Mock adventure contexts read the snapshot for old conversations.
8. Existing test suites remain green.

- [ ] **Step 5: Inspect the final file diff without committing**

Run: `Get-ChildItem -Recurse -File backend,frontend,docs\superpowers\specs,docs\superpowers\plans | Sort-Object FullName | Select-Object FullName,Length,LastWriteTime`

Expected: only the documented source, test, style, and plan/spec files are changed or added; no database deletion, reset, or Git commit is performed.

