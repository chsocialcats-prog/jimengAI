# Chat Reply Length Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an online-only reply-length selector beside the adventure chat composer, persisted per conversation in browser storage and forwarded to the DeepSeek request.

**Architecture:** Keep the current global generation setting as the fallback. Add a small backend reply-length module that owns the four-token-budget presets and prompt hints, then pass the selected preset through the existing `ChatRequest.metadata` field to the existing per-request `max_tokens` override. Add a frontend selector that is rendered only in online mode, stores the selected preset under the conversation ID, and includes it in subsequent online requests.

**Tech Stack:** FastAPI/Pydantic, Python `unittest`, vanilla browser JavaScript, Node built-in `node:test`, existing CSS.

## Global Constraints

- Only online DeepSeek mode gets the selector and length behavior; Mock/offline mode keeps its current fixed demo replies and UI.
- Presets are `short=1024`, `standard=2048`, `detailed=4096`, and `long=8192` tokens.
- Default preset is `detailed`.
- Persist the selection in browser `localStorage` keyed by conversation ID; do not add a database column or global setting.
- Use the existing `ChatRequest.metadata` object; old requests without metadata must retain the global `generation.max_tokens` behavior.
- Length hints must not override role cards, work rules, or `<state_delta>`, `<judge>`, and `<options>` output protocols.
- Use test-first development: every production change follows a failing test and a focused green test run.

---

### Task 1: Define and test the backend length presets

**Files:**
- Create: `backend/services/reply_length.py`
- Create: `backend/test_reply_length.py`

**Interfaces:**
- Produces `REPLY_LENGTH_PRESETS`, `DEFAULT_REPLY_LENGTH`, `resolve_reply_length(metadata, fallback_max_tokens)`, and `append_reply_length_instruction(messages, reply_length)`.
- `resolve_reply_length` returns a mapping with `key`, `max_tokens`, and `instruction`; invalid or absent metadata returns `key=None`, the integer fallback, and an empty instruction.
- `append_reply_length_instruction` returns a new message list, appending the selected instruction to the first system message without mutating its input; an invalid key returns an equivalent copy.

- [ ] **Step 1: Write the failing backend unit tests**

Add a `unittest.TestCase` with tests that assert:

```python
def test_resolves_all_reply_length_presets(self):
    self.assertEqual(resolve_reply_length({"reply_length": "short"}, 777)["max_tokens"], 1024)
    self.assertEqual(resolve_reply_length({"reply_length": "standard"}, 777)["max_tokens"], 2048)
    self.assertEqual(resolve_reply_length({"reply_length": "detailed"}, 777)["max_tokens"], 4096)
    self.assertEqual(resolve_reply_length({"reply_length": "long"}, 777)["max_tokens"], 8192)

def test_invalid_or_missing_reply_length_uses_global_fallback(self):
    self.assertEqual(resolve_reply_length({}, 777), {
        "key": None,
        "max_tokens": 777,
        "instruction": "",
    })
    self.assertEqual(resolve_reply_length({"reply_length": "unknown"}, 777)["max_tokens"], 777)

def test_length_instruction_is_added_only_to_the_system_message(self):
    messages = [
        {"role": "system", "content": "base rules"},
        {"role": "user", "content": "look around"},
    ]
    updated = append_reply_length_instruction(messages, "long")
    self.assertIn("2000", updated[0]["content"])
    self.assertEqual(updated[1], messages[1])
    self.assertEqual(messages[0]["content"], "base rules")
```

Use the actual project import style (`from backend.services.reply_length import ...`) and keep the assertions focused on behavior, not implementation details.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
python -m unittest backend.test_reply_length -v
```

Expected: FAIL because `backend.services.reply_length` does not exist yet.

- [ ] **Step 3: Implement the minimal preset module**

Define the four presets with human-readable instructions that ask for the corresponding approximate Chinese-character range while explicitly preserving structured output rules. Treat only the exact string keys as valid, coerce the fallback to `int`, and return a copied message list from the instruction helper.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
python -m unittest backend.test_reply_length -v
```

Expected: all tests pass with no errors.

- [ ] **Step 5: Commit the backend preset unit**

```powershell
git add backend/services/reply_length.py backend/test_reply_length.py
git commit -m "feat: define chat reply length presets"
```

---

### Task 2: Forward the selected preset through the online chat stream

