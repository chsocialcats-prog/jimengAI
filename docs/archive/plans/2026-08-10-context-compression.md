# Automatic Context Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compress old adventure-chat context with an AI-generated rolling summary when the estimated prompt plus reserved response tokens reaches the configured budget, while preserving every original message.

**Architecture:** Add a `context_service` that performs a token preflight, maintains a summary coverage boundary, calls the configured AI model for incremental summaries, and falls back to a local summary. The adventure engine only assembles fixed prompt content, saved summary, and a configurable recent-message window; the chat router emits compression status events before starting the normal AI stream.

**Tech Stack:** Python 3.14, FastAPI, SQLite, `unittest`/`pytest`, native browser JavaScript modules, SSE, existing OpenAI-compatible DeepSeek client.

## Global Constraints

- Preserve all rows in `messages`; compression may only change the prompt sent to the model.
- Use the approved defaults: `context_window_tokens=32768`, `compression_trigger_ratio=0.75`, `compression_keep_recent_messages=8`, `compression_summary_max_tokens=1200`.
- The trigger condition is `prompt_tokens + generation.max_tokens >= context_window_tokens * compression_trigger_ratio`.
- Use the configured AI model for summaries when an API Key is available; use a local fallback when it is absent or the summary request fails.
- Do not add a manual compression endpoint or button.
- Keep API Keys out of public configuration responses.
- Do not add third-party dependencies.
- This checkout has no `.git` directory, so use test checkpoints instead of commit steps; do not attempt Git commits.
- Run focused tests after each red/green cycle and the full backend/frontend suites before claiming completion.

---

## File Map

Create:

- `backend/services/context_service.py` — token preflight, incremental AI summary, local fallback, prepared-context result types.
- `backend/test_context_config.py` — default, normalization, and public-config tests for compression settings.
- `backend/test_context_persistence.py` — summary coverage and snapshot restore tests.
- `backend/test_context_service.py` — compression trigger, incremental boundary, AI summary, and fallback tests.
- `frontend/test_context_compression.mjs` — SSE context handling and settings-field source tests.

Modify:

- `backend/config.py` — add and normalize four generation settings.
- `backend/schemas.py` — validate the new generation settings in `ConfigUpdate`.
- `backend/ai/deepseek_client.py` — allow a per-request `max_tokens` override.
- `backend/database.py` — add summary coverage columns to new and existing databases.
- `backend/repositories.py` — read/write summary coverage and include it in snapshot save/restore.
- `backend/services/adventure_engine.py` — stop mutating summaries during assembly; read persisted summaries and support configurable recent windows.
- `backend/routers/chat_routes.py` — call context preflight/compression, use post-compression token counts, and emit `context` SSE events.
- `backend/test_adventure_engine.py` — update summary-assembly expectations and chat-stream patches.
- `backend/test_deepseek_reasoning.py` — cover the per-request token override.
- `frontend/js/main.js` — expose compression settings, dispatch `context` SSE events, and show status text.

---

### Task 1: Add and validate context-compression configuration

**Files:**
- Create: `backend/test_context_config.py`
- Modify: `backend/config.py`
- Modify: `backend/schemas.py`

**Interfaces:**
- Produces `config.DEFAULT_CONFIG["generation"]` fields:
  `context_window_tokens`, `compression_trigger_ratio`,
  `compression_keep_recent_messages`, `compression_summary_max_tokens`.
- Produces `config.normalize_generation_config(generation) -> dict`.
- `ConfigUpdate.generation` accepts the four fields with the bounds in the design.

- [ ] **Step 1: Write the failing tests for defaults and bounds**

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config as config_module


