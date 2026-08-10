# Multi-Role Cards and Script Player Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move player initial attributes to script settings and let each script manage an ordered, reusable list of role cards while preserving existing single-card data and old-session snapshots.

**Architecture:** Add a normalized `work_cards` association table for ordered script-to-card references, a `works.player_attributes` JSON column for script-owned player attributes, and a `conversations.card_snapshots` JSON array for immutable multi-card sessions. Keep `works.card_id` and `conversations.card_snapshot` as first-card compatibility fields. Extend the existing FastAPI repositories and vanilla-JS frontend incrementally, with Mock/offline data matching the backend shape.

**Tech Stack:** FastAPI, Pydantic, SQLite, vanilla JavaScript, Python `unittest`, Node built-in test runner.

## Global Constraints

- A script may reference multiple distinct role cards in a user-controlled order; all selected cards are active in new sessions.
- Player attributes are stored and edited at script level in `works.player_attributes`; role cards do not render a player-attribute editor.
- Do not add or render an initial numeric relationship editor. Preserve legacy hidden role-card `initial_state` data when saving existing cards.
- Existing `works.card_id` and `conversations.card_snapshot` remain readable compatibility fields; they represent the first role card only.
- Existing single-card scripts and old Mock data migrate without data loss; repeated initialization is idempotent.
- A non-empty conversation card snapshot is authoritative even if the live script/card reference later changes or is deleted.
- Saving a script changes only the script, its player attributes, its ordered card references, and its worldbook; it never creates or updates a role card.
- Referenced role cards remain undeletable; the backend reference guard is authoritative and returns the existing HTTP 409 structure.
- No external dependencies or Git commits; this workspace is not a Git repository.

---

### Task 1: Add schema and idempotent legacy migrations

**Files:**

- Modify: `backend/database.py`
- Test: `backend/test_multi_role_cards.py`

**Interfaces:**

- Produces `work_cards(work_id, card_id, position)`, `works.player_attributes`, and `conversations.card_snapshots`.
- Migration preserves old `works.card_id`, `cards.initial_state`, and `conversations.card_snapshot` while deriving the new representations.

- [ ] **Step 1: Write failing migration tests**

Add temporary-database tests that create a card with `initial_state.attributes`, a work with only `card_id`, and a conversation with only a legacy `card_snapshot`; after `database.init_db()` inspect the migrated columns directly and assert:

```python
self.assertEqual(
    database.fetch_all(
        "SELECT card_id, position FROM work_cards WHERE work_id = ?",
        (work_id,),
    ),
    [{"card_id": card["id"], "position": 0}],
)
self.assertEqual(
    database.json_loads(
        database.fetch_one(
            "SELECT player_attributes FROM works WHERE id = ?",
            (work_id,),
        )["player_attributes"]
    ),
    {"魅力": 60},
)
self.assertEqual(
    database.json_loads(
        database.fetch_one(
            "SELECT card_snapshots FROM conversations WHERE id = ?",
            (conversation_id,),
        )["card_snapshots"]
    ),
    [legacy_snapshot],
)
```

Also call `database.init_db()` twice and assert the association count and existing player attributes are unchanged.

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run: `python -m unittest backend.test_multi_role_cards -v`

Expected: failure because the new table/columns and parsed response fields do not exist.

- [ ] **Step 3: Add the new schema and guarded columns**

In the schema and `init_db()`:

```sql
CREATE TABLE IF NOT EXISTS work_cards (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    PRIMARY KEY (work_id, card_id),
    UNIQUE (work_id, position)
)
```

Add `player_attributes TEXT NOT NULL DEFAULT '{}'` to `works` and `card_snapshots TEXT NOT NULL DEFAULT '[]'` to `conversations` through `_ensure_column` for existing databases.

- [ ] **Step 4: Implement idempotent backfills**

Backfill only missing data:

1. Insert `(work_id, card_id, 0)` for each work whose association table has no row and whose legacy `card_id` is non-null.
2. For empty `works.player_attributes`, copy the first referenced card’s parsed `initial_state.attributes`; never overwrite a non-empty script value.
3. For empty `conversations.card_snapshots`, parse the legacy `card_snapshot` and store a one-element array; leave existing non-empty arrays untouched.

Use `INSERT OR IGNORE` for associations and an emptiness guard in every update so repeated startup is safe.

- [ ] **Step 5: Run migration tests and backend syntax checks**

Run: `python -m unittest backend.test_multi_role_cards -v`

Expected: all migration tests pass. Run `python -m py_compile backend/database.py` as a syntax check.

---

