import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("状态按钮在宽屏和窄屏都有可见的切换行为", () => {
  assert.match(source, /function toggleStatusSidebar\(\)/);
  assert.match(source, /shell\?\.classList\.toggle\("sidebar-collapsed"/);
  assert.match(source, /sidebar\.classList\.toggle\("desktop-hidden"/);
  assert.match(source, /\$\("#sidebar-toggle"\)\?\.addEventListener\("click", toggleStatusSidebar\)/);
});