class ContextConfigTests(unittest.TestCase):
    def test_load_config_adds_context_compression_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text('{"generation": {"max_tokens": 512}}', encoding="utf-8")
            with patch.object(config_module, "CONFIG_PATH", path):
                generation = config_module.load_config()["generation"]

        self.assertEqual(generation["context_window_tokens"], 32768)
        self.assertEqual(generation["compression_trigger_ratio"], 0.75)
        self.assertEqual(generation["compression_keep_recent_messages"], 8)
        self.assertEqual(generation["compression_summary_max_tokens"], 1200)

    def test_invalid_context_values_are_replaced_with_safe_defaults(self):
        normalized = config_module.normalize_generation_config({
            "context_window_tokens": 1,
            "compression_trigger_ratio": 2,
            "compression_keep_recent_messages": 0,
            "compression_summary_max_tokens": 999999,
        })

        self.assertEqual(normalized["context_window_tokens"], 32768)
        self.assertEqual(normalized["compression_trigger_ratio"], 0.75)
        self.assertEqual(normalized["compression_keep_recent_messages"], 8)
        self.assertEqual(normalized["compression_summary_max_tokens"], 1200)

    def test_public_config_includes_context_settings_without_api_key(self):
        public = config_module.public_config({
            "deepseek": {"api_key": "secret"},
            "generation": {"context_window_tokens": 4096},
        })

        self.assertNotIn("api_key", public["deepseek"])
        self.assertEqual(public["generation"]["context_window_tokens"], 4096)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `python -m pytest backend\test_context_config.py -q`

Expected: FAIL because the new defaults and `normalize_generation_config` do not exist.

- [ ] **Step 3: Implement the minimal configuration contract**

In `backend/config.py`, extend `DEFAULT_CONFIG` and add normalization that starts from the four approved defaults, copies valid values, and replaces invalid values with defaults. Call it after the deep merge in `load_config()`, `update_config()`, and `public_config()` so callers that pass a partial config still receive a complete public generation block.

In `backend/schemas.py`, add a `GenerationUpdate` model with bounded optional fields and change `ConfigUpdate.generation` from `Optional[dict]` to `Optional[GenerationUpdate]`. Keep existing temperature, max-token, and reasoning fields compatible with current requests.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `python -m pytest backend\test_context_config.py backend\test_deepseek_reasoning.py -q`

Expected: PASS, including the existing reasoning-effort configuration tests.

- [ ] **Step 5: Checkpoint the task**

Record the passing test command in the work log; do not commit because this workspace has no Git metadata.

---

### Task 2: Allow summary requests to use a separate output budget

**Files:**
- Modify: `backend/ai/deepseek_client.py`
- Modify: `backend/test_deepseek_reasoning.py`

**Interfaces:**
- `DeepSeekClient.stream_chat(messages, max_tokens=None)` uses the override when provided and keeps configured `generation.max_tokens` otherwise.
- `DeepSeekClient._stream_once(messages, include_usage, max_tokens=None)` forwards the selected value in the request payload.
- `MockDeepSeekClient.stream_chat(messages, max_tokens=None)` accepts the same call shape.

- [ ] **Step 1: Add the failing payload test**

Add this test to `DeepSeekReasoningPayloadTests`:

```python
    def test_per_request_max_tokens_override_is_forwarded(self):
        captured = []

        def capture_request(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return _StreamingResponse()

        client = deepseek_client.DeepSeekClient(_client_config("off"))
        with patch.object(
            deepseek_client.urllib.request,
            "urlopen",
            side_effect=capture_request,
        ):
            list(client._stream_once(
                [{"role": "user", "content": "summary"}],
                False,
                max_tokens=1200,
            ))

        self.assertEqual(captured[0]["max_tokens"], 1200)
```

- [ ] **Step 2: Run the test and verify it fails for the missing keyword**

Run: `python -m pytest backend\test_deepseek_reasoning.py::DeepSeekReasoningPayloadTests::test_per_request_max_tokens_override_is_forwarded -q`

Expected: FAIL because `_stream_once` does not accept `max_tokens`.

- [ ] **Step 3: Implement the override without changing normal requests**

Thread `max_tokens=None` through `stream_chat()` and `_stream_once()`. Build the payload with `self.max_tokens` when the override is `None`, otherwise use the integer override. Update the mock client signature and ignore the optional value.

- [ ] **Step 4: Run the focused client tests**

Run: `python -m pytest backend\test_deepseek_reasoning.py -q`

Expected: PASS for the override and all existing reasoning payload cases.

- [ ] **Step 5: Checkpoint the task**

Record the passing focused test command; do not commit.

---

### Task 3: Persist summary coverage and snapshot boundaries

**Files:**
- Create: `backend/test_context_persistence.py`
- Modify: `backend/database.py`
- Modify: `backend/repositories.py`