**Files:**
- Modify: `backend/routers/chat_routes.py:110-132,181-235`
- Create: `backend/test_chat_reply_length.py`

**Interfaces:**
- `_stream_chat(conversation_id, content, client_metadata, stop_event)` passes `client_metadata` to `_stream_ai_reply`.
- `_stream_ai_reply(conversation_id, stop_event, client_metadata=None)` resolves the preset, adds its instruction to the prepared messages, and calls `client.stream_chat(messages, max_tokens=selected_limit)` only when a valid preset was supplied; legacy requests call `client.stream_chat(messages)`.

- [ ] **Step 1: Write the failing route-level test**

Create a fake online client that records `stream_chat` arguments and yields a minimal `finish` event. Patch the existing chat route dependencies so `_stream_ai_reply` can run with a prepared system message, then assert:

```python
def test_selected_reply_length_is_forwarded_and_added_to_prompt(self):
    events = list(chat_routes._stream_ai_reply(7, stop_event, {"reply_length": "long"}))
    self.assertEqual(fake_client.calls[0]["max_tokens"], 8192)
    self.assertIn("2000", fake_client.calls[0]["messages"][0]["content"])

def test_legacy_chat_metadata_keeps_default_client_call(self):
    list(chat_routes._stream_ai_reply(7, stop_event, {}))
    self.assertIsNone(fake_client.calls[0]["max_tokens"])
```

The test fixture should use the existing `ContextInspection`/`PreparedContext` shapes or a small `SimpleNamespace`, and must patch `repositories.create_message`, `repositories.update_message`, `snapshot_service.autosave`, and the state event dependencies so it does not touch the real database.

- [ ] **Step 2: Run the route-level test and verify it fails for the missing forwarding**

Run:

```powershell
python -m unittest backend.test_chat_reply_length -v
```

Expected: FAIL because `_stream_ai_reply` currently ignores client metadata and calls the client without a per-request length.

- [ ] **Step 3: Implement minimal online forwarding**

Update the generator call chain to pass metadata. Resolve against `config["generation"]["max_tokens"]`, apply the prompt helper to `prepared.messages`, and preserve the legacy no-override call for missing/invalid metadata. Do not alter command handling, SSE event names, or the existing retry implementation in `DeepSeekClient`.

- [ ] **Step 4: Run the focused backend tests**

Run:

```powershell
python -m unittest backend.test_reply_length backend.test_chat_reply_length backend.test_deepseek_reasoning -v
```

Expected: all focused backend tests pass.

- [ ] **Step 5: Commit the online backend integration**

```powershell
git add backend/routers/chat_routes.py backend/test_chat_reply_length.py
git commit -m "feat: forward per-chat reply length to deepseek"
```

---

### Task 3: Add frontend preset and per-conversation storage helpers

**Files:**
- Modify: `frontend/js/main.js` near the existing storage constants and utility functions
- Create: `frontend/test_reply_length.mjs`

**Interfaces:**
- Produces `REPLY_LENGTH_PRESETS`, `DEFAULT_REPLY_LENGTH`, `normalizeReplyLength(value)`, `replyLengthStorageKey(conversationId)`, `loadReplyLength(conversationId, storage=localStorage)`, and `saveReplyLength(conversationId, value, storage=localStorage)`.
- Invalid values normalize to `detailed`; storage failures are caught and use the same default without breaking chat rendering.

- [ ] **Step 1: Write the failing frontend helper tests**

Load `main.js` as text, extract the named pure functions with the same source-extraction pattern used by `frontend/test_reply_templates.mjs`, and assert:

```javascript
test("normalizes known and unknown reply length values", () => {
  assert.equal(normalizeReplyLength("long"), "long");
  assert.equal(normalizeReplyLength("unknown"), "detailed");
  assert.equal(normalizeReplyLength(""), "detailed");
});

test("stores reply length independently for each conversation", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  saveReplyLength(7, "long", storage);
  saveReplyLength(8, "short", storage);
  assert.equal(loadReplyLength(7, storage), "long");
  assert.equal(loadReplyLength(8, storage), "short");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test frontend/test_reply_length.mjs
```

Expected: FAIL because the helpers and preset constants do not exist.

- [ ] **Step 3: Implement the helpers**

