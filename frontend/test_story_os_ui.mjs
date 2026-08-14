import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const indexSource = read("./index.html");
const mainSource = read("./js/main.js");
const adventureSource = read("./js/adventure-page.mjs");
const iconsSource = read("./js/icons.js");
const cssSource = read("./css/style.css");

test("全局壳层提供可收起的 Story OS 工作区栏", () => {
  assert.match(indexSource, /id="workspace-rail"/);
  assert.match(indexSource, /id="workspace-toggle"/);
  assert.match(indexSource, /class="workspace-nav nav-links"/);
  assert.match(indexSource, /data-nav="library"/);
  assert.match(indexSource, /data-nav="creator"/);
  assert.match(indexSource, /data-nav="cards"/);
  assert.match(indexSource, /data-nav="worldbooks"/);
  assert.doesNotMatch(indexSource, /data-nav="settings"/);
  assert.match(indexSource, /aria-expanded="true"/);
});

test("工作区收起状态使用独立的本地偏好", () => {
  assert.match(mainSource, /adventure_workspace_collapsed/);
  assert.match(mainSource, /workspace-toggle/);
  assert.match(mainSource, /workspace-collapsed/);
});

test("工作区收起时统一隐藏导航文字列", () => {
  assert.match(cssSource, /\.workspace-collapsed \.nav-copy,\s*[\s\S]*\.workspace-collapsed \.nav-hint\s*,?[\s\S]*\{\s*display:\s*none/);
  assert.doesNotMatch(cssSource, /\.workspace-collapsed \.workspace-nav a\[data-nav="cards"\]/);
});

test("导航图标挂载不会覆盖导航文字", () => {
  assert.match(iconsSource, /a\[data-nav\]/);
  assert.match(iconsSource, /insertAdjacentHTML\("afterbegin"/);
});

test("作品库渲染首个推荐作品的 spotlight", () => {
  assert.match(mainSource, /id="library-featured"/);
  assert.match(mainSource, /data-featured-action="start"/);
  assert.match(mainSource, /data-featured-action="view"/);
  assert.match(mainSource, /filtered\[0\]/);
  assert.match(mainSource, /<p class="library-featured-cast">\$\{roleCardSummaryHtml\(cards\)\}<\/p>/);
});

test("冒险页保留消息契约并提供 Story OS 阅读上下文", () => {
  assert.match(adventureSource, /class="story-context"/);
  assert.match(adventureSource, /class="story-context-kicker"/);
  assert.match(adventureSource, /id="message-list" class="message-list"/);
  assert.match(adventureSource, /class="status-sidebar" id="status-sidebar"/);
});

test("冒险页默认将状态面板收进阅读区", () => {
  assert.match(adventureSource, /const statusSidebar = \$\("#status-sidebar"\);/);
  assert.match(adventureSource, /statusSidebar\.classList\.add\("desktop-hidden"\);/);
  assert.match(adventureSource, /const adventureShell = \$\("\.adventure-shell"\);/);
  assert.match(adventureSource, /adventureShell\.classList\.add\("sidebar-collapsed"\);/);
  assert.match(adventureSource, /sidebar\.classList\.toggle\("desktop-hidden"/);
  assert.match(adventureSource, /id="sidebar-toggle"/);
  assert.match(adventureSource, /sidebar\.classList\.toggle\("open"\)/);
  assert.match(adventureSource, /button\?\.setAttribute\("aria-expanded", String\(open\)\)/);
  assert.match(adventureSource, /sidebar\.classList\.remove\("desktop-hidden"\)/);
  assert.match(adventureSource, /adventureShell\?\.classList\.remove\("sidebar-collapsed"\)/);
  assert.match(adventureSource, /sidebarToggle\?\.setAttribute\("aria-expanded", "true"\)/);
});

test("Story OS 使用黑白灰与透明视觉 token", () => {
  const visualLayer = cssSource.slice(cssSource.lastIndexOf("NEKO Narrative Workspace"));
  assert.match(visualLayer, /--bg:\s*#f6f6f6/i);
  assert.match(visualLayer, /--text:\s*#141414/i);
  assert.match(visualLayer, /--accent:\s*#161616/i);
  assert.match(visualLayer, /--accent-2:\s*#4a4a4a/i);
  assert.match(visualLayer, /--ok:\s*#343434/i);
  assert.match(visualLayer, /--warning:\s*#626262/i);
  assert.match(visualLayer, /--user-bubble:\s*#ededed/i);
  assert.match(visualLayer, /:root\[data-theme="dark"\]\s*\{[\s\S]*--bg:\s*#121212[\s\S]*--accent:\s*#f5f5f5[\s\S]*--ok:\s*#e0e0e0/i);
  for (const match of visualLayer.matchAll(/#([0-9a-f]{6})/gi)) {
    const [red, green, blue] = match[1].match(/../g).map((component) => Number.parseInt(component, 16));
    assert.equal(red, green, `expected grayscale color ${match[0]}`);
    assert.equal(green, blue, `expected grayscale color ${match[0]}`);
  }
  assert.doesNotMatch(visualLayer, /gradient/i);
  assert.match(visualLayer, /\.message\.ai\s*\{[\s\S]*border-left:\s*2px solid var\(--story-violet\)[\s\S]*font-family:\s*var\(--story-display\)/);
  assert.match(cssSource, /\.workspace-rail\s*\{/);
  assert.match(cssSource, /\.library-featured\s*\{/);
  assert.match(cssSource, /\.story-context\s*\{/);
  assert.match(cssSource, /\.account-popover\.is-open\s*\{[\s\S]*account-popover-in/);
  assert.match(cssSource, /\.settings-layout\s*\{[\s\S]*grid-template-columns:\s*180px/);
  assert.match(cssSource, /\.status-sidebar\.desktop-hidden\.open\s*\{[\s\S]*display:\s*flex/);
  assert.match(cssSource, /prefers-reduced-motion:\s*reduce/);
});
