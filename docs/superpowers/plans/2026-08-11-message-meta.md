# Chat Reply Metadata Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的 AI 回复气泡右下角显示发送时间和去除空白后的当前回复字数，并在流式输出期间保持隐藏。

**Architecture:** 在 `frontend/js/main.js` 增加纯函数 `replyCharacterCount` 和 `messageMetaHtml`，让历史消息通过 `messageHtml` 统一渲染；当前流式消息在 `sendMessage` 的 `onFinish` 确认最终内容后复用同一 HTML 片段。只增加前端展示逻辑，不改变 API、数据库或消息数据结构，时间继续使用已有的 `created_at` 和 `formatTime`。

**Tech Stack:** 原生 JavaScript、现有 HTML 字符串渲染、CSS、Node.js 内置 `node:test`。

## Global Constraints

- 仅 AI 回复显示元信息；用户消息和系统消息不显示字数栏。
- 元信息只在流式回复完成后显示，格式为时间与字数，中间不使用圆点或其他分隔符。
- 时间与字数之间由 CSS `gap` 提供明显间距，字体使用小号、低对比度颜色。
- 字数按 Unicode 字符计算，忽略空格、换行和其他空白字符，中文标点计入。
- 不新增后端字段、不修改 API 协议；历史消息直接使用已有 `created_at`。
- 保留工作区中与本功能无关的未提交修改，提交时不得把它们一并纳入。

---

### Task 1: Add failing coverage for reply metadata

**Files:**
- Create: `frontend/test_message_meta.mjs`
- Read: `frontend/js/main.js`
- Read: `frontend/css/style.css`

**Interfaces:**
- Consumes: `replyCharacterCount(content)` and `messageMetaHtml(message)` to be added in Task 3.
- Produces: Executable regression coverage for counting rules, AI-only rendering, completion timing, and the small spaced footer style.

- [ ] **Step 1: Write the failing test**

Create a Node test module that extracts the two pure helpers from `main.js`, supplies a minimal `formatTime` and `esc` implementation, and checks these exact behaviors:

```js
test("回复字数忽略空白但保留中文标点", () => {
  const { replyCharacterCount } = loadHelpers();
  assert.equal(replyCharacterCount("  你好，\n世界！  "), 6);
  assert.equal(replyCharacterCount("a b\nc"), 3);
});

test("AI 元信息包含时间和字数且不使用圆点分隔", () => {
  const { messageMetaHtml } = loadHelpers();
  const html = messageMetaHtml({
    role: "assistant",
    content: "你好！",
    created_at: "2026-08-11 14:18:00",
  });
  assert.match(html, /class="message-meta"/);
  assert.match(html, /14:18/);
  assert.match(html, /3 字/);
  assert.doesNotMatch(html, /·/);
});

test("消息渲染和流式完成逻辑接入元信息", () => {
  assert.match(mainJs, /messageMetaHtml\(message\)/);
  assert.match(mainJs, /messageMetaHtml\(assistantMessage\)/);
  assert.match(mainJs, /messageText\.closest\("\.message"\).*messageMetaHtml/);
});

test("元信息栏右对齐、间距明显且使用小号字体", () => {
  assert.match(css, /\.message-meta\s*\{[\s\S]*justify-content:\s*flex-end/);
  assert.match(css, /\.message-meta\s*\{[\s\S]*gap:\s*(?:1[2-9]|[2-9][0-9])px/);
  assert.match(css, /\.message-meta\s*\{[\s\S]*font-size:\s*1[01]px/);
});
```

The helper loader must use a source boundary that excludes top-level DOM initialization, matching the existing frontend test style. It must fail before the helpers and CSS rule exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/test_message_meta.mjs`

Expected: FAIL because `replyCharacterCount`, `messageMetaHtml`, and `.message-meta` are not yet defined.

---

### Task 2: Implement pure counting and metadata rendering

**Files:**
- Modify: `frontend/js/main.js` near `messageTextHtml` and `messageHtml`
- Test: `frontend/test_message_meta.mjs`

**Interfaces:**
- Consumes: existing `esc(value)` and `formatTime(value)` helpers; message objects with `role`, `content`, and `created_at`.
- Produces: `replyCharacterCount(content): number` and `messageMetaHtml(message): string`.

- [ ] **Step 1: Write minimal implementation**

Add the following behavior before `messageHtml`:

```js
function replyCharacterCount(content) {
  return Array.from(String(content || ""))
    .filter((char) => !/\s/u.test(char))
    .length;
}