Add the four preset definitions, a storage-key prefix, safe normalization, and guarded storage read/write helpers. Keep the helper signatures independent of DOM state so the tests can execute them without a browser.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
node --test frontend/test_reply_length.mjs
```

Expected: all helper tests pass.

- [ ] **Step 5: Commit the frontend helper unit**

```powershell
git add frontend/js/main.js frontend/test_reply_length.mjs
git commit -m "feat: persist reply length per conversation"
```

---

### Task 4: Render the online-only selector and send its metadata

**Files:**
- Modify: `frontend/js/main.js:644-655,1467-1480,1567-1642,1812-1888,1924-1968`
- Modify: `frontend/css/style.css:1016-1035` and the existing mobile chat rules
- Modify: `frontend/test_reply_length.mjs`

**Interfaces:**
- `renderAdventure()` initializes `session.replyLength` only when `MODE === "online"` and renders `#reply-length-select` only in that mode.
- `streamChat(conversationId, content, handlers, metadata={})` sends `{ content, metadata }` online; the offline branch keeps its existing call shape.
- `sendMessage()` passes `{ reply_length: session.replyLength }` only for an online session.
- `setStreamingUi()` disables and re-enables `#reply-length-select` with the other composer controls.

- [ ] **Step 1: Extend the frontend tests before implementation**

Add source-level assertions plus a runtime assertion using the existing `new Function` harness from `frontend/test_context_compression.mjs`. The runtime fixture should add `replyLength: "long"` to its `sessionState`, capture the fourth argument passed to the injected `streamChat`, and assert:

```javascript
test("renders the selector only for online adventure sessions", () => {
  assert.match(renderAdventureSource, /MODE === "online"/);
  assert.match(renderAdventureSource, /id="reply-length-select"/);
  assert.match(renderAdventureSource, /localStorage/);
  assert.match(renderAdventureSource, /replyLength/);
});

assert.deepEqual(receivedMetadata, { reply_length: "long" });
```

Also assert the source contains the selector disabled state in `setStreamingUi`, the four option keys, and the online request body includes `metadata`.

- [ ] **Step 2: Run the frontend test and verify the new assertions fail**

Run:

```powershell
node --test frontend/test_reply_length.mjs
```

Expected: FAIL because the composer has no selector, session has no reply-length state, and the request body omits metadata.

- [ ] **Step 3: Implement the online-only composer control**

Render the labeled select beside the textarea/send button with the four preset options and the persisted value. Bind its `change` handler to normalize, update `session.replyLength`, and save by conversation ID. Hide it completely for Mock/Offline mode.

- [ ] **Step 4: Implement request metadata and streaming UI state**

Extend `streamChat` with an optional metadata argument and serialize it only in the online fetch body. Update `sendMessage` to pass the current session preset, and update `setStreamingUi` to disable/enable the selector. Keep all existing message, SSE, command, and error behavior intact.

- [ ] **Step 5: Add responsive styling**

Add a compact `.reply-length-control` layout that aligns with `.composer-row`, uses the existing `.select` styles, and stacks cleanly on narrow screens. Do not change the visual behavior of Mock/Offline composer controls.

- [ ] **Step 6: Run focused and existing frontend tests**

Run:

```powershell
node --test frontend/test_reply_length.mjs frontend/test_context_compression.mjs frontend/test_reply_templates.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit the chat UI integration**

```powershell
git add frontend/js/main.js frontend/css/style.css frontend/test_reply_length.mjs
git commit -m "feat: add online chat reply length selector"
```

---

### Task 5: Full regression verification

**Files:**
- Modify: none unless a test exposes a regression

- [ ] **Step 1: Run the full backend test suite**

Run:

```powershell
python -m unittest discover -s backend -p "test_*.py" -v
```

Expected: exit code 0 and no failed tests.

- [ ] **Step 2: Run the full frontend test suite**

Run:

```powershell
node --test frontend/*.mjs
```

Expected: exit code 0 and no failed tests.

- [ ] **Step 3: Inspect the final diff and verify scope**

Run:

```powershell
git diff main...HEAD --stat
git status --short
```

Confirm only the intended feature commits contain changes, and preserve unrelated pre-existing worktree modifications.

- [ ] **Step 4: Manually verify the online UI path**

Start the project with the existing launcher, open an online adventure, confirm the selector appears beside the composer, switch to “超长”, send a message, and verify the request contains `metadata.reply_length="long"`. Open a Mock/Offline adventure and confirm the selector is absent.

- [ ] **Step 5: Report evidence**

Record the exact test commands and passing counts in the final response. Do not claim completion without fresh output from both suites.
