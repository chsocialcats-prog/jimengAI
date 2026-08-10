# Live2D Widget Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one globally loaded, network-tolerant Live2D Widget to every hash-routed page, with the upstream close and reactivation behavior preserved.

**Architecture:** Add the pinned upstream `autoload.js` once at the end of the shared `frontend/index.html`; the upstream loader owns the `#waifu` lifecycle, model loading, tools, close action, and reactivation toggle. Add a small local CSS compatibility layer after the existing stylesheet rules so the external Widget stays below modal/navigation layers and fits above the mobile bottom navigation. No backend or `main.js` changes are needed.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript frontend; Node.js built-in `node:test` for the static contract test; Python `pytest`/`unittest` for existing regression checks; manual Chromium browser QA for the external widget.

## Global Constraints

- Load exactly `https://fastly.jsdelivr.net/npm/live2d-widgets@1.0.1/dist/autoload.js`; do not use an unpinned `latest` URL.
- The Widget is a non-core enhancement: external resource failure must not block the existing application.
- Keep the upstream default reactivation behavior; do not set `showToggleAfterQuit` to `false`.
- Show the Widget on every hash route and load the script only once from the shared host page.
- Keep modal and mobile bottom-navigation layers above the Widget, and keep the mobile Widget above the bottom navigation spatially.
- Do not modify `backend/`, database/schema code, API routes, or conversation/session state.
- Preserve all unrelated user modifications already present in the working tree.

---

### Task 1: Add the failing Live2D integration contract test

**Files:**
- Create: `frontend/test_live2d_widget.mjs`
- Read: `frontend/index.html`
- Read: `frontend/css/style.css`

**Interfaces:**
- Consumes: the shared HTML host page and CSS source as UTF-8 text.
- Produces: a Node test that later implementation steps must satisfy without requiring network access.

- [ ] **Step 1: Write the failing test**

Create `frontend/test_live2d_widget.mjs` with the following exact assertions:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
const pinnedUrl = "https://fastly.jsdelivr.net/npm/live2d-widgets@1.0.1/dist/autoload.js";

test("loads one pinned Live2D autoloader after the app module", () => {
  assert.equal(indexSource.split('id="live2d-widget-loader"').length - 1, 1);
  assert.equal(indexSource.split(pinnedUrl).length - 1, 1);
  const appScriptIndex = indexSource.indexOf('src="js/main.js?v=options-2"');
  const widgetScriptIndex = indexSource.indexOf('id="live2d-widget-loader"');
  assert.ok(appScriptIndex >= 0);
  assert.ok(widgetScriptIndex > appScriptIndex);
  assert.equal(indexSource.includes("showToggleAfterQuit: false"), false);
});

