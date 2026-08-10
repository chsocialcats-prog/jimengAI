import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("冒险页状态与开局设定按钮使用整齐的表情标识", () => {
  assert.match(source, /<div class="detail-actions adventure-actions">/);
  assert.match(source, /class="btn btn-ghost btn-sm adventure-utility-btn" id="sidebar-toggle"><span class="button-emoji" aria-hidden="true">🧭<\/span><span>状态<\/span><\/button>/);
  assert.match(source, /class="btn btn-ghost btn-sm adventure-utility-btn" id="onboarding-review-btn"><span class="button-emoji" aria-hidden="true">✨<\/span><span>编辑开局设定<\/span><\/button>/);
});
