import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");

test("冒险页不再展示或处理手动掷骰指令", () => {
  assert.doesNotMatch(source, /data-command="\/掷骰/);
  assert.doesNotMatch(source, /function evaluateDice\(/);
  assert.doesNotMatch(source, /\/掷骰 2d6\+2/);
});
