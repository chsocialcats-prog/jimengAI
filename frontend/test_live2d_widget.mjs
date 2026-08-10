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