### Task 2: Expose ordered card references and script player attributes in the backend API

**Files:**

- Modify: `backend/repositories.py`
- Modify: `backend/schemas.py`
- Modify: `backend/routers/works_routes.py`
- Modify: `backend/routers/cards_routes.py`
- Test: `backend/test_multi_role_cards.py`

**Interfaces:**

- `repositories.get_work(work_id)` and `list_works()` return `card_ids`, ordered `cards`, legacy `card_id`/`card`, and `player_attributes`.
- `repositories.update_work()` accepts explicit `card_ids=[]` and `player_attributes={}` without treating them as omitted.
- `WorkCreate` and `WorkUpdate` accept `card_ids: Optional[list[int]]` and `player_attributes: Optional[dict]`; legacy `card_id` remains accepted.
- `repositories.list_card_references(card_id)` includes works linked through `work_cards` and legacy `works.card_id` without duplicates.

- [ ] **Step 1: Add failing API/repository tests**

Add tests for:

- creating one work with `card_ids=[first, second]` and checking order and returned card summaries;
- rejecting a nonexistent card ID with the existing 422 validation shape;
- updating a work with `card_ids=[]` and `player_attributes={"体力": 80}`;
- updating through `works_routes.update_work(work_id, WorkUpdate(card_id=None))` still clearing the legacy first-card reference and association list;
- a role card referenced by any position in any work remains protected from deletion.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `python -m unittest backend.test_multi_role_cards -v`

Expected: failures for missing `card_ids`, player attributes, association writes, and multi-reference aggregation.

- [ ] **Step 3: Add normalization and association helpers**

Implement a repository helper with this behavior:

```python
def normalize_card_ids(data, *, for_update=False):
    if "card_ids" in data:
        raw_ids = data["card_ids"] or []
    elif "card_id" in data:
        raw_ids = [] if data["card_id"] is None else [data["card_id"]]
    elif for_update:
        return None
    else:
        raw_ids = []
    result = []
    for card_id in raw_ids:
        card_id = int(card_id)
        if card_id not in result:
            result.append(card_id)
    return result
```

Add one transaction-backed helper to replace all positions for a work, validate every card exists, and update `works.card_id` to the first ID or `NULL`. Keep `player_attributes` as a JSON object and preserve omitted update fields.

- [ ] **Step 4: Update work row serialization and routes**

Join/lookup association rows in position order, parse each card, and add the response compatibility fields. Extend `_validate_references()` to validate all `card_ids`. The create/update routes should normalize legacy `card_id` only when the new `card_ids` field is absent, then pass the normalized data to the repository.

- [ ] **Step 5: Update deletion reference aggregation**

Make the atomic card-delete transaction query both `work_cards` and any legacy `works.card_id` rows, combine by work ID, and return `{id, title}` ordered by latest update and ID. Preserve the existing `CardReferenceConflict` and HTTP 409 detail contract.

- [ ] **Step 6: Run the focused and full backend suites**

Run:

```text
python -m unittest backend.test_multi_role_cards -v
python -m unittest backend.test_role_card_library -v
python -m unittest discover -s backend -p "test_*.py"
```

Expected: all pass, including prior role-card deletion and snapshot tests.

---

### Task 3: Snapshot multiple role cards and script attributes in conversations and AI context

**Files:**

- Modify: `backend/repositories.py`
- Modify: `backend/services/adventure_engine.py`
- Test: `backend/test_multi_role_cards.py`

**Interfaces:**

- `repositories.get_conversation_cards(conversation)` returns a non-empty `card_snapshots` array first, then falls back to the conversation/work’s current ordered cards.
- `repositories.create_conversation()` stores `card_snapshots` and initializes `current_state.attributes` from `work.player_attributes` in the same transaction.
- `adventure_engine.build_messages()` renders all cards in their stored order and never reloads live cards for a non-empty snapshot.

- [ ] **Step 1: Add failing conversation/engine tests**

Create a two-card work with player attributes, start a conversation, and assert:

```python
self.assertEqual(conversation["card_snapshots"][0]["name"], first["name"])
self.assertEqual(conversation["card_snapshots"][1]["name"], second["name"])
self.assertEqual(repositories.get_state(conversation["id"])["attributes"], {"体力": 80})
prompt = adventure_engine.build_messages(conversation["id"])[0]["content"]
self.assertLess(prompt.index(first["name"]), prompt.index(second["name"]))
```

