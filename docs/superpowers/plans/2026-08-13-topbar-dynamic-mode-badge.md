# 右上角动态模式徽标实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有动态运行模式徽标移到网页右上角，删除“故事系统就绪”和左侧“本地故事引擎”状态块，同时保留主题切换与三种模式文案更新。

**Architecture:** 复用唯一的 `#mode-badge` DOM 节点及 `updateModeBadge()`，只改变静态壳层中的节点位置，不新建状态源或修改模式检测。左侧工作栏底部删除状态块后仅保留主题按钮，并通过现有页脚规则将按钮保持在右侧。

**Tech Stack:** 静态 HTML、CSS、原生 JavaScript、Node.js `node:test`。

## Global Constraints

- `#mode-badge` 必须保持唯一，并继续动态显示“DeepSeek 在线”“Mock 模式”或“离线演示”。
- 左侧工作栏不得保留 `.workspace-status`、“本地故事引擎”或状态圆点。
- 页面不得保留“故事系统就绪”或第二套运行状态显示。
- 保留全局搜索、主题切换、导航和现有模式检测逻辑。
- 工作区已有未提交修改；只编辑本计划列出的相关位置，不覆盖、暂存或提交其他改动。
- 未获用户提交授权，不执行 `git add` 或 `git commit`。

## 文件结构

- Create: `frontend/test_topbar_mode_badge.mjs`：验证壳层 DOM 归属、删除的文案和动态模式更新契约。
- Modify: `frontend/index.html`：删除左侧状态块，将同一个 `#mode-badge` 放进右上角 `.top-actions`。
- Modify: `frontend/css/style.css`：将只剩主题按钮的 `.workspace-rail-footer` 靠右对齐。
- Preserve: `frontend/js/main.js`：现有 `updateModeBadge()` 已满足动态状态要求，不应修改。

---

### Task 1: 移动动态模式徽标并删除左侧状态块

**Files:**
- Create: `frontend/test_topbar_mode_badge.mjs`
- Modify: `frontend/index.html:32-38,60-62`
- Modify: `frontend/css/style.css` 中最后一个独立 `.workspace-rail-footer` 规则
- Verify unchanged: `frontend/js/main.js:117-122`

**Interfaces:**
- Consumes: `updateModeBadge()` 通过 `document.getElementById("mode-badge")` 获取唯一节点，并根据全局 `MODE` 更新 `textContent`、`.online` 和 `.mock`。
- Produces: `.top-actions > #mode-badge`；左侧 `.workspace-rail-footer` 仅包含 `#theme-toggle`。

- [ ] **Step 1: 写入失败的界面契约测试**

创建 `frontend/test_topbar_mode_badge.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const indexSource = read("./index.html");
const mainSource = read("./js/main.js");
const cssSource = read("./css/style.css");
const workspaceRail = indexSource.slice(indexSource.indexOf("<aside"), indexSource.indexOf("</aside>"));
const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));

test("动态模式徽标只出现在网页右上角", () => {
  assert.match(topbar, /<div class="top-actions">\s*<span class="mode-badge" id="mode-badge" title="当前数据模式">检测中<\/span>\s*<\/div>/);
  assert.doesNotMatch(workspaceRail, /id="mode-badge"|workspace-status|status-pulse|本地故事引擎/);
  assert.doesNotMatch(indexSource, /故事系统就绪|topbar-signal/);
  assert.equal(indexSource.match(/id="mode-badge"/g)?.length, 1);
});

test("左侧页脚只保留靠右的主题切换按钮", () => {
  assert.match(workspaceRail, /<div class="workspace-rail-footer">\s*<button class="icon-btn" id="theme-toggle"/);
  const footerRules = [...cssSource.matchAll(/\.workspace-rail-footer\s*\{([^}]*)\}/g)];
  assert.match(footerRules.at(-1)?.[1] || "", /justify-content:\s*flex-end/);
});

test("同一个模式徽标继续使用三种动态文案", () => {
  assert.match(mainSource, /MODE === "online" \? "DeepSeek 在线" : MODE === "mock" \? "Mock 模式" : "离线演示"/);
  assert.match(mainSource, /modeBadge\.textContent = text/);
  assert.match(mainSource, /modeBadge\.classList\.toggle\("online", MODE === "online"\)/);
  assert.match(mainSource, /modeBadge\.classList\.toggle\("mock", MODE !== "online"\)/);
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```powershell
node --test frontend/test_topbar_mode_badge.mjs
```

Expected: FAIL；右上角仍是 `.topbar-signal`，`#mode-badge` 仍在左侧状态块中，且最后的页脚规则仍为 `justify-content: flex-start`。

- [ ] **Step 3: 实现最小 DOM 与样式改动**

将 `frontend/index.html` 的左侧页脚改为：

```html
<div class="workspace-rail-footer">
  <button class="icon-btn" id="theme-toggle" type="button" aria-label="切换明亮模式" data-icon="moon"></button>
</div>
```

将右上角动作区改为：

```html
<div class="top-actions">
  <span class="mode-badge" id="mode-badge" title="当前数据模式">检测中</span>
</div>
```

在 `frontend/css/style.css` 最后一个独立的 `.workspace-rail-footer` 规则中，将：

```css
justify-content: flex-start;
```

改为：

```css
justify-content: flex-end;
```

不要修改 `frontend/js/main.js`，因为同一 ID 的节点移动后现有动态更新逻辑仍然有效。

- [ ] **Step 4: 运行专项测试并确认通过**

Run:

```powershell
node --test frontend/test_topbar_mode_badge.mjs
```

Expected: 3 tests PASS，0 tests FAIL。

- [ ] **Step 5: 运行相关 Story OS 壳层测试**

Run:

```powershell
node --test frontend/test_story_os_ui.mjs frontend/test_workspace_rail_refinement.mjs frontend/test_topbar_mode_badge.mjs
```

Expected: 所有壳层测试 PASS；如已有与本任务无关的失败，仅记录完整失败名称和输出，不修改无关代码。

- [ ] **Step 6: 运行完整前端测试套件**

Run:

```powershell
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: 所有前端测试 PASS。此静态布局改动不涉及后端，不需要运行或修改后端测试。

- [ ] **Step 7: 审阅范围并保留用户改动**

Run:

```powershell
git diff -- frontend/index.html frontend/css/style.css frontend/test_topbar_mode_badge.mjs
git status --short
```

Expected: 本任务只新增契约测试，并在现有脏文件中产生上述两处最小改动；不暂存、不提交任何文件。
