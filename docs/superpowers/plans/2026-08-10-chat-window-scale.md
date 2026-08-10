# Chat Window Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge only the adventure chat page on desktop and increase chat-reading/input font sizes while preserving existing behavior and responsive layout.

**Architecture:** Add a final, scoped CSS override using `main#app:has(.adventure-shell)` so the wider container and typography apply only when the adventure chat is rendered. Keep JavaScript, markup, API behavior, sidebar behavior, and non-chat pages unchanged; use the existing mobile breakpoints for a smaller mobile message size.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript frontend; Node.js built-in test runner for existing frontend regression tests; Chromium-based browser for visual QA.

## Global Constraints

- Modify only `frontend/css/style.css`; do not change chat logic or backend code.
- Desktop chat-page container max width: approximately `1400px`.
- Desktop adventure shell height: `calc(100dvh - 108px)`.
- Desktop message text: `17px`; narrow-screen message text: `16px`.
- Keep the status sidebar, single-column mobile layout, quick commands, and composer behavior intact.
- The workspace has no `.git` directory, so do not attempt a commit; report the uncommitted file changes at handoff.

---

### Task 1: Add scoped chat sizing and typography overrides

**Files:**
- Modify: `frontend/css/style.css` (append after the existing dark-theme overrides so these values are final)
- Test: existing `frontend/test_*.mjs` regression suite; manual desktop/mobile browser QA

**Interfaces:**
- Consumes: existing `.adventure-shell`, `.conversation-pane`, `.message`, `.composer`, and responsive breakpoint selectors.
- Produces: a CSS-only adventure-page scale/readability contract with no new runtime API or JavaScript state.

- [x] **Step 1: Run the existing frontend regression baseline**

Run from the workspace root:

```powershell
node --test frontend\*.mjs
```

Expected: the existing frontend tests pass before the stylesheet change; any pre-existing failure must be recorded and not silently attributed to this task.

- [x] **Step 2: Append a desktop-only scoped layout override**

Add this at the end of `frontend/css/style.css`:

```css
@media (min-width: 961px) {
  main#app:has(.adventure-shell) {
    width: min(1400px, 100%);
  }

  main#app:has(.adventure-shell) .adventure-shell {
    height: calc(100dvh - 108px);
  }
}
```

This increases the available desktop chat width and gives the chat shell roughly 16px more vertical space without changing the global application width or the existing mobile single-column rule.

- [x] **Step 3: Append scoped chat typography rules**

Immediately after the layout override, add:

```css
main#app:has(.adventure-shell) .conversation-header-title strong {
  font-size: 16px;
}

main#app:has(.adventure-shell) .conversation-header-title span {
  font-size: 13px;
}

main#app:has(.adventure-shell) .message {
  font-size: 17px;
  line-height: 1.72;
}

main#app:has(.adventure-shell) .message.system {
  font-size: 14px;
}

main#app:has(.adventure-shell) .message-label {
  font-size: 12px;
}

main#app:has(.adventure-shell) .options-label {
  font-size: 13px;
}

main#app:has(.adventure-shell) .option-button,
main#app:has(.adventure-shell) .quick-command {
  font-size: 13px;
}

main#app:has(.adventure-shell) .composer textarea {
  min-height: 52px;
  font-size: 16px;
  line-height: 1.6;
}
```

These rules enlarge the message body and input text while keeping labels and controls subordinate.

- [x] **Step 4: Add the narrow-screen typography adjustment**

Add a final mobile override:

```css
@media (max-width: 720px) {
  main#app:has(.adventure-shell) .message {
    font-size: 16px;
    line-height: 1.68;
  }
}
```

Do not change `.adventure-shell` or `.conversation-pane` mobile sizing; the existing responsive rules already provide the single-column viewport-height chat panel.

- [x] **Step 5: Run the frontend regression suite after the CSS edit**

Run:

```powershell
node --test frontend\*.mjs
```

Expected: the same tests pass, with no JavaScript or markup regressions.

- [x] **Step 6: Perform visual responsive QA**

Start the local app without opening an external browser:

```powershell
python start.py --no-browser
```

Open the local URL and inspect an adventure conversation at a desktop viewport and a narrow mobile viewport. Confirm:

1. Desktop chat panel is wider and slightly taller, while the status sidebar remains fully visible.
2. AI/user message text and the composer input are visibly larger and do not clip.
3. Existing quick commands and send controls remain usable.
4. Mobile layout remains single-column with no horizontal overflow.
5. Browser console has no CSS-related parse error; if `:has()` is unsupported, replace the selector with an equivalent adventure-page class before handoff.

- [x] **Step 7: Inspect the final diff and report workspace state**

Run:

```powershell
git diff -- frontend/css/style.css docs/superpowers/specs/2026-08-10-chat-window-scale-design.md docs/superpowers/plans/2026-08-10-chat-window-scale.md
git status --short
```

Because this workspace is not a Git repository, the commands may report that fact; in that case, use the edited file contents and test output as the handoff evidence and do not claim a commit was created.