Add a regression test that changes the work’s card order and clears/deletes the old live card, then verifies the old conversation prompt still contains both original card personas. Add a new conversation test proving it uses the changed order/current cards.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python -m unittest backend.test_multi_role_cards -v`

Expected: failure because creation and `build_messages()` currently support one card snapshot and derive state from a role card.

- [ ] **Step 3: Extend conversation serialization and creation**

Parse `card_snapshots` in `row_to_conversation`. In `create_conversation`, fetch the ordered work cards and insert:

```python
card_id = card_ids[0] if card_ids else None
card_snapshot = cards[0] if cards else {}
card_snapshots = cards
current_state = normalize_state({"attributes": work.get("player_attributes") or {}})
```

Write both compatibility and array snapshot columns in one transaction. Keep onboarding configuration and worldbook behavior unchanged.

- [ ] **Step 4: Add snapshot-first multi-card repository helper**

Return a non-empty `conversation.card_snapshots` array before checking `card_id`. If only a legacy `card_snapshot` exists, wrap it as a one-element list. If there is no snapshot, load the current ordered cards from the work/association table.

- [ ] **Step 5: Update the adventure engine card sections**

Replace the singular card block with a deterministic loop over cards. Keep all existing card fields and section formatting for each card; prefix each section with the card name so multiple cards remain distinguishable. No card sections are emitted for an empty list.

- [ ] **Step 6: Run all backend tests**

Run: `python -m unittest discover -s backend -p "test_*.py"`

Expected: all backend tests pass.

---

### Task 4: Update Mock storage and frontend card/work API helpers

**Files:**

- Modify: `frontend/js/main.js`
- Test: `frontend/test_role_card_library.mjs`

**Interfaces:**

- Mock works use `card_ids` and `player_attributes`; legacy `card_id` is synchronized to the first ID.
- `listCards`, `listAllCards`, `listWorks`, and `listAllWorks` remain usable; work/card response normalization produces ordered arrays.
- New Mock conversations store `card_snapshots` as a deep-copied array and retain legacy `card_snapshot` as the first card.

- [ ] **Step 1: Add failing frontend migration/snapshot tests**

Add source-contract tests asserting old Mock work data is normalized to a one-item `card_ids` array, that `player_attributes` is derived only when missing, and that `createMockConversation` deep-copies every selected card into `card_snapshots`.

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `node --test frontend/test_role_card_library.mjs`

Expected: failures because Mock storage and conversation creation are still singular-card.

- [ ] **Step 3: Normalize Mock work records and persistence**

During `loadMockData()`, for each work:

```js
work.card_ids = Array.isArray(work.card_ids)
  ? [...new Set(work.card_ids.map(Number).filter(Number.isFinite))]
  : (work.card_id ? [Number(work.card_id)] : []);
