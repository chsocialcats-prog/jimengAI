# Role-Card JSON Format Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a “JSON 格式” help button beside the role-card JSON upload control and show the current project JSON schema in a read-only modal.

**Architecture:** Reuse the existing `openModal()` helper and modal-root close behavior. Add one static HTML helper, one button in `renderCardEditor()`, one click binding in `bindCardEditorEvents()`, and bounded CSS for the example; leave upload parsing and persistence unchanged.

**Tech Stack:** Vanilla JavaScript ES modules, existing HTML templates and modal styles, Node’s built-in `node:test`.

## Global Constraints

- The button is beside the existing JSON file upload control and is labeled “JSON 格式”.
- The modal is read-only, closes through the existing close button or backdrop behavior, and does not read or modify current form values.
- The help documents the current role-card fields and says that `name` is the only required field.
- It explains that `id`, `created_at`, and `updated_at` are response fields; `world` and `opening` belong to work/worldbook configuration; direct objects and top-level `card` wrappers are accepted.
- Do not change backend schemas, JSON import parsing, role-card persistence, or unrelated existing workspace modifications.
- Escape the example JSON before inserting it and ensure the code block wraps or scrolls without overflowing the modal.

---

## File Map

- Modify: `frontend/test_role_card_library.mjs` — regression contract for the button, click binding, and help content.
- Modify: `frontend/js/main.js` — help HTML, editor button, and click binding.
- Modify: `frontend/css/style.css` — bounded JSON example styling.

### Task 1: Add the failing regression test

**Files:**
- Modify: `frontend/test_role_card_library.mjs`

**Interfaces:**
- Consumes: the role-card editor and binding source in `frontend/js/main.js`.
- Produces: a test that fails until the feature exists.

- [ ] **Step 1: Write the failing test**

Add a test after the existing role-card editor tests:

```js
test("role-card editor exposes JSON format help beside the upload control", () => {
  const editorStart = mainJs.indexOf("async function renderCardEditor");
  const editorEnd = mainJs.indexOf("async function renderCreator", editorStart);
  const editor = mainJs.slice(editorStart, editorEnd);
  assert.match(editor, /id="card-file"/);
  assert.match(editor, /id="card-json-format-btn"/);
  assert.match(editor, /JSON 格式/);

  const bindStart = mainJs.indexOf("function bindCardEditorEvents");
  const bindEnd = mainJs.indexOf("function setCardEditorSaveEnabled", bindStart);
  const bindings = mainJs.slice(bindStart, bindEnd);
  assert.match(bindings, /card-json-format-btn/);
  assert.match(bindings, /openModal\(roleCardJsonFormatHtml\(\)\)/);

  const helpStart = mainJs.indexOf("function roleCardJsonFormatHtml");
  const helpEnd = mainJs.indexOf("function bindCardEditorEvents", helpStart);
  const help = mainJs.slice(helpStart, helpEnd);
  for (const field of ["name", "persona", "personality", "speaking_style", "relationships", "directives", "initial_state", "character_attributes", "source"]) {
    assert.match(help, new RegExp('"' + field + '"'));
  }
  assert.match(help, /json-format-example/);
  assert.match(help, /data-close/);
});
```

- [ ] **Step 2: Run it and verify the expected failure**

Run:

```powershell
node --test frontend/test_role_card_library.mjs
```

Expected: existing tests pass, while the new test fails because `card-json-format-btn` and `roleCardJsonFormatHtml` do not exist.

### Task 2: Implement the minimal help modal

**Files:**
- Modify: `frontend/js/main.js` near `bindCardEditorEvents()` and `renderCardEditor()`.
- Modify: `frontend/css/style.css` near the existing role-card editor styles.

**Interfaces:**
- Consumes: `openModal(html)`, `esc(value)`, `icon(name)`, and existing modal close behavior.
- Produces: `roleCardJsonFormatHtml()` plus the `#card-json-format-btn` click path.

- [ ] **Step 1: Add `roleCardJsonFormatHtml()`**

Define the helper immediately before `bindCardEditorEvents()`. Store the representative JSON in a template string, insert it as `${esc(example)}` inside `<pre class="json-format-example"><code>...</code></pre>`, and include a heading, field descriptions, import notes, and:

```html
<div class="modal-actions"><button class="btn btn-primary" type="button" data-close>关闭</button></div>
```

The example must contain:

```json
{
  "name": "角色名",
  "persona": "身份、经历、行为动机和核心人设",
  "personality": "谨慎、嘴硬、重情",
  "speaking_style": "语气、常用词与说话节奏",
  "relationships": { "玩家": "与玩家的关系描述" },
  "directives": ["始终保持角色人设", "不要替玩家做决定"],
  "initial_state": {
    "attributes": { "魅力": 60, "武力": 40 },
    "items": [],
    "relations": {},
    "money": 100,
    "quests": [],
    "flags": []
  },
  "character_attributes": { "心情": 50, "好感度": 0 },
  "source": "local"
}
```

The explanatory text must state that only `name` is required, direct objects and `{ "card": { ... } }` wrappers can be imported, `id`/timestamps are response fields, and `world`/`opening` belong to work/worldbook configuration.

- [ ] **Step 2: Add and bind the button**

In the `renderCardEditor()` title actions, insert after the file input and before the back button:

```js
<button class="btn btn-ghost" type="button" id="card-json-format-btn">${icon("info")} JSON 格式</button>
```

In `bindCardEditorEvents()` add:

```js
$("#card-json-format-btn")?.addEventListener("click", () => openModal(roleCardJsonFormatHtml()));
```

Keep the existing `#card-file` upload listener unchanged.

- [ ] **Step 3: Add bounded example CSS**

Add `.json-format-example` styling with panel background/border variables, padding, rounded corners, monospace font, `white-space: pre-wrap`, and `overflow-wrap: anywhere` so long lines remain readable inside the modal.

- [ ] **Step 4: Run the focused checks**

Run:

```powershell
node --test frontend/test_role_card_library.mjs
node --check frontend/js/main.js
```

Expected: all role-card tests pass and the syntax check succeeds.

### Task 3: Verify scope and commit

**Files:**
- Inspect: `frontend/js/main.js`
- Inspect: `frontend/css/style.css`
- Inspect: `frontend/test_role_card_library.mjs`

**Interfaces:**
- Consumes: the implemented button and modal.
- Produces: verified frontend behavior with no unrelated changes.

- [ ] **Step 1: Run all frontend tests**

Run:

```powershell
node --test frontend/*.mjs
```

Expected: all tests pass without warnings.

- [ ] **Step 2: Review formatting and scope**

Run:

```powershell
git diff --check
git diff -- frontend/js/main.js frontend/css/style.css frontend/test_role_card_library.mjs
```

Confirm only the help button, modal content, bounded styling, and focused test are included. Preserve all other pre-existing modified files.

- [ ] **Step 3: Commit only the implementation files**

Run:

```powershell
git add -- frontend/js/main.js frontend/css/style.css frontend/test_role_card_library.mjs
git commit -m "feat: add role-card JSON format help"
```