**Interfaces:**
- `repositories.get_memory_summary_record(conversation_id) -> dict` returns `summary`, integer `covered_until_sequence`, and `updated_at`, defaulting to an empty summary and `-1`.
- `repositories.get_memory_summary(conversation_id) -> str` remains compatible and returns only the summary text.
- `repositories.save_memory_summary(conversation_id, summary, covered_until_sequence=-1) -> None` persists both values.
- Private snapshots include `memory_summary_covered_until_sequence`; public snapshot listings continue hiding private message and summary data.

- [ ] **Step 1: Write failing persistence and restore tests**

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import database, repositories


class ContextPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(
            database,
            "DB_PATH",
            Path(self.tempdir.name) / "context.db",
        )
        self.db_patch.start()
        database.init_db()
        work = repositories.create_work({"title": "Context work"})
        self.conversation = repositories.create_conversation(
            work["id"], "Context conversation"
        )

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_summary_round_trip_includes_coverage_sequence(self):
        conversation_id = self.conversation["id"]
        repositories.save_memory_summary(conversation_id, "old events", 4)

        record = repositories.get_memory_summary_record(conversation_id)

        self.assertEqual(record["summary"], "old events")
        self.assertEqual(record["covered_until_sequence"], 4)
        self.assertEqual(
            repositories.get_memory_summary(conversation_id),
            "old events",
        )

    def test_snapshot_restore_restores_summary_coverage(self):
        conversation_id = self.conversation["id"]
        repositories.save_memory_summary(conversation_id, "before branch", 2)
        snapshot = repositories.create_snapshot(
            conversation_id,
            name="Before compression branch",
        )
        repositories.save_memory_summary(conversation_id, "after branch", 7)

        repositories.restore_snapshot(conversation_id, snapshot["id"])

        record = repositories.get_memory_summary_record(conversation_id)
        self.assertEqual(record["summary"], "before branch")
        self.assertEqual(record["covered_until_sequence"], 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `python -m pytest backend\test_context_persistence.py -q`

Expected: FAIL because the coverage columns and repository record method do not exist.

- [ ] **Step 3: Add the schema columns and migrations**

Add `covered_until_sequence INTEGER NOT NULL DEFAULT -1` to `memory_summaries` and `memory_summary_covered_until_sequence INTEGER NOT NULL DEFAULT -1` to `snapshots` in `SCHEMA`. Add matching `_ensure_column()` calls in `init_db()` so existing `data/app.db` files receive both columns without data loss.

- [ ] **Step 4: Implement repository read/write and snapshot propagation**

Update `get_memory_summary`, add `get_memory_summary_record`, and extend `save_memory_summary` to update/insert the boundary. Update `create_snapshot()` to select the summary boundary and write it for both manual and autosave paths. Update `row_to_snapshot()` private handling and `restore_snapshot()` to restore the summary plus boundary in one SQLite transaction.

- [ ] **Step 5: Run persistence and existing onboarding tests**

Run: `python -m pytest backend\test_context_persistence.py backend\test_onboarding.py -q`

Expected: PASS, with old databases still initializing successfully.

- [ ] **Step 6: Checkpoint the task**

Record the passing persistence test command; do not commit.

---

### Task 4: Make adventure-engine assembly read-only and summary-aware

**Files:**
- Modify: `backend/services/adventure_engine.py`
- Modify: `backend/test_adventure_engine.py`

**Interfaces:**
- `adventure_engine.build_messages(conversation_id, recent_count=8, summary_override=None) -> list[dict]` never writes a summary.
- `adventure_engine.build_local_memory_summary(messages, keep_recent, max_chars) -> tuple[str, int]` returns local summary text and the last archived message sequence.
- Existing prompt sections, worldbook matching, corrections, state JSON, and structured-output instructions remain unchanged.

- [ ] **Step 1: Replace the old summary-refresh test with a failing read-only assembly test**

Add/replace the memory-summary test with:

```python
    def test_build_messages_uses_saved_summary_without_writing(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(10)
        ]
        conversation = {
            "id": 7,
            "work_id": None,
            "card_id": None,
            "worldbook_id": None,
        }
        state = {
            "attributes": {}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        with patch.object(
            adventure_engine.repositories,
            "get_conversation",
            return_value=conversation,
        ), patch.object(
            adventure_engine.repositories,
            "get_state",
            return_value=state,
        ), patch.object(
            adventure_engine.repositories,
            "get_messages",
            return_value=history,
        ), patch.object(
            adventure_engine.repositories,
            "get_memory_summary_record",
            return_value={
                "summary": "saved summary",
                "covered_until_sequence": 1,
            },
        ), patch.object(
            adventure_engine.repositories,
            "save_memory_summary",
        ) as save_summary:
            messages = adventure_engine.build_messages(7, recent_count=8)

        self.assertIn("saved summary", messages[0]["content"])
        self.assertNotIn("message-0", messages[1]["content"])
        self.assertEqual(
            [message["content"] for message in messages[1:]],
            [f"message-{index}" for index in range(2, 10)],
        )
        save_summary.assert_not_called()
```

- [ ] **Step 2: Run the focused test and verify it fails because build_messages rewrites summaries**

Run: `python -m pytest backend\test_adventure_engine.py -q`

Expected: FAIL in the new summary-assembly assertion until `build_messages()` reads the persisted summary record without calling the old refresh path.

- [ ] **Step 3: Implement read-only message assembly**

Normalize `recent_count` to at least 1 without the current hard maximum of 8. Read `get_memory_summary_record()` when `summary_override` is not provided. Use the record’s `summary` in `build_system_prompt()`, append only the last `recent_count` user/assistant messages, and do not call `save_memory_summary()`.

- [ ] **Step 4: Extract the local summary formatter for the fallback service**

Move the old line-based formatting into `build_local_memory_summary()`. It must filter to user/assistant messages, keep the last `keep_recent` out of the archive, truncate each source message to 120 characters, cap the final text by `max_chars`, and return the archived messages’ last `sequence` as the coverage boundary. Keep `update_memory_summary()` only as a compatibility wrapper if existing tests require it; no chat path may call it after a successful AI reply.

- [ ] **Step 5: Run the engine tests and verify no prompt sections regressed**

Run: `python -m pytest backend\test_adventure_engine.py -q`

Expected: PASS for worldbook matching, state instructions, visible fallbacks, and the new non-overlapping summary assembly.

- [ ] **Step 6: Checkpoint the task**

Record the focused test result; do not commit.

---

### Task 5: Implement token preflight, AI rolling summaries, and local fallback

**Files:**
- Create: `backend/services/context_service.py`
- Create: `backend/test_context_service.py`

**Interfaces:**
- `ContextInspection` fields: `messages`, `prompt_tokens`, `trigger_limit`, `needs_compression`.
- `PreparedContext` fields: `messages`, `prompt_tokens_before`, `prompt_tokens_after`, `compressed`, `method`, `covered_until_sequence`.
- `inspect_context(conversation_id, config) -> ContextInspection` performs the no-write token preflight.
- `prepare_context(conversation_id, config, inspection=None) -> PreparedContext` performs only the needed compression and returns the final prompt.
- `method` is `None`, `"ai"`, or `"local"`.

- [ ] **Step 1: Write the failing preflight and compression tests**

Create a small fake client and controlled message builders so the tests never call the network:

```python
import unittest
from unittest.mock import patch

from backend.services import context_service


class FakeSummaryClient:
    def __init__(self, text="AI summary"):
        self.text = text
        self.calls = []

    def stream_chat(self, messages, max_tokens=None):
        self.calls.append((messages, max_tokens))
        yield {"type": "delta", "content": self.text}


class ContextServiceTests(unittest.TestCase):
    def config(self):
        return {
            "deepseek": {"api_key": "key", "model": "test-model"},
            "generation": {
                "max_tokens": 8,
                "context_window_tokens": 80,
                "compression_trigger_ratio": 0.75,
                "compression_keep_recent_messages": 2,
                "compression_summary_max_tokens": 12,
            },
        }

    def test_inspect_context_does_not_compress_below_threshold(self):
        with patch.object(
            context_service.adventure_engine,
            "build_messages",
            return_value=[{"role": "system", "content": "small"}],
        ), patch.object(
            context_service,
            "estimate_messages_tokens",
            return_value=10,
        ):
            inspection = context_service.inspect_context(7, self.config())

        self.assertFalse(inspection.needs_compression)
        self.assertEqual(inspection.prompt_tokens, 10)

    def test_prepare_context_uses_ai_summary_and_saves_new_boundary(self):
        history = [
            {"sequence": index, "role": "user", "content": f"old-{index}"}
            for index in range(5)
        ]
        fake_client = FakeSummaryClient()
        inspection = context_service.ContextInspection(
            messages=[{"role": "system", "content": "large"}],
            prompt_tokens=100,
            trigger_limit=60,
            needs_compression=True,
        )
        with patch.object(
            context_service.repositories,
            "get_messages",
            return_value=history,
        ), patch.object(
            context_service.repositories,
            "get_memory_summary_record",
            return_value={"summary": "prior", "covered_until_sequence": 0},
        ), patch.object(
            context_service.repositories,
            "save_memory_summary",
        ) as save_summary, patch.object(
            context_service,
            "create_client",
            return_value=fake_client,
        ), patch.object(
            context_service.adventure_engine,
            "build_messages",
            return_value=[{"role": "system", "content": "compressed"}],
        ):
            result = context_service.prepare_context(
                7, self.config(), inspection=inspection
            )

        self.assertTrue(result.compressed)
        self.assertEqual(result.method, "ai")
        self.assertEqual(fake_client.calls[0][1], 12)
        save_summary.assert_called_once_with(7, "AI summary", 2)

    def test_ai_summary_failure_falls_back_to_local_summary(self):
        history = [
            {"sequence": index, "role": "user", "content": f"old-{index}"}
            for index in range(5)
        ]
        inspection = context_service.ContextInspection(
            messages=[{"role": "system", "content": "large"}],
            prompt_tokens=100,
            trigger_limit=60,
            needs_compression=True,
        )
        with patch.object(context_service.repositories, "get_messages", return_value=history), \
             patch.object(context_service.repositories, "get_memory_summary_record", return_value={"summary": "", "covered_until_sequence": -1}), \
             patch.object(context_service, "create_client", side_effect=RuntimeError("offline")), \
             patch.object(context_service.repositories, "save_memory_summary") as save_summary, \
             patch.object(context_service.adventure_engine, "build_messages", return_value=[{"role": "system", "content": "fallback"}]):
            result = context_service.prepare_context(7, self.config(), inspection=inspection)

        self.assertTrue(result.compressed)
        self.assertEqual(result.method, "local")
        self.assertTrue(save_summary.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify the missing-service failure**

Run: `python -m pytest backend\test_context_service.py -q`

Expected: FAIL because `context_service` and its result types do not exist.

- [ ] **Step 3: Implement the no-write preflight**

Read normalized `generation` settings, call `adventure_engine.build_messages()` with the configured recent window, estimate tokens, compute `trigger_limit`, and return `ContextInspection`. Do not write summaries in this function.

- [ ] **Step 4: Implement incremental archive selection and AI summary generation**

Load the full history and summary record. Filter archive candidates to user/assistant messages, keep the configured recent window, and select only messages with `sequence > covered_until_sequence` before the recent window cutoff. Build a summarizer prompt containing the previous summary and a clearly delimited transcript. Call `create_client(config).stream_chat(summary_messages, max_tokens=compression_summary_max_tokens)` and concatenate only `delta` content.

Accept a non-empty summary only when its estimated token count is within the configured summary budget. Save it with the cutoff sequence using `repositories.save_memory_summary()`.

- [ ] **Step 5: Implement local fallback and final-window shrinking**

On missing API Key, client errors, empty output, over-budget output, or oversized source material, call `adventure_engine.build_local_memory_summary()`. Rebuild the final prompt with the saved summary. If it still exceeds the trigger limit, cap the summary and reduce the recent window one step at a time down to 2. Return `PreparedContext` with before/after counts and the selected method.

- [ ] **Step 6: Run focused tests and add the incremental-boundary regression**

Run: `python -m pytest backend\test_context_service.py -q`

Expected: PASS for below-threshold no-op, AI summary, coverage boundary, and local fallback. Add a test that asserts the fake summarizer prompt contains `old-2` but not `old-0` when the saved boundary is 0, then rerun the same command.

- [ ] **Step 7: Checkpoint the task**

Record the passing context-service test command; do not commit.

---

### Task 6: Integrate prepared context into the chat stream and SSE

**Files:**
- Modify: `backend/routers/chat_routes.py`
- Modify: `backend/test_adventure_engine.py`

**Interfaces:**
- `_stream_ai_reply()` obtains `ContextInspection` and `PreparedContext` before the main `create_client(config).stream_chat()` call.
- New SSE event: `context`, with `status="compressing"` before the summary request and `status="compressed"` or `status="fallback"` afterward.
- Main prompt token usage starts from `PreparedContext.prompt_tokens_after` and is replaced by provider usage when available.

- [ ] **Step 1: Add the failing stream integration assertion**

Import `context_service` at the top of `backend/test_adventure_engine.py`, place the following method in `VisibleStateDeltaFallbackTests`, and use `context_service.ContextInspection` and `PreparedContext`:

```python
    def test_stream_ai_reply_emits_context_events_for_compression(self):
        prepared = context_service.PreparedContext(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens_before=100,
            prompt_tokens_after=20,
            compressed=True,
            method="ai",
            covered_until_sequence=4,
        )
        class ReplyClient:
            def stream_chat(self, _messages, max_tokens=None):
                yield {"type": "delta", "content": "reply"}

        with patch.object(chat_routes, "load_config", return_value={
            "deepseek": {"api_key": "key", "model": "test-model"},
            "generation": {"max_tokens": 16},
        }), patch.object(
            chat_routes.context_service,
            "inspect_context",
            return_value=context_service.ContextInspection(
                messages=[], prompt_tokens=100, trigger_limit=60,
                needs_compression=True,
            ),
        ), patch.object(
            chat_routes.context_service,
            "prepare_context",
            return_value=prepared,
        ), patch.object(chat_routes, "create_client", return_value=ReplyClient()), \
             patch.object(chat_routes.repositories, "create_message", return_value={"id": 17}), \
             patch.object(chat_routes.repositories, "update_message"), \
             patch.object(chat_routes.repositories, "get_message", return_value={"metadata": {"status": "done"}}), \
             patch.object(chat_routes.state_service, "get_state", return_value={"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": [], "characters": [], "logs": []}), \
             patch.object(chat_routes.snapshot_service, "autosave"):
            events = list(chat_routes._stream_ai_reply(99, threading.Event()))

        joined = "".join(events)
        self.assertIn('event: context', joined)
        self.assertIn('"status":"compressing"', joined)
        self.assertIn('"status":"compressed"', joined)
        self.assertIn('"method":"ai"', joined)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `python -m pytest backend\test_adventure_engine.py::VisibleStateDeltaFallbackTests::test_stream_ai_reply_emits_context_events_for_compression -q`

Expected: FAIL because the chat router does not call `context_service` or emit `context` events.

- [ ] **Step 3: Integrate preflight and prepared context**

Import `context_service`. In `_stream_ai_reply()`, load config, call `inspect_context()`, emit `context/compressing` only when `needs_compression` is true, then call `prepare_context(..., inspection=inspection)`. When `prepared.compressed` is true, emit the final `context` event with `before_tokens`, `after_tokens`, and `method`. Use `prepared.messages` for the main AI request.

- [ ] **Step 4: Preserve existing stream behavior and remove unconditional summary overwrite**

Keep the existing structured-output filter, state delta, judge, options, stop handling, autosave, and error events. Initialize `prompt_tokens` from `prepared.prompt_tokens_after`. Remove the unconditional `adventure_engine.update_memory_summary(conversation_id)` after assistant-message persistence. Update existing stream tests to patch `context_service.inspect_context`/`prepare_context` instead of the old summary refresh call.

- [ ] **Step 5: Run chat and full backend tests**

Run: `python -m pytest backend\test_adventure_engine.py backend\test_chat_exclusivity.py -q`

Expected: PASS, including no duplicate chat streams and the new context event order. Then run `python -m pytest -q` and resolve any regression before continuing.

- [ ] **Step 6: Checkpoint the task**

Record the passing backend suite; do not commit.

---

### Task 7: Add settings controls and frontend context status handling

**Files:**
- Create: `frontend/test_context_compression.mjs`
- Modify: `frontend/js/main.js`

**Interfaces:**
- `streamChat()` dispatches `event: context` through `handlers.onContext(data)`.
- Settings page renders `cfg-context-window`, `cfg-compression-ratio`, `cfg-compression-keep-recent`, and `cfg-compression-summary-tokens`.
- Settings save payload writes the four fields under `generation` in both online and offline modes.

- [ ] **Step 1: Write failing source-level frontend tests**

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("stream chat dispatches automatic context compression events", () => {
  assert.match(source, /eventName === "context"/);
  assert.match(source, /handlers\.onContext\?\.\(data\)/);
  assert.match(source, /正在整理上下文/);
  assert.match(source, /上下文已自动压缩/);
});

test("settings page exposes and saves context compression controls", () => {
  assert.match(source, /cfg-context-window/);
  assert.match(source, /cfg-compression-ratio/);
  assert.match(source, /cfg-compression-keep-recent/);
  assert.match(source, /cfg-compression-summary-tokens/);
  assert.match(source, /context_window_tokens/);
  assert.match(source, /compression_trigger_ratio/);
  assert.match(source, /compression_keep_recent_messages/);
  assert.match(source, /compression_summary_max_tokens/);
});
```

- [ ] **Step 2: Run the focused frontend tests and verify they fail**

Run: `node --test frontend\test_context_compression.mjs`

Expected: FAIL because the event branch, status text, controls, and save fields do not exist.

- [ ] **Step 3: Implement SSE dispatch and adventure-page status handling**

In `streamChat()`, add the `context` branch alongside `meta`, `delta`, `state`, `done`, and `error`. In `sendMessage()`, add `onContext` that sets the conversation header to “正在整理上下文” while compressing and “上下文已自动压缩” for a completed AI/local compression; `setStreamingUi(false)` remains responsible for restoring the normal message-count text.

- [ ] **Step 4: Add settings controls with approved defaults and bounds**

Extend the settings fallback object and rendered form with the four IDs and the exact ranges: context window 2048–131072, ratio 0.50–0.95, recent messages 2–32, summary tokens 256–4096. Read current values from `/api/config` and local mock settings.

- [ ] **Step 5: Include the four fields in the save payload**

Read the four controls in the existing save handler and place them under `body.generation`. Keep API Key draft behavior unchanged; when the key input is blank, do not send an empty key over a saved key.

- [ ] **Step 6: Run all frontend tests**

Run: `node --test frontend\*.mjs`

Expected: PASS for the new context tests and all existing UI source tests.

- [ ] **Step 7: Checkpoint the task**

Record the passing frontend suite; do not commit.

---

### Task 8: Final verification and regression audit

**Files:**
- Modify only files required by failing tests found during verification; do not broaden the feature scope.

- [ ] **Step 1: Run the complete backend suite**

Run: `python -m pytest -q`

Expected: all backend tests pass with no new errors. Existing deprecation warnings from FastAPI may remain, but there must be no new warning or traceback introduced by context compression.

- [ ] **Step 2: Run the complete frontend suite**

Run: `node --test frontend\*.mjs`

Expected: all frontend tests pass.

- [ ] **Step 3: Run the application smoke test**

Run: `python backend\smoke_test.py`

Expected: the local API starts/responds successfully without requiring a live AI request.

- [ ] **Step 4: Exercise the automatic path with a temporary test configuration**

Use a temporary database/config in a test or one-off Python harness, set `context_window_tokens` to a small value such as `80`, create enough user/assistant messages to cross the threshold, and assert:

```python
assert prepared.compressed is True
assert prepared.prompt_tokens_after < prepared.prompt_tokens_before
assert len(repositories.get_messages(conversation_id)) == original_message_count
```

Do not send a request to the real configured API during verification.

- [ ] **Step 5: Inspect the final diff and sensitive files**

Run: `Get-ChildItem -Recurse -File backend,frontend,docs\superpowers\plans | Select-Object FullName` and inspect only the planned files. Confirm no API Key is copied into tests, logs, SSE payloads, or documentation.

- [ ] **Step 6: Report completion with evidence**

Report the implemented files, the exact backend/frontend test commands and results, the fallback behavior, and the fact that this checkout has no Git metadata so no commit was created.
