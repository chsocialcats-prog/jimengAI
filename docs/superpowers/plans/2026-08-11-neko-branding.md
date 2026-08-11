# NEKO Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the website’s top-left compass brand with the supplied cat icon and a designed `NEKO` wordmark, while keeping all navigation and adventure behavior unchanged.

**Architecture:** Keep the existing static HTML/CSS architecture. The brand remains a single anchor in `frontend/index.html`; the icon becomes a transparent, tightly cropped static PNG under `frontend/assets/`, and the wordmark is styled locally in `frontend/css/style.css` with a system-font stack and responsive sizes. A focused Node test protects the exact title, markup, asset path, and removal of the old brand nodes.

**Tech Stack:** HTML, CSS, PNG asset, Node.js built-in `node:test` and `node:fs`.

## Global Constraints

- Do not modify navigation names, page routes, business logic, or data structures.
- Remove the old compass icon and the old `AI 对话冒险` brand text from the top-left brand area.
- Set the browser title to `NEKO · AI 对话冒险`.
- Do not rename “AI 对话冒险” in work covers, page descriptions, or Live2D welcome copy; those strings are not the top-left brand.
- Do not add an external font dependency; use a local system font stack.
- Preserve the existing `.brand` link target, accessibility label, theme behavior, and responsive navigation.
- Do not modify unrelated uncommitted work already present in the worktree.

---

## File Map

- Create: `frontend/assets/neko-icon.png` — transparent, tightly cropped web asset derived from the user-supplied cat icon.
- Create: `frontend/test_neko_branding.mjs` — static contract test for the brand markup, title, CSS hooks, and asset presence.
- Modify: `frontend/index.html` — replace the old compass span and old brand text; update `<title>`.
- Modify: `frontend/css/style.css` — remove unused `.brand-mark` rules and add `.brand-logo`/`.brand-text` styling plus responsive/theme-safe sizing.

## Task 1: Define the NEKO brand contract with a failing test

**Files:**
- Create: `frontend/test_neko_branding.mjs`

**Interfaces:**
- Consumes: `frontend/index.html`, `frontend/css/style.css`, and the relative asset path `assets/neko-icon.png`.
- Produces: a repeatable `node --test` contract that later implementation steps must satisfy.

- [ ] **Step 1: Write the failing static test**

Create `frontend/test_neko_branding.mjs` with this exact content:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
const iconPath = new URL("./assets/neko-icon.png", import.meta.url);

test("top-left brand uses the NEKO icon and wordmark", () => {
  assert.match(indexSource, /<title>NEKO · AI 对话冒险<\/title>/);
  assert.match(indexSource, /<img class="brand-logo" src="assets\/neko-icon\.png" alt="">/);
  assert.match(indexSource, /<span class="brand-text">NEKO<\/span>/);
  assert.doesNotMatch(indexSource, /data-icon="compass"/);
  assert.doesNotMatch(indexSource, /<span class="brand-text">AI 对话冒险<\/span>/);
});

