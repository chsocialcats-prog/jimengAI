# Agent Handoff Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a root-level `AGENTS.md` that lets a new AI Agent understand, run, test, and safely modify the project.

**Architecture:** Use one concise Markdown file at the repository root. It summarizes stable project facts and points to source files rather than duplicating volatile implementation details; collaboration rules protect the dirty worktree, local secrets, SQLite data, and vendored Live2D assets.

**Tech Stack:** Markdown, Git, PowerShell, Python `unittest`, Node.js test runner

## Global Constraints

- Keep the guide at roughly 80–120 lines and maintain it as the single Agent entry point.
- Do not include any real API key, user data, database content, or exact uncommitted diff.
- Treat current code, Pydantic schemas, routes, and tests as more authoritative than stale project summaries.
- Preserve all existing user changes; stage and commit only files created by this task.
- Keep commands compatible with the repository's Windows PowerShell workflow.

---

### Task 1: Create and verify the root Agent guide

**Files:**
- Create: `AGENTS.md`
- Reference: `README.md`
- Reference: `backend/main.py`
- Reference: `backend/database.py`
- Reference: `backend/routers/chat_routes.py`
- Reference: `frontend/js/main.js`

**Interfaces:**
- Consumes: Current repository structure, startup commands, test commands, and collaboration constraints.
- Produces: Root-level Agent instructions automatically discoverable by compatible coding agents.

- [ ] **Step 1: Record the current worktree before editing**

Run:

```powershell
git status --short
git branch --show-current
```

Expected: branch `codex/ai-adventure-updates`; existing modified and untracked files remain visible and must not be staged by this task.

- [ ] **Step 2: Create `AGENTS.md` with the approved content**

Create exactly these sections and facts:

```markdown
# AGENTS.md

## Project overview

This repository is a local, single-user AI text-adventure application. The UI and product copy are Chinese. It combines reusable works, ordered multi-role cards, keyword-triggered worldbooks, onboarding, streaming story generation, structured state changes, context compression, and save/restore.

When a DeepSeek-compatible API key is configured, chat uses the OpenAI-compatible streaming endpoint. Without a key, the backend provides deterministic mock replies; the frontend also has local demo/mock storage when the backend is unavailable.

## Stack and runtime

- Backend: Python, FastAPI and Uvicorn.
- Database: SQLite at `data/app.db`, initialized and migrated by `backend/database.py`.
- Frontend: plain `frontend/index.html`, `frontend/css/style.css` and `frontend/js/main.js`; there is no build step or package manifest.
- AI: standard-library HTTP client for DeepSeek/OpenAI-compatible `/models` and `/chat/completions` endpoints.
- Streaming: SSE events handled by `backend/routers/chat_routes.py` and `frontend/js/main.js`.
- Tests: Python `unittest` files under `backend/` and Node `node:test` files under `frontend/`.

The application is intentionally single-process. Conversation-generation locks and stop events live in the FastAPI process, so do not run Uvicorn with multiple workers.

## Core data flow

1. A work selects ordered role cards, an optional worldbook, opening text, onboarding fields, player attributes and an optional reply template.
2. Creating a conversation freezes role-card snapshots so later card edits do not rewrite an existing session.
3. The context service builds the prompt from work/card/worldbook data, current state, corrections, recent messages and the long-term memory summary.
4. Chat streams visible prose while `StructuredOutputFilter` removes and parses structured options, state deltas and judge blocks.
5. The backend persists the assistant message, applies state changes, performs automatic context compression when needed, and updates the autosave snapshot.

## Important files

- `start.py`: supported Windows launcher; starts one Uvicorn process and optionally opens the browser.
- `backend/main.py`: FastAPI app, lifespan initialization, error handlers, router registration and frontend mount.
- `backend/schemas.py`: request models and API field names.
- `backend/repositories.py`: SQLite persistence and row normalization.
- `backend/routers/`: configuration, cards, imports, worldbooks, works, conversations and streaming-chat APIs.
- `backend/services/adventure_engine.py`: prompt construction and structured-output parsing.
- `backend/services/context_service.py`: token inspection, memory summarization and context compression.
- `backend/services/state_service.py`: state normalization, merge rules and player-visible change text.
- `backend/services/reply_length.py`: per-turn reply-length presets and limits.
- `backend/ai/deepseek_client.py`: model discovery, real streaming client and mock client.
- `frontend/js/main.js`: hash-routed SPA, API/SSE client, offline data and all page controllers.
- `frontend/css/style.css`: responsive UI and theme styling.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: feature designs and implementation plans.

## Setup and commands

```powershell
python -m pip install -r requirements.txt
python start.py --no-browser
```

Open `http://127.0.0.1:8000`. Use `python start.py` when automatic browser launch is wanted.