test("adds layout rules for the external Widget", () => {
  assert.ok(styleSource.includes("body #waifu {"));
  assert.ok(styleSource.includes("z-index: 2;"));
  assert.ok(styleSource.includes("bottom: 70px !important;"));
  assert.ok(styleSource.includes("body #waifu-toggle {"));
  assert.ok(styleSource.includes("bottom: 76px !important;"));
  assert.ok(styleSource.includes("z-index: 71 !important;"));
  assert.ok(styleSource.includes("width: min(220px, 58vw) !important;"));
  assert.ok(styleSource.includes("height: min(220px, 58vw) !important;"));
  assert.ok(styleSource.includes("width: min(220px, calc(100vw - 30px)) !important;"));
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
node --test frontend/test_live2d_widget.mjs
```

Expected: the test process fails because the shared HTML does not yet contain the pinned loader and the stylesheet does not yet contain the Widget layout rules.

- [ ] **Step 3: Commit the failing contract test**

```powershell
git add -- frontend/test_live2d_widget.mjs
git commit -m "test: define Live2D widget integration contract"
```

### Task 2: Add the global pinned Widget loader

**Files:**
- Modify: `frontend/index.html:33-34`
- Test: `frontend/test_live2d_widget.mjs`

**Interfaces:**
- Consumes: the current app module script in the shared HTML host page.
- Produces: a single `script#live2d-widget-loader` that loads the pinned upstream autoloader after the app script declaration.

- [ ] **Step 1: Add the loader after the existing app module script**

Keep the current application script unchanged and append this exact script element immediately after it:

```html
  <script type="module" src="js/main.js?v=options-2"></script>
  <script
    id="live2d-widget-loader"
    defer
    src="https://fastly.jsdelivr.net/npm/live2d-widgets@1.0.1/dist/autoload.js"
  ></script>
```

Do not add a second loader to any route-rendered HTML in `frontend/js/main.js`. The upstream loader dynamically loads its CSS, tips code, Cubism runtime, and model resources; the application should not import those resources itself.

- [ ] **Step 2: Run the contract test**

Run:

```powershell
node --test frontend/test_live2d_widget.mjs
```

Expected: the loader test passes and the layout test still fails because CSS has not been added yet.

- [ ] **Step 3: Commit the HTML integration**

```powershell
git add -- frontend/index.html
git commit -m "feat: load Live2D widget across the site"
```

### Task 3: Add desktop and mobile layout compatibility rules

**Files:**
- Modify: `frontend/css/style.css` (append after the existing final media query)
- Test: `frontend/test_live2d_widget.mjs`

**Interfaces:**
- Consumes: upstream selectors `#waifu`, `#waifu-toggle`, `#live2d`, and `#waifu-tips` injected by `autoload.js`.
- Produces: local overrides that prevent modals and the mobile navigation from being obscured while keeping the Widget visible.

- [ ] **Step 1: Append the minimal compatibility CSS**

Append this block at the end of `frontend/css/style.css`:

```css
/* Live2D Widget integration */
body #waifu {
  z-index: 2;
}

@media (max-width: 720px) {
  body #waifu {
    bottom: 70px !important;
  }

  body #waifu-toggle {
    bottom: 76px !important;
    z-index: 71 !important;
  }

  body #live2d {
    width: min(220px, 58vw) !important;
    height: min(220px, 58vw) !important;
  }

  body #waifu-tips {
    width: min(220px, calc(100vw - 30px)) !important;
  }
}
```

The `body` qualifier wins over the dynamically appended upstream stylesheet without using global resets. The Widget remains below `.topbar` (`z-index: 30`), `.status-sidebar` (`z-index: 60`), the mobile `.nav-links` (`z-index: 70`), `.toast-root` (`z-index: 80`), and `.modal-backdrop` (`z-index: 90`). The mobile bottom offsets keep the model and reactivation toggle spatially above the fixed navigation.

- [ ] **Step 2: Run the focused contract test**

Run:

```powershell
node --test frontend/test_live2d_widget.mjs
```

Expected: both tests pass without accessing the external CDN.

- [ ] **Step 3: Commit the CSS integration**

```powershell
git add -- frontend/css/style.css
git commit -m "style: fit Live2D widget around app navigation"
```

### Task 4: Run regression checks and browser verification

**Files:**
- Read: `frontend/index.html`
- Read: `frontend/css/style.css`
- Read: `frontend/js/main.js`
- Read: `docs/superpowers/specs/2026-08-10-live2d-widget-design.md`

**Interfaces:**
- Consumes: the completed HTML/CSS integration and the existing test suites.
- Produces: verified evidence that the Widget is globally wired without backend or route regressions.

- [ ] **Step 1: Run all frontend syntax and contract tests**

Run:

```powershell
node --check frontend/js/main.js
node --test frontend/test_live2d_widget.mjs
node --test frontend/*.mjs
```

Expected: `node --check` exits successfully and all Node tests pass.

- [ ] **Step 2: Run Python regressions**

Run:

```powershell
python -m pytest -q
python -m unittest test_start_browser -v
```

Expected: all existing backend tests and the browser-start unit test pass; no backend files are changed by this feature.

- [ ] **Step 3: Start the local service without opening a second browser**

Run in a dedicated terminal:

```powershell
python start.py --no-browser
```

Then verify the shared page contains the pinned loader:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/).Content | Select-String "live2d-widget-loader|live2d-widgets@1.0.1"
```

Expected: the response contains the one loader element and its pinned URL.

- [ ] **Step 4: Perform desktop and mobile browser QA**

Open `http://127.0.0.1:8000/` in Chromium with network access, wait for the external resources to settle, and check the following:

1. The Widget appears on `/`, `#/creator`, `#/cards`, `#/settings`, and an adventure route without adding another Widget node after navigation.
2. Clicking the Widget close tool hides it and leaves the upstream reactivation toggle visible; clicking that toggle restores the Widget.
3. The Widget stays behind the topbar and modal backdrop; opening the status sidebar or an app toast remains usable.
4. At a mobile viewport no wider than 720px, the model is smaller, sits above the bottom navigation, and does not cover the chat composer.
5. With CDN access blocked or unavailable, the normal app remains usable and no application error toast appears.

Capture desktop and mobile screenshots if the local browser workflow supports it, and inspect the browser console for only expected third-party resource failures.

- [ ] **Step 5: Confirm the final diff is scoped**

Run:

```powershell
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: the feature commits contain only `frontend/index.html`, `frontend/css/style.css`, and `frontend/test_live2d_widget.mjs`; pre-existing user changes remain untouched and are not staged by the feature commits.
