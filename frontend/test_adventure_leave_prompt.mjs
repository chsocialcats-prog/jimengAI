import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("冒险有未存档进度时提示保存后再离开", () => {
  assert.match(source, /function hasUnsavedAdventureProgress\(\)/);
  assert.match(source, /function requestAdventureLeave\(targetHash\)/);
  assert.match(source, /先存档并离开/);
  assert.match(source, /window\.addEventListener\("beforeunload", handleBeforeUnload\)/);
  assert.match(source, /window\.addEventListener\("hashchange", handleHashChange\)/);
});
