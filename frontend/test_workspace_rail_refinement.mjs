import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const indexSource = read("./index.html");
const mainSource = read("./js/main.js");
const iconsSource = read("./js/icons.js");
const cssSource = read("./css/style.css");

test("workspace rail removes the vertical product label", () => {
  assert.doesNotMatch(indexSource, /workspace-label/);
});

test("workspace shell loads the refreshed rail stylesheet", () => {
  assert.match(indexSource, /href="css\/style\.css\?v=account-ui-1"/);
});

test("workspace rail keeps the navigation surface free of decorative eyebrow copy", () => {
  const aside = indexSource.slice(indexSource.indexOf("<aside"), indexSource.indexOf("</aside>"));
  assert.doesNotMatch(aside, /NIGHT JOURNAL/);
  assert.doesNotMatch(aside, /WORKSPACE \/ 04/);
  assert.doesNotMatch(aside, /workspace-rail-eyebrow|workspace-nav-label/);
});

test("inline icons render as visible line drawings", () => {
  assert.match(cssSource, /svg\.icon\s*\{[\s\S]*stroke:\s*currentColor[\s\S]*fill:\s*none[\s\S]*stroke-linecap:\s*round[\s\S]*stroke-linejoin:\s*round/);
});

test("topbar gives the NEKO brand a larger visual anchor", () => {
  assert.match(cssSource, /\.topbar-brand \.brand-logo\s*\{[\s\S]*width:\s*46px[\s\S]*height:\s*46px[\s\S]*flex-basis:\s*46px/);
  assert.match(cssSource, /\.topbar-brand \.brand-text\s*\{[\s\S]*font-size:\s*21px[\s\S]*letter-spacing:\s*0\.20em/);
});

test("workspace navigation uses a shared icon and text grid", () => {
  assert.match(cssSource, /\.workspace-nav a\s*\{[\s\S]*display:\s*grid/);
  assert.match(cssSource, /grid-template-columns:\s*3px 18px minmax\(0, 1fr\) auto/);
  assert.match(cssSource, /\.workspace-collapsed \.workspace-nav a\s*\{[\s\S]*grid-template-columns:\s*18px/);
  assert.match(cssSource, /\.workspace-nav a\[data-nav="cards"\]::after/);
  assert.match(cssSource, /content:\s*"CHARACTERS"/);
});

test("collapsed role-card navigation keeps its icon color while hiding only the label", () => {
  assert.match(cssSource, /\.workspace-collapsed \.workspace-nav a\[data-nav="cards"\]\s*\{[\s\S]*font-size:\s*0/);
  assert.doesNotMatch(cssSource, /\.workspace-collapsed \.workspace-nav a\[data-nav="cards"\]\s*\{[\s\S]*color:\s*transparent/);
  assert.match(cssSource, /\.workspace-collapsed \.workspace-nav a\s*>\s*svg\.icon\s*\{[\s\S]*grid-column:\s*1/);
});

test("workspace rail uses a compact dock and an obvious collapse control", () => {
  assert.match(cssSource, /\.workspace-rail\s*\{[\s\S]*height:\s*fit-content/);
  assert.match(cssSource, /\.workspace-rail\s*\{[\s\S]*position:\s*fixed[\s\S]*margin:\s*0/);
  assert.match(cssSource, /\.workspace-rail-footer\s*\{[\s\S]*margin-top:\s*22px/);
  assert.match(indexSource, /class="workspace-toggle-expanded-icon"[^>]*data-icon="sidebar-collapse"/);
  assert.match(iconsSource, /sidebar-collapse/);
  assert.match(mainSource, /workspaceToggle\.classList\.toggle\("is-collapsed"/);
  assert.match(cssSource, /\.workspace-toggle::after/);
});

test("workspace toggle exposes its action in visible copy", () => {
  assert.match(indexSource, /id="workspace-toggle"[\s\S]*workspace-toggle-mark/);
  assert.match(indexSource, /workspace-toggle-label">收起工作栏/);
  assert.match(mainSource, /workspace-toggle-label/);
  assert.match(mainSource, /展开工作栏/);
  assert.match(cssSource, /\.workspace-toggle-label/);
});

test("workspace navigation and lower tools use left alignment", () => {
  assert.match(cssSource, /\.workspace-nav a\s*\{[\s\S]*justify-content:\s*start/);
  assert.match(cssSource, /\.workspace-nav a \.nav-copy\s*\{[\s\S]*text-align:\s*left/);
  assert.match(cssSource, /\.rail-ai-button\s*\{[\s\S]*text-align:\s*left/);
});

test("rail provides an AI inquiry entry point", () => {
  assert.match(indexSource, /id="rail-ai-inquiry"/);
  assert.match(indexSource, /aria-label="打开 AI 询问系统"/);
  assert.match(indexSource, /AI 询问/);
  assert.match(indexSource, /ASK NEKO/);
  assert.match(mainSource, /railAiInquiry/);
  assert.match(mainSource, /AI 询问系统/);
  assert.match(cssSource, /\.rail-ai-button/);
});

test("workspace rail uses a distinct NEKO command-deck structure", () => {
  const aside = indexSource.slice(indexSource.indexOf("<aside"), indexSource.indexOf("</aside>"));
  const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));
  assert.match(aside, /class="workspace-rail-lower"/);
  assert.doesNotMatch(aside, /workspace-identity|class="brand"/);
  assert.match(topbar, /class="brand topbar-brand"/);
  assert.doesNotMatch(aside, /workspace-toggle/);
  assert.doesNotMatch(topbar, /workspace-toggle/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\s*\{[\s\S]*position:\s*fixed/);
  assert.match(cssSource, /\.workspace-rail\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle:hover/);
  assert.doesNotMatch(indexSource, /探索|礼物|充值|AI生图|有奖邀请|签到中心|每日抽奖/);
});

test("workspace collapse control uses the reference-sized boundary circle", () => {
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\s*\{[\s\S]*top:\s*50%[\s\S]*left:\s*calc\(16px \+ var\(--story-rail-width\) - 29px\)[\s\S]*margin:\s*0[\s\S]*width:\s*58px[\s\S]*height:\s*58px[\s\S]*border-radius:\s*50%/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\.is-collapsed\s*\{[\s\S]*left:\s*calc\(16px \+ var\(--story-rail-collapsed\) \+ 8px\)[\s\S]*margin:\s*0[\s\S]*border-radius:\s*50%/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle \.workspace-toggle-label\s*\{[\s\S]*clip-path:\s*inset\(50%\)/);
});

test("workspace collapse control follows the rail while scrolling and uses translucent glass", () => {
  assert.match(cssSource, /\.app-frame\s*\{[\s\S]*padding-left:\s*calc\(var\(--story-rail-width\) \+ 16px\)/);
  assert.match(cssSource, /\.workspace-collapsed \.app-frame\s*\{[\s\S]*padding-left:\s*calc\(var\(--story-rail-collapsed\) \+ 16px\)/);
  assert.match(cssSource, /\.workspace-rail\s*\{[\s\S]*position:\s*fixed[\s\S]*top:\s*50%[\s\S]*transform:\s*translateY\(-50%\)/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\s*\{[\s\S]*position:\s*fixed[\s\S]*top:\s*50%[\s\S]*transform:\s*translateY\(-50%\)/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--panel\) 78%, transparent\)/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\s*\{[\s\S]*backdrop-filter:\s*blur\(10px\)/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle\.is-collapsed\s*\{[\s\S]*left:\s*calc\(16px \+ var\(--story-rail-collapsed\) \+ 8px\)[\s\S]*margin:\s*0/);
});

test("mobile bottom navigation cancels the desktop vertical centering transform", () => {
  assert.match(cssSource, /@media \(max-width: 720px\)\s*\{[\s\S]*\.app-shell\s*\{[\s\S]*display:\s*block[\s\S]*padding-left:\s*0[\s\S]*\n\s*\}/);
  assert.match(cssSource, /\.workspace-rail,\s*\.workspace-collapsed \.workspace-rail\s*\{[\s\S]*position:\s*fixed[\s\S]*transform:\s*none[\s\S]*\n\s*\}/);
});

test("workspace collapse control floats outside the rail and swaps to smaller reference icons", () => {
  assert.match(indexSource, /<\/aside>\s*<button[^>]*id="workspace-toggle"/);
  assert.match(indexSource, /class="workspace-toggle-expanded-icon"[^>]*data-icon="sidebar-collapse"/);
  assert.match(indexSource, /class="workspace-toggle-collapsed-icon"[^>]*data-icon="menu"/);
  assert.match(iconsSource, /sidebar-collapse/);
  assert.match(iconsSource, /menu:/);
  assert.match(cssSource, /\.workspace-edge-toggle\.is-collapsed \.workspace-toggle-expanded-icon\s*\{[\s\S]*display:\s*none/);
  assert.match(cssSource, /\.workspace-edge-toggle\.is-collapsed \.workspace-toggle-collapsed-icon\s*\{[\s\S]*display:\s*grid/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle:hover[\s\S]*width:\s*58px[\s\S]*height:\s*58px/);
  assert.match(cssSource, /\.app-shell > \.workspace-edge-toggle \.workspace-toggle-mark \.icon\s*\{[\s\S]*width:\s*18px[\s\S]*height:\s*18px/);
  assert.match(iconsSource, /sidebar-collapse.*x1=\"3\" y1=\"7\" x2=\"17\" y2=\"7\"/);
});

test("the full-width topbar owns an unframed NEKO brand instead of the centered workspace rail", () => {
  const aside = indexSource.slice(indexSource.indexOf("<aside"), indexSource.indexOf("</aside>"));
  const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));
  assert.match(indexSource, /<div class="app-shell">\s*<header class="topbar">/);
  assert.match(topbar, /class="brand topbar-brand"/);
  assert.match(topbar, /class="brand-logo"/);
  assert.match(topbar, /class="brand-text">NEKO/);
  assert.doesNotMatch(aside, /workspace-identity|class="brand"/);
  assert.match(cssSource, /\.topbar-brand\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/);
});

test("the topbar exposes an accessible flat search entry", () => {
  const topbar = indexSource.slice(indexSource.indexOf("<header"), indexSource.indexOf("</header>"));
  assert.match(topbar, /class="topbar-search" role="search"/);
  assert.match(topbar, /id="global-search"/);
  assert.match(topbar, /type="search"/);
  assert.match(topbar, /data-icon="search"/);
  assert.match(topbar, /<kbd[^>]*>\/<\/kbd>/);
  assert.match(cssSource, /\.topbar-search\s*\{[\s\S]*border-radius:\s*8px[\s\S]*background:\s*var\(--bg-soft\)[\s\S]*box-shadow:\s*none/);
  assert.match(cssSource, /\.topbar-search:focus-within\s*\{[\s\S]*background:/);
  const finalMobileBlock = cssSource.slice(cssSource.lastIndexOf("@media (max-width: 720px)"));
  assert.match(finalMobileBlock, /\.app-shell\s*\{[\s\S]*display:\s*block[\s\S]*padding-left:\s*0/);
  assert.match(finalMobileBlock, /\.topbar-search\s*\{[\s\S]*position:\s*static[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*transform:\s*none/);
  assert.match(finalMobileBlock, /\.topbar\s*\{[\s\S]*height:\s*auto[\s\S]*min-height:\s*62px[\s\S]*padding:\s*10px 16px/);
});

test("the topbar spans the viewport and pins search to its geometric center", () => {
  const viewportLayer = cssSource.slice(cssSource.lastIndexOf("/* Full-width NEKO topbar */"));
  const desktopViewportLayer = viewportLayer.slice(0, viewportLayer.indexOf("@media"));
  assert.match(desktopViewportLayer, /\.app-shell\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*1fr[\s\S]*padding-left:\s*0/);
  assert.match(desktopViewportLayer, /\.workspace-collapsed\.app-shell\s*\{[\s\S]*padding-left:\s*0/);
  assert.match(viewportLayer, /\.topbar\s*\{[\s\S]*position:\s*sticky[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*width:\s*100%/);
  assert.match(viewportLayer, /\.topbar-search\s*\{[\s\S]*position:\s*absolute[\s\S]*left:\s*50%[\s\S]*transform:\s*translateX\(-50%\)/);
  assert.match(viewportLayer, /\.topbar-brand\s*\{[\s\S]*justify-self:\s*start/);
  assert.match(viewportLayer, /\.top-actions\s*\{[\s\S]*justify-self:\s*end/);
  assert.doesNotMatch(viewportLayer, /\.topbar-search\s*\{[\s\S]*margin-left:\s*clamp/);
});

test("mobile topbar keeps the mode badge in the second explicit column", () => {
  const finalMobileBlock = cssSource.slice(cssSource.lastIndexOf("@media (max-width: 720px)"));
  assert.match(finalMobileBlock, /\.top-actions\s*\{[\s\S]*grid-column:\s*2/);
  assert.match(finalMobileBlock, /\.topbar-search\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1[\s\S]*width:\s*100%/);
});
