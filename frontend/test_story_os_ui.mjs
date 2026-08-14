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

test("工作区收起时隐藏角色卡文字节点", () => {
  assert.match(cssSource, /\.workspace-collapsed \.workspace-nav a\[data-nav="cards"\]\s*\{[\s\S]*font-size:\s*0/);
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

test("Story OS 视觉 token 与响应式可访问性规则存在", () => {
  assert.match(cssSource, /--story-night:\s*#f7f8fa/i);
  assert.match(cssSource, /--story-indigo:\s*#ffffff/i);
  assert.match(cssSource, /--story-violet:\s*#167c78/i);
  assert.match(cssSource, /--story-coral:\s*#c65f4b/i);
  assert.match(cssSource, /:root\[data-theme="dark"\][\s\S]*--bg:\s*#121417[\s\S]*--accent:\s*#62b6af/i);
  assert.doesNotMatch(cssSource, /radial-gradient|#9a85ff|#6f5bd7|#6970e8/i);
  assert.match(cssSource, /\.workspace-rail\s*\{/);
  assert.match(cssSource, /\.library-featured\s*\{/);
  assert.match(cssSource, /\.story-context\s*\{/);
  assert.match(cssSource, /\.account-popover\.is-open\s*\{[\s\S]*account-popover-in/);
  assert.match(cssSource, /\.settings-layout\s*\{[\s\S]*grid-template-columns:\s*180px/);
  assert.match(cssSource, /\.status-sidebar\.desktop-hidden\.open\s*\{[\s\S]*display:\s*flex/);
  assert.match(cssSource, /prefers-reduced-motion:\s*reduce/);
});