Run all backend tests:

```powershell
python -m unittest discover -s backend -p 'test_*.py'
```

Run all frontend tests:

```powershell
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

For narrow changes, run the directly related test file first, then run both complete suites before reporting a cross-layer change as complete. `backend/smoke_test.py` expects a running server and complements rather than replaces the unit suites.

## Source-of-truth rules

- Prefer current code, schemas, routers and tests over `工作总结.md`, `AI对话冒险平台开发计划.md` and `docs/api-contract.md`; those documents contain historical or partially stale descriptions.
- `README.md` is useful for startup basics but may lag newer features such as covers, Live2D, multi-role cards, reply templates and context compression.
- Preserve compatibility fields such as legacy `card_id` alongside ordered `card_ids`; tests document migration behavior.
- Keep API fields in `snake_case`, Chinese user-facing text in UTF-8, the unified `{"error":{"code","message"}}` error shape, and existing SSE event contracts.

## Collaboration rules

- Run `git status --short` before and after work. The worktree may already be dirty; never reset, overwrite, reformat, stage or commit unrelated user changes.
- Make the smallest scoped change. Do not perform unrelated refactors or bulk formatting.
- `config.json` is tracked local configuration and may contain a real API key. Never print, copy, expose or commit its secret value. Prefer the `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` environment variables.
- Never edit or commit `data/app.db`; it is ignored runtime data. Tests should use their existing temporary databases and fixtures.
- Do not casually modify `frontend/vendor/` or bundled Live2D models. If a task explicitly requires it, preserve paths and verify source/licence information in `frontend/vendor/live2d-models/SOURCE.md`.
- Do not change the server to multi-worker operation without redesigning per-conversation exclusivity and stop-event storage.
- When editing a role card, work or conversation model, inspect both online repository behavior and frontend offline/mock migration behavior.
- When changing SSE generation, verify stop handling, exclusivity, partial-message persistence, structured-output filtering, state events and autosave behavior.
- Use `apply_patch` for focused manual edits, preserve CRLF/LF conventions already present, and avoid exposing secrets in command output.
- Do not commit or push unless the user asked for it. If committing is authorized, stage explicit paths only and review the staged diff first.
```

- [ ] **Step 3: Validate structure, secrets, placeholders and whitespace**

Run:

```powershell
(Get-Content -Encoding UTF8 AGENTS.md).Count
rg -n '^## ' AGENTS.md
$blockedPattern = ('TO' + 'DO|TB' + 'D|待' + '定|sk-[A-Za-z0-9]+')
rg -n $blockedPattern AGENTS.md
git diff --check -- AGENTS.md
```

Expected: line count is approximately 80–120; all planned sections are present; the sensitive/placeholder scan prints nothing; `git diff --check` exits successfully.

- [ ] **Step 4: Verify the documented test commands against the current repository**

Run:

```powershell
python -m unittest discover -s backend -p 'test_*.py'
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: Python reports `OK`; Node reports zero failed tests.

- [ ] **Step 5: Review scope and commit only the guide**

Run:

```powershell
git diff -- AGENTS.md
git status --short
git add -- AGENTS.md
git diff --cached --name-only
git commit -m "docs: add agent project guide"
```

Expected: the staged-name list contains only `AGENTS.md`; the pre-existing modified and untracked files remain untouched.
