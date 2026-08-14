# NEKO Topbar Brand and Viewport-Centered Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the NEKO brand to the website's upper-left corner and keep the glass search field centered against the full browser viewport, independently of the workspace rail state.

**Architecture:** Promote `<header class="topbar">` to a direct child of `.app-shell`, place the existing brand inside that header, and leave `.workspace-rail` responsible only for navigation and lower controls. Use a three-layer topbar layout: left-aligned brand, absolutely viewport-centered search, and right-aligned system status; retain the existing two-row mobile fallback.

**Tech Stack:** Plain HTML, CSS, JavaScript icon mounting, Node `node:test`, Chrome DevTools Protocol browser checks.

## Global Constraints

- Preserve existing Hash routes, theme behavior, `adventure_workspace_collapsed`, navigation attributes, and workspace toggle behavior.
- Preserve `.brand`, `.brand-logo`, `.brand-text`, `.topbar-search`, `#global-search`, `#workspace-rail`, and `#workspace-toggle`.
- Do not add external fonts, images, dependencies, APIs, or search data behavior.
- Do not modify backend, SSE, offline storage, or adventure business logic.
- Preserve unrelated dirty-worktree changes and do not commit unless explicitly requested by the user.

---

### Task 1: Lock the topbar DOM contract

**Files:**
- Modify: `frontend/test_workspace_rail_refinement.mjs`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: Existing `.app-shell`, `.workspace-rail`, `.app-frame`, `.topbar`, and brand markup.
- Produces: One `.topbar` as the first direct child of `.app-shell`; `.brand` inside `.topbar`; no `.workspace-identity` or `.brand` inside `#workspace-rail`.

- [ ] **Step 1: Write the failing DOM contract test**

Add assertions that extract the `<aside>` and `<header>` fragments and verify:

```js
test("the full-width topbar owns the NEKO brand instead of the centered workspace rail", () => {
  const aside = indexSource.slice(indexSource.indexOf("<aside"), indexSource.indexOf("</aside>"));
  const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));
  assert.match(indexSource, /<div class="app-shell">\s*<header class="topbar">/);
  assert.match(topbar, /class="brand"/);
  assert.match(topbar, /class="brand-logo"/);
  assert.match(topbar, /class="brand-text">NEKO/);
  assert.doesNotMatch(aside, /workspace-identity|class="brand"/);
});
```

- [ ] **Step 2: Run the narrow test and verify RED**

Run: `node --test frontend/test_workspace_rail_refinement.mjs`

Expected: FAIL because the topbar is currently nested inside `.app-frame` and the brand is inside `#workspace-rail`.

- [ ] **Step 3: Move existing markup without changing public IDs**

In `frontend/index.html`:

```html
<div class="app-shell">
  <header class="topbar">
    <a class="brand topbar-brand" href="#/" aria-label="返回作品库">
      <img class="brand-logo" src="assets/neko-icon.png" alt="">
      <span class="brand-text">NEKO</span>
    </a>
    <div class="topbar-search" role="search">...</div>
    <div class="top-actions">...</div>
  </header>
  <aside class="workspace-rail" id="workspace-rail" aria-label="故事工作区">
    <nav class="workspace-nav nav-links" aria-label="主导航">...</nav>
    ...
  </aside>
  <button id="workspace-toggle" ...>...</button>
  <div class="app-frame">
    <main id="app" tabindex="-1"></main>
  </div>
</div>
```

Remove `.workspace-rail-head` and `.workspace-identity`. Bump the stylesheet query from `workspace-edge-8` to `workspace-edge-9`.

- [ ] **Step 4: Update the cache-version assertion and verify GREEN**

Change the test assertion to `workspace-edge-9`, then run:

`node --test frontend/test_workspace_rail_refinement.mjs`

Expected: PASS for the new DOM contract; CSS-center tests added in Task 2 may still be absent.

---

### Task 2: Center the search against the viewport

**Files:**
- Modify: `frontend/test_workspace_rail_refinement.mjs`
- Modify: `frontend/css/style.css`

**Interfaces:**
- Consumes: Direct-child `.topbar`, `.topbar-brand`, `.topbar-search`, `.top-actions`, and existing CSS tokens.
- Produces: A fixed/sticky full-width topbar whose search center equals `50vw`, independent of `.workspace-collapsed`.

- [ ] **Step 1: Write failing CSS contract tests**

Add:

