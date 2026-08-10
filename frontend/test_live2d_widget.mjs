import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
const loaderSource = readFileSync(new URL("./vendor/live2d-widget/autoload.js", import.meta.url), "utf8");
const modelCatalog = JSON.parse(readFileSync(new URL("./vendor/live2d-models/models.json", import.meta.url), "utf8"));
const localLoaderUrl = "vendor/live2d-widget/autoload.js";

test("loads one local Live2D autoloader after the app module", () => {
  assert.equal(indexSource.split('id="live2d-widget-loader"').length - 1, 1);
  assert.equal(indexSource.split(localLoaderUrl).length - 1, 1);
  const appScriptIndex = indexSource.indexOf('src="js/main.js?v=options-2"');
  const widgetScriptIndex = indexSource.indexOf('id="live2d-widget-loader"');
  assert.ok(appScriptIndex >= 0);
  assert.ok(widgetScriptIndex > appScriptIndex);
  assert.equal(indexSource.includes("showToggleAfterQuit: false"), false);
  assert.equal(indexSource.includes("fastly.jsdelivr.net"), false);
});

test("keeps the widget runtime and model catalog local", () => {
  assert.match(loaderSource, /waifu-tips\.js/);
  assert.match(loaderSource, /waifu-tips\.json/);
  assert.match(loaderSource, /models\.json/);
  assert.match(loaderSource, /live2d\.min\.js/);
  assert.match(loaderSource, /showToggleAfterQuit:\s*true/);
  assert.doesNotMatch(loaderSource, /cubism\.live2d\.com|fastly\.jsdelivr\.net/);
  assert.ok(Array.isArray(modelCatalog.models));
  assert.ok(modelCatalog.models.length >= 6);
  for (const model of modelCatalog.models) {
    assert.equal(typeof model.name, "string");
    assert.equal(model.paths.length, 1);
    assert.match(model.paths[0], /^\/vendor\/live2d-models\/.+\.model\.json$/);
    assert.equal(existsSync(new URL(`.${model.paths[0]}`, import.meta.url)), true);
  }
  assert.match(readFileSync(new URL("./vendor/live2d-models/model.index", import.meta.url), "utf8"), /raw\.githubusercontent\.com/);
});

test("adds layout rules for the local Widget", () => {
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
