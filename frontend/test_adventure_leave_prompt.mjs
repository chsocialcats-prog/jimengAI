import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const adventureSource = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");

test("冒险有未存档进度时提示保存后再离开", () => {
  assert.match(adventureSource, /export function hasUnsavedProgress\(\)/);
  assert.match(adventureSource, /export async function saveBeforeLeave/);
  assert.match(mainSource, /function requestAdventureLeave\(targetHash\)/);
  assert.match(mainSource, /先存档并离开/);
  assert.match(mainSource, /window\.addEventListener\("beforeunload", handleBeforeUnload\)/);
  assert.match(mainSource, /window\.addEventListener\("hashchange", handleHashChange\)/);
});

test("main 只查询冒险模块状态，模块离页时清理 app listener", () => {
  assert.doesNotMatch(mainSource, /let session\s*=/);
  assert.match(mainSource, /disposeAdventurePage\(\)/);
  assert.match(adventureSource, /appEl\.removeEventListener\("click", appClickHandler\)/);
  assert.match(adventureSource, /export function dispose\(\)/);
});
