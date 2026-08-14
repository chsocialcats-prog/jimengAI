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
  assert.match(
    topbar,
    /<div class="top-actions">\s*<span class="mode-badge" id="mode-badge" title="当前数据模式">检测中<\/span>\s*<div id="auth-nav" class="auth-nav" aria-live="polite"><\/div>\s*<\/div>/,
  );
  assert.equal(indexSource.match(/id="mode-badge"/g)?.length, 1);
  assert.ok(topbar.indexOf('id="mode-badge"') < topbar.indexOf('id="auth-nav"'));
});

test("左侧页脚删除故事引擎状态并只保留主题切换", () => {
  assert.doesNotMatch(workspaceRail, /workspace-status|status-pulse|本地故事引擎|id="mode-badge"/);
  assert.match(
    workspaceRail,
    /<div class="workspace-rail-footer">\s*<button class="icon-btn" id="theme-toggle"/,
  );
  const footerRules = [...cssSource.matchAll(/^\.workspace-rail-footer\s*\{([^}]*)\}/gm)];
  assert.match(footerRules.at(-1)?.[1] || "", /justify-content:\s*flex-end/);
});

test("右上角不再显示故事系统就绪并保留三种动态文案", () => {
  assert.doesNotMatch(topbar, /故事系统就绪|topbar-signal/);
  assert.match(
    mainSource,
    /MODE === "online" \? "DeepSeek 在线" : MODE === "mock" \? "Mock 模式" : "离线演示"/,
  );
  assert.match(mainSource, /modeBadge\.textContent = text/);
  assert.match(mainSource, /const online = MODE === "online" && backendAvailable/);
  assert.match(mainSource, /modeBadge\.classList\.toggle\("online", online\)/);
  assert.match(mainSource, /modeBadge\.classList\.toggle\("mock", !online\)/);
});