```js
test("the topbar spans the viewport and pins search to its geometric center", () => {
  assert.match(cssSource, /\.topbar\s*\{[\s\S]*position:\s*sticky[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*width:\s*100%/);
  assert.match(cssSource, /\.topbar-search\s*\{[\s\S]*position:\s*absolute[\s\S]*left:\s*50%[\s\S]*transform:\s*translateX\(-50%\)/);
  assert.match(cssSource, /\.topbar-brand\s*\{[\s\S]*justify-self:\s*start/);
  assert.match(cssSource, /\.top-actions\s*\{[\s\S]*justify-self:\s*end/);
  assert.doesNotMatch(cssSource, /\.topbar-search\s*\{[\s\S]*margin-left:\s*clamp/);
});
```

Add a separate assertion that `.app-shell` uses grid rows/columns suitable for a full-width first row:

```js
assert.match(cssSource, /\.app-shell\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*1fr/);
```

- [ ] **Step 2: Run the narrow test and verify RED**

Run: `node --test frontend/test_workspace_rail_refinement.mjs`

Expected: FAIL because the current topbar lives in the right content flow and `.topbar-search` uses a left margin.

- [ ] **Step 3: Add a final scoped CSS layer**

At the end of `frontend/css/style.css`, add desktop rules with this structure:

```css
.app-shell {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  padding-left: 0;
}

.topbar {
  position: sticky;
  top: 0;
  grid-column: 1 / -1;
  grid-row: 1;
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(190px, 1fr);
  align-items: center;
}

.topbar-brand {
  justify-self: start;
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--story-violet) 22%, var(--line));
  border-radius: 15px;
  background: color-mix(in srgb, var(--panel) 42%, transparent);
  backdrop-filter: blur(14px) saturate(125%);
}

.topbar-search {
  position: absolute;
  left: 50%;
  width: min(360px, calc(100vw - 520px));
  min-width: 240px;
  margin-left: 0;
  transform: translateX(-50%);
}

.top-actions {
  grid-column: 3;
  justify-self: end;
  margin-left: 0;
}

.workspace-rail {
  grid-row: 2;
}

.app-frame {
  grid-row: 2;
  min-width: 0;
  padding-left: calc(var(--story-rail-width) + 16px);
}

.workspace-collapsed .app-frame {
  padding-left: calc(var(--story-rail-collapsed) + 16px);
}
```

Keep the rail `position: fixed`, `top: 50%`, and `transform: translateY(-50%)`. Remove or override the obsolete `.workspace-identity` glass block and rail-specific brand sizing.

- [ ] **Step 4: Add 960px and mobile fallback rules**

Use:

```css
@media (max-width: 960px) and (min-width: 721px) {
  .topbar-search {
    width: min(320px, calc(100vw - 430px));
    min-width: 200px;
  }
}

@media (max-width: 720px) {
  .app-shell {
    display: block;
  }

  .topbar {
    display: grid;
    grid-template-columns: 1fr auto;
    height: auto;
    min-height: 62px;
    padding: 10px 16px;
  }

  .topbar-brand {
    grid-column: 1;
    justify-self: start;
  }

  .topbar-search {
    position: static;
    grid-column: 1 / -1;
    width: 100%;
    min-width: 0;
    transform: none;
  }

  .app-frame,
  .workspace-collapsed .app-frame {
    padding-left: 0;
  }
}
```

- [ ] **Step 5: Run the narrow test and verify GREEN**

Run: `node --test frontend/test_workspace_rail_refinement.mjs`

Expected: all tests pass.

---

### Task 3: Verify viewport centering and regressions

**Files:**
- Modify if needed: `frontend/css/style.css`
- Test: all `frontend/test_*.mjs`

**Interfaces:**
- Consumes: Final topbar and rail DOM/CSS from Tasks 1–2.
- Produces: Verified geometry at 1440px, 960px, and 390px with no horizontal overflow.

- [ ] **Step 1: Run all frontend tests**

Run:

```powershell
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: all tests pass.

- [ ] **Step 2: Verify desktop geometry in a browser**

At viewport widths 1440 and 960, collect bounding rectangles for `.topbar-search`, `.topbar-brand`, `#workspace-rail`, and `#workspace-toggle`. Assert manually from the output:

```js
Math.abs((search.x + search.width / 2) - innerWidth / 2) <= 1
```

Click `#workspace-toggle`, repeat the search-center measurement, and require the same result. Confirm rail and toggle remain vertically centered.

- [ ] **Step 3: Verify mobile geometry**

At 390×844 confirm:

- `.topbar` height contains both rows.
- `.topbar-search` begins at `x = 16` and has width `358px`.
- `document.documentElement.scrollWidth <= innerWidth`.
- The four-item bottom navigation remains visible.

- [ ] **Step 4: Capture and inspect a 1440px screenshot**

Visually confirm the NEKO brand sits in the website's upper-left, the search center aligns with the viewport center, the system status stays right-aligned, and the side rail no longer contains brand content.

- [ ] **Step 5: Run final integrity checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only pre-existing user changes plus the explicitly modified UI/test/design/plan files are present.