work.card_id = work.card_ids[0] || null;
if (!work.player_attributes && work.card?.initial_state?.attributes) {
  work.player_attributes = JSON.parse(JSON.stringify(work.card.initial_state.attributes));
}
```

Persist `card_ids` and `player_attributes` in `saveMockData()` while retaining embedded `work.card` only as legacy display data.

- [ ] **Step 4: Snapshot all selected Mock cards**

Update `createMockConversation(work)` to resolve every `work.card_ids` entry from `mockCards`, deep-copy the ordered list to `card_snapshots`, set `card_snapshot` to the first item, and initialize state attributes from `work.player_attributes`. Migrate old conversations only when their array snapshot is absent/empty; never overwrite a non-empty array.

- [ ] **Step 5: Run frontend regression tests and syntax check**

Run:

```text
node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs
node --test frontend/*.mjs
node --check frontend/js/main.js
```

Expected: all pass.

---

### Task 5: Move player attributes into the script editor and add ordered multi-card controls

**Files:**

- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`
- Modify: `frontend/test_role_card_library.mjs`

**Interfaces:**

- `populateWorkCardRows(cards, selectedIds)` renders the ordered card rows and controls.
- `collectWorkCardIds()` returns unique numeric IDs in visible order.
- `collectAttributeRows("#player-attribute-rows")` returns the script’s player attributes.
- `submitCreatorForm()` submits `card_ids`, `player_attributes`, and no card CRUD calls.

- [ ] **Step 1: Add failing script-editor tests**

Assert that the creator slice contains `#work-card-rows`, `#player-attribute-rows`, add/remove/up/down controls, `card_ids`, and `player_attributes`; assert the independent role-card editor slice no longer contains the player-attribute editor `#attribute-rows` while it still has character attributes and text relationships.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs`

Expected: failures because the current creator has one selector and the current role-card editor still owns `#attribute-rows`.

- [ ] **Step 3: Remove the player-attribute editor from role cards**

Delete only the visible player-attribute section and its add-row binding from `renderCardEditor`/`fillCardForm`. Keep `cardEditorState.initialState` as the hidden base; on save preserve legacy `initial_state.attributes` and other unknown keys without rendering them. Keep `#character-attribute-rows` for plot-character attributes.

- [ ] **Step 4: Implement ordered multi-card controls**

Render each selected card as a row with a select, name/summary, remove, up, and down buttons. The add control selects from cards not already present. Re-render rows after each operation while retaining the current ordered ID list. Display the no-card state when the list is empty.

- [ ] **Step 5: Add the player attributes section to script settings**

Render `#player-attribute-rows` with the existing pair-row helper, populate from `work.player_attributes`, and collect it on submit. Saving a new or existing script sends the ordered `card_ids` array and `player_attributes` object; it does not create/update cards.

- [ ] **Step 6: Add focused styles and preserve responsive behavior**

Style the ordered card rows and move/remove controls beside existing resource/card styles. On narrow screens stack each row and keep controls usable without horizontal overflow.

- [ ] **Step 7: Run frontend tests and syntax check**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_settings_and_onboarding_fixes.mjs && node --check frontend/js/main.js`

Expected: all focused tests pass and syntax is clean.

---

### Task 6: Render multiple session cards and update existing frontend surfaces

**Files:**

- Modify: `frontend/js/main.js`
- Modify: `frontend/test_adventure_header.mjs`
- Modify: `frontend/test_adventure_leave_prompt.mjs`
- Modify: `frontend/test_role_card_library.mjs`

**Interfaces:**

- `renderAdventure()` resolves `card_snapshots` first and stores the ordered `cards` array in `session`.
- Persona correction defaults are assembled from all cards in the active session snapshot.
- Work detail/list surfaces show all selected card names without changing old no-card behavior.

- [ ] **Step 1: Add failing multi-card rendering tests**

Add source assertions that adventure rendering prefers `conv.card_snapshots`, session stores an ordered card array, correction defaults iterate cards, and work detail displays multiple card names.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test frontend/test_role_card_library.mjs frontend/test_adventure_header.mjs frontend/test_adventure_leave_prompt.mjs`

Expected: failures because the current surfaces resolve only one `card_snapshot`/`card`.

- [ ] **Step 3: Update adventure resolution and session state**

Resolve non-empty `conv.card_snapshots` first; for legacy data wrap non-empty `conv.card_snapshot`; otherwise resolve the current ordered work cards. Store `session.cards` and use all cards for display and corrections. Keep the existing work/worldbook/message/state loading sequence.

- [ ] **Step 4: Update work surfaces and no-card fallback**

Render a compact ordered list of selected card names/summaries on the work detail page and preserve the existing empty state. Escape all names and summaries.

- [ ] **Step 5: Run the full frontend suite**

Run: `node --test frontend/*.mjs && node --check frontend/js/main.js`

Expected: all frontend tests pass and syntax is clean.

---

### Task 7: Full verification and requirement audit

**Files:**

- Inspect: `docs/superpowers/specs/2026-08-10-multi-role-cards-player-attributes-design.md`
- Inspect: `docs/superpowers/plans/2026-08-10-multi-role-cards-player-attributes.md`
- Inspect: all modified backend/frontend files and reports

- [ ] **Step 1: Run complete backend verification**

Run: `python -m unittest discover -s backend -p "test_*.py"`

Expected: exit code 0 with every backend test passing.

- [ ] **Step 2: Run complete frontend verification**

Run: `node --test frontend/*.mjs`

Expected: exit code 0 with every frontend test passing.

- [ ] **Step 3: Run syntax and startup checks**

Run:

```text
node --check frontend/js/main.js
python -m unittest test_start_browser -v
```

Expected: both exit 0.

- [ ] **Step 4: Audit the seven acceptance criteria**

Confirm in source and tests:

1. Role-card editor has no player-attribute editor and no initial numeric relation editor.
2. Script settings save one `player_attributes` object.
3. Script settings add/remove/reorder multiple distinct role cards and submit `card_ids`.
4. New backend and Mock conversations snapshot all selected cards and script player attributes.
5. Existing sessions use their snapshots after role-card/script changes or deletions.
6. Old single-card backend and Mock data migrate idempotently.
7. Referenced-card deletion protection and full test suites remain green.

- [ ] **Step 5: Append final report without Git mutation**

Write `.superpowers/sdd/2026-08-10-multi-role-cards-player-attributes/task-7-report.md` with command results, audit evidence, changed-file inventory, and any deferred minor test-coverage notes. Do not reset, delete, or commit workspace data.