function messageMetaHtml(message) {
  if (message?.role !== "assistant" && message?.role !== "ai") return "";
  if (!message?.created_at || !String(message.content || "").trim()) return "";
  return `<div class="message-meta"><span>${esc(formatTime(message.created_at))}</span><span>${replyCharacterCount(message.content)} 字</span></div>`;
}
```

Keep the existing timestamp formatter and escaping path; do not place a literal dot, bullet, or pipe between the two spans.

- [ ] **Step 2: Run focused tests to verify the helper behavior**

Run: `node --test frontend/test_message_meta.mjs`

Expected: the helper-specific tests pass, while integration assertions may still fail until Task 3 wires the helper into message rendering.

---

### Task 3: Render metadata for historical and newly completed AI messages

**Files:**
- Modify: `frontend/js/main.js` in `messageHtml` and `sendMessage`
- Test: `frontend/test_message_meta.mjs`

**Interfaces:**
- Consumes: `messageMetaHtml(message)` from Task 2, existing `messageOptionsHtml`, and the final accumulated stream text `acc`.
- Produces: historical AI bubbles with metadata and current streaming bubbles with metadata appended only after `onFinish` has final content.

- [ ] **Step 1: Update historical message rendering**

In `messageHtml(message)`, compute metadata only for the AI role and append it after the optional action buttons:

```js
const meta = role === "ai" ? messageMetaHtml(message) : "";
return `<div class="message ${role}" data-message-id="${esc(message.id || "")}"><span class="message-label">${label}</span><span class="message-text">${messageTextHtml(message.content)}</span>${options}${meta}</div>`;
```

- [ ] **Step 2: Update `sendMessage` completion handling**

Inside `onFinish`, construct one `assistantMessage` object with the final `acc`, push that same object into `session.messages`, render the final text, append options if present, and then append `messageMetaHtml(assistantMessage)` to the message element. Do not append metadata from `onDelta`; keep the existing streaming class removal and empty-reply fallback.

- [ ] **Step 3: Run focused tests to verify integration**

Run: `node --test frontend/test_message_meta.mjs`

Expected: all metadata tests pass, including AI-only rendering and completion-only timing.

---

### Task 4: Add the compact, spaced footer style

**Files:**
- Modify: `frontend/css/style.css` after `.message-label`
- Test: `frontend/test_message_meta.mjs`

**Interfaces:**
- Consumes: `.message-meta` markup from Tasks 2–3.
- Produces: a right-aligned, small, muted footer with visibly separated time and character count.

- [ ] **Step 1: Add the minimal CSS rule**

Add:

```css
.message-meta {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 8px;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
}
```

The explicit `font-size` keeps the footer small even where the adventure theme enlarges regular message text. Use the existing muted color token so the footer does not compete with the reply body.

- [ ] **Step 2: Run focused tests to verify styling contracts**

Run: `node --test frontend/test_message_meta.mjs`

Expected: all tests pass, including the no-dot and spacing/font-size assertions.

---

### Task 5: Run full verification and preserve unrelated work

**Files:**
- Verify: `frontend/js/main.js`, `frontend/css/style.css`, `frontend/test_message_meta.mjs`
- Preserve: existing dirty files listed by `git status --short`

- [ ] **Step 1: Run frontend regression tests**

Run: `node --test frontend/*.mjs`

Expected: all frontend tests pass.

- [ ] **Step 2: Run syntax and backend regression checks**

Run: `node --check frontend/js/main.js`

Run: `python -m unittest discover -s backend -p "test_*.py"`

Expected: JavaScript syntax check succeeds and the existing backend suite remains green because no backend code or API contract changed.

- [ ] **Step 3: Inspect the diff and working tree**

Run: `git diff -- frontend/js/main.js frontend/css/style.css frontend/test_message_meta.mjs` and `git status --short`.

Confirm the feature diff contains only the metadata helpers, message integration, footer CSS, and its test; do not stage `config.json`, `frontend/index.html`, `frontend/test_role_card_library.mjs`, `frontend/assets/`, or `frontend/test_neko_branding.mjs`.

- [ ] **Step 4: Commit only isolated feature files when safe**

Because `frontend/css/style.css` is already modified by the user, stage only the new metadata hunk if it can be isolated safely; otherwise leave the CSS change in the working tree and report that it was intentionally not staged. Commit the clean JavaScript and new test changes with:

```bash
git add frontend/js/main.js frontend/test_message_meta.mjs
git commit -m "feat: show reply time and character count"
```

Do not use a broad `git add .` or stage unrelated user work.

## Self-Review Checklist

- [x] Spec coverage: AI-only footer, completed-only timing, historical rendering, Unicode/whitespace counting, no API changes, and compact spaced styling each have an explicit task.
- [x] Placeholder scan: no `TODO`, `TBD`, `待定`, or deferred implementation wording appears in the plan.
- [x] Type consistency: `replyCharacterCount` returns a number; `messageMetaHtml` returns HTML; both are used by `messageHtml` and `sendMessage` exactly as defined.
