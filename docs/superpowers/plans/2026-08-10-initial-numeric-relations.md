# Initial Numeric Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a role card's initial numeric relationships visible and editable in the work editor, so hidden values such as `白夜: 20` can be removed before starting new conversations.

**Architecture:** The editor already persists `card.initial_state` and the conversation factory copies `initial_state.relations` into a new conversation. Extend the existing dynamic-row editor to load and save that nested map as a dedicated numeric relationship section. Do not migrate or update existing conversations, whose states are historical records.

**Tech Stack:** Vanilla JavaScript frontend, FastAPI/SQLite backend already exposing card `initial_state`, Node built-in test runner.

## Global Constraints

- Modify only the work editor UI and its source-level regression test.
- Store numeric relationships in `card.initial_state.relations`; keep `card.relationships` as textual relationship descriptions.
- Saving an empty numeric relationship list must persist `{}` and affect only future conversations.
- Do not change current or historical conversation state.

---

### Task 1: Expose and persist numeric initial relationships

**Files:**
- Modify: `frontend/js/main.js:fillCreatorForm`, `buildCreatorPayload`, `renderCreator`
- Modify: `frontend/test_settings_and_onboarding_fixes.mjs`

**Interfaces:**
- Consumes: `card.initial_state.relations`, an object mapping a name string to a numeric value.
- Produces: `card.initial_state.relations` in the existing creator save payload.

- [ ] **Step 1: Write the failing test**

```js
test("编辑器展示并保存初始数值关系", () => {
  assert.match(source, /id="initial-relation-rows"/);
  assert.match(source, /Object\.entries\(card\.initial_state\?\.relations \|\| \{\}\)/);
  assert.match(source, /relations: collectNumericPairRows\("#initial-relation-rows"\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/test_settings_and_onboarding_fixes.mjs`

Expected: FAIL because the `initial-relation-rows` editor and numeric payload mapping do not exist.

- [ ] **Step 3: Write minimal implementation**

```js
function collectNumericPairRows(selector) {
  return Object.fromEntries(
    [...document.querySelectorAll(`${selector} .dynamic-row`)]
      .map((row) => {
        const [nameInput, valueInput] = row.querySelectorAll("input");
        return [nameInput?.value.trim(), Number(valueInput?.value)];
      })
      .filter(([name, value]) => name && Number.isFinite(value))
  );
}
```

Add an `初始数值关系（状态栏）` section using `#initial-relation-rows`, load it from `card.initial_state.relations`, and set the existing payload's `initial_state.relations` to `collectNumericPairRows("#initial-relation-rows")`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/test_settings_and_onboarding_fixes.mjs && node --check frontend/js/main.js`

Expected: PASS with no syntax error.

- [ ] **Step 5: Run frontend regression suite**

Run: `node --test frontend/test_adventure_header.mjs frontend/test_adventure_leave_prompt.mjs frontend/test_status_sidebar_toggle.mjs frontend/test_work_cover.mjs frontend/test_character_state_panel.mjs frontend/test_inline_story_options.mjs frontend/test_state_change_colors.mjs frontend/test_settings_and_onboarding_fixes.mjs frontend/test_settings_api_draft.mjs`

Expected: all 12 tests pass.

- [ ] **Step 6: Commit**

Do not commit because this workspace is not a Git repository. Report the changed files and verification evidence instead.

## Self-Review

- Spec coverage: Task 1 displays, edits, and saves the hidden numeric relationship map; it intentionally leaves existing conversation records untouched.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: the UI reads and writes the same `card.initial_state.relations` object consumed by `create_conversation`.