test("NEKO brand styles and transparent asset hook exist", () => {
  assert.match(cssSource, /\.brand-logo\s*\{/);
  assert.match(cssSource, /\.brand-text\s*\{/);
  assert.match(cssSource, /letter-spacing:\s*0\.1[26]em/);
  assert.doesNotMatch(cssSource, /\.brand-mark\s*\{/);
  assert.equal(existsSync(iconPath), true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the old brand**

Run:

```powershell
node --test frontend/test_neko_branding.mjs
```

Expected: FAIL because `frontend/index.html` still contains `data-icon="compass"` and the old brand text, the new CSS hooks do not exist, and `frontend/assets/neko-icon.png` does not exist yet.

- [ ] **Step 3: Commit the test contract**

```powershell
git add -- frontend/test_neko_branding.mjs
git commit -m "test: define NEKO branding contract"
```

## Task 2: Add the web-ready cat asset and replace the brand markup

**Files:**
- Create: `frontend/assets/neko-icon.png`
- Modify: `frontend/index.html:7,13-16`

**Interfaces:**
- Consumes: `C:\Users\Admin\Desktop\exec-1b165b2b-835e-47f7-af9d-edab2a4e395f.png` as the source image.
- Produces: a static browser-loadable asset at `assets/neko-icon.png` and brand markup consumed by the CSS and test from Task 1.

- [ ] **Step 1: Generate the transparent, tightly cropped asset**

Use the image-editing tool in referenced-image mode with the source path above and this exact instruction:

> Remove the baked white/light-gray checkerboard background from this exact cat icon and output a transparent PNG. Preserve the purple-to-pink cat artwork, ears, closed eyes, cheeks, mouth, and tail exactly; do not redesign the character, add text, add a border, or add a new background. Tightly crop the canvas to the visible cat with 8px transparent padding on every side, keeping a square canvas.

Save the resulting PNG as `frontend/assets/neko-icon.png`. Verify visually that no checkerboard remains and that the ears and tail are fully inside the transparent canvas.

- [ ] **Step 2: Replace the document title and old brand nodes**

In `frontend/index.html`, change only the title and `.brand` contents to the following shape:

```html
<title>NEKO · AI 对话冒险</title>
...
<a class="brand" href="#/" aria-label="返回作品库">
  <img class="brand-logo" src="assets/neko-icon.png" alt="">
  <span class="brand-text">NEKO</span>
</a>
```

Do not change the surrounding navigation, mode badge, theme button, script tags, or anchor target.

- [ ] **Step 3: Confirm the implementation is still isolated**

Run:

```powershell
git diff -- frontend/index.html
git status --short
```

Expected: the diff contains only the `<title>` and the top-left `.brand` markup; existing unrelated modified files remain unstaged and untouched.

## Task 3: Style the new icon and designed wordmark

**Files:**
- Modify: `frontend/css/style.css:156-181,1641-1644,1749-1752,1844-1852,2096-2097`

**Interfaces:**
- Consumes: `.brand-logo` and `.brand-text` elements from Task 2.
- Produces: theme-compatible brand styling at desktop, 720px, and 420px breakpoints.

- [ ] **Step 1: Remove the old compass-specific CSS hooks**

Delete the existing `.brand-mark` and `.brand-mark svg.icon` blocks, including their later mobile and light-workbench overrides. Do not remove the `.brand` anchor rule or any generic `.icon` rule used elsewhere.

- [ ] **Step 2: Add the base brand image and wordmark styles**

Place the following rules alongside the existing `.brand` rule in the base stylesheet:

```css
.brand-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  object-fit: contain;
  filter: drop-shadow(0 6px 12px rgba(128, 105, 221, 0.16));
}

.brand-text {
  color: var(--accent-strong);
  font-family: "Avenir Next", "Montserrat", "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.16em;
  line-height: 1;
  text-transform: uppercase;
}
```

The font stack must remain local-only. `var(--accent-strong)` keeps the wordmark tied to the existing light/dark theme palettes without adding a network font.

- [ ] **Step 3: Add responsive sizes without changing layout rules**

Inside the existing `@media (max-width: 720px)` block, use:

```css
.brand-logo {
  width: 30px;
  height: 30px;
  flex-basis: 30px;
}

.brand-text {
  font-size: 15px;
  letter-spacing: 0.12em;
}
```

Inside the existing `@media (max-width: 420px)` block, use:

```css
.brand-logo {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
}
```

Keep the existing `.topbar`, `.nav-links`, `.top-actions`, and focus styles unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
node --test frontend/test_neko_branding.mjs
```

Expected: PASS for both tests.

- [ ] **Step 5: Commit the brand implementation**

```powershell
git add -- frontend/assets/neko-icon.png frontend/index.html frontend/css/style.css
git commit -m "feat: replace header branding with NEKO"
```

## Task 4: Verify responsive, theme, asset, and regression behavior

**Files:**
- Test: `frontend/test_neko_branding.mjs`
- Verify: `frontend/index.html`, `frontend/css/style.css`, `frontend/assets/neko-icon.png`

**Interfaces:**
- Consumes: the completed NEKO brand implementation from Tasks 2–3.
- Produces: evidence that the replacement is visually usable and does not regress existing frontend tests.

- [ ] **Step 1: Run the focused and existing frontend test suites**

Run each command separately:

```powershell
node --test frontend/test_neko_branding.mjs
node --test frontend/test_adventure_header.mjs
node --test frontend/test_work_cover.mjs
node --test frontend/test_live2d_widget.mjs
node --test frontend/test_status_sidebar_toggle.mjs
node --test frontend/test_inline_story_options.mjs
node --test frontend/test_state_change_colors.mjs
```

Expected: every command exits 0 with no failures.

- [ ] **Step 2: Confirm the old brand is absent only where required**

Run:

```powershell
rg -n 'data-icon="compass"|<span class="brand-text">AI 对话冒险</span>' frontend/index.html frontend/css/style.css
rg -n 'NEKO|neko-icon\.png' frontend/index.html frontend/css/style.css frontend/test_neko_branding.mjs
```

Expected: the first command returns no matches; the second command shows the new title, image path, wordmark, and CSS hooks. Existing descriptive “AI 对话冒险” copy outside the top-left brand may remain.

- [ ] **Step 3: Run the local app for manual visual verification**

Run:

```powershell
python start.py --no-browser
```

Open the local URL printed by the script and verify at desktop width and at widths below 720px and 420px:

- the cat icon has no checkerboard background, is not stretched, and includes the complete ears and tail;
- `NEKO` is readable, does not wrap, and has visible geometric spacing;
- light and dark themes keep sufficient wordmark contrast;
- the right-side mode badge and theme button remain visible;
- the brand link still returns to the library route.

Stop the local server after verification.

- [ ] **Step 4: Confirm the final worktree scope**

Run:

```powershell
git status --short
git diff --check HEAD~1..HEAD
```

Expected: the NEKO implementation commit contains only the planned frontend asset, markup, CSS, and focused test; unrelated pre-existing worktree changes remain outside the commit.
