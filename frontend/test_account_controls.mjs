import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNT_POPOVERS,
  accountControlsMarkup,
  buildAccountControlsModel,
  getAvatarInitial,
} from "./js/account-controls.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const controllerSource = read("./js/account-controls.mjs");
const indexSource = read("./index.html");
const iconsSource = read("./js/icons.js");

test("头像使用用户名第一个 Unicode 码点并提供稳定回退", () => {
  assert.equal(getAvatarInitial("  𠮷野  "), "𠮷");
  assert.equal(getAvatarInitial("🧙‍♀️冒险者"), "🧙");
  assert.equal(getAvatarInitial("   "), "N");
  assert.equal(getAvatarInitial(null), "N");
});

test("账号视图模型区分匿名、认证不可用和已登录状态", () => {
  assert.deepEqual(buildAccountControlsModel({ status: "anonymous" }), { status: "anonymous" });
  assert.deepEqual(buildAccountControlsModel({ status: "unavailable" }), { status: "unavailable" });
  assert.deepEqual(
    buildAccountControlsModel({ status: "authenticated", user: { username: " 林墨 " } }),
    { status: "authenticated", username: "林墨", avatarInitial: "林" },
  );
});

test("匿名与不可用状态只呈现真实可用的账号入口", () => {
  const anonymous = accountControlsMarkup({ status: "anonymous" });
  const unavailable = accountControlsMarkup({ status: "unavailable" });
  assert.match(anonymous, /href="#\/login">登录<\/a>/);
  assert.match(anonymous, /href="#\/register">注册<\/a>/);
  assert.doesNotMatch(anonymous, /data-account-trigger/);
  assert.match(unavailable, /data-account-state="unavailable"/);
  assert.match(unavailable, />账号不可用<\/span>/);
  assert.doesNotMatch(unavailable, /href=|data-account-trigger/);
});

test("已登录菜单转义用户名并链接到 API 与个人资料子路由", () => {
  const markup = accountControlsMarkup({ status: "authenticated", user: { username: "<林&墨>" } });
  assert.match(markup, /&lt;林&amp;墨&gt;/);
  assert.match(markup, /href="#\/settings\/api"/);
  assert.match(markup, /href="#\/settings\/profile"/);
  assert.match(markup, /data-account-logout/);
  assert.match(markup, />退出登录<\/span>/);
  assert.doesNotMatch(markup, /style=/);
});

test("通知浮层保持诚实空状态且不伪造未读标记", () => {
  const markup = accountControlsMarkup({ status: "authenticated", user: { username: "Neko" } });
  assert.match(markup, new RegExp(`id="${ACCOUNT_POPOVERS.notifications}"`));
  assert.match(markup, /<p>暂无通知<\/p>/);
  assert.doesNotMatch(markup, /unread|notification-badge|通知数量|红点/i);
});

test("两个触发器具有完整弹出层 ARIA 契约", () => {
  const markup = accountControlsMarkup({ status: "authenticated", user: { username: "Neko" } });
  assert.equal(markup.match(/aria-expanded="false"/g)?.length, 2);
  assert.equal(markup.match(/aria-haspopup="dialog"/g)?.length, 2);
  assert.match(markup, new RegExp(`aria-controls="${ACCOUNT_POPOVERS.notifications}"`));
  assert.match(markup, new RegExp(`aria-controls="${ACCOUNT_POPOVERS.account}"`));
});

test("控制器实现互斥、外部点击、Escape、路由关闭与焦点归还", () => {
  assert.match(controllerSource, /closeAll\(\{ restoreFocus: false \}\);\s*popover\.hidden = false/);
  assert.match(controllerSource, /addEventListener\("pointerdown", onDocumentPointerDown, true\)/);
  assert.match(controllerSource, /!root\.contains\(event\.target\)\) closeAll\(\)/);
  assert.match(controllerSource, /event\.key !== "Escape"/);
  assert.match(controllerSource, /triggerToRestore\.focus\(\)/);
  assert.match(controllerSource, /function handleRouteChange\(\)/);
  assert.match(controllerSource, /return \{\s*render,\s*closeAll,\s*handleRouteChange,/);
});

test("顶栏顺序固定为模式状态后接账号根节点并移除侧栏设置", () => {
  const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));
  const workspaceNav = indexSource.slice(indexSource.indexOf('<nav class="workspace-nav'), indexSource.indexOf("</nav>"));
  assert.match(
    topbar,
    /<div class="top-actions">\s*<span class="mode-badge" id="mode-badge"[^>]*>检测中<\/span>\s*<div id="auth-nav" class="auth-nav" aria-live="polite"><\/div>\s*<\/div>/,
  );
  assert.doesNotMatch(workspaceNav, /data-nav="settings"|href="#\/settings"/);
  assert.equal(workspaceNav.match(/<a /g)?.length, 4);
});

test("主题在样式表加载前应用，未保存时固定使用明亮主题", () => {
  const bootstrapIndex = indexSource.indexOf('localStorage.getItem("adventure_theme")');
  const stylesheetIndex = indexSource.indexOf('<link rel="stylesheet"');
  assert.ok(bootstrapIndex > 0 && bootstrapIndex < stylesheetIndex);
  assert.match(indexSource, /savedTheme === "dark" \? "dark" : "light"/);
  assert.doesNotMatch(indexSource.slice(0, stylesheetIndex), /matchMedia|prefers-color-scheme/);
});

test("账号控件所需图标均存在于内联 Lucide 风格图标表", () => {
  assert.match(iconsSource, /bell:\s*'/);
  assert.match(iconsSource, /key:\s*'/);
  assert.match(iconsSource, /"log-out":\s*'/);
  assert.match(iconsSource, /"chevron-down":\s*'/);
});
