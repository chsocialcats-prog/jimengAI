import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");

test("聊天消息会为状态变化按类型添加语义化样式", () => {
  assert.match(source, /export function messageTextHtml\(content\)/);
  assert.match(source, /export function stateChangeLineHtml\(line\)/);
  assert.match(source, /state-change-positive/);
  assert.match(source, /state-change-negative/);
  assert.match(source, /state-change-item-gain/);
  assert.match(source, /state-change-item-loss/);
  assert.match(source, /state-change-flag-add/);
  assert.match(source, /state-change-flag-remove/);
});

test("状态变化样式让数值增减使用粗斜体和不同颜色", () => {
  const css = readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
  assert.match(css, /\.state-change-positive[\s\S]*font-style:\s*italic/);
  assert.match(css, /\.state-change-positive[\s\S]*font-weight:\s*(?:700|800|900|bold)/);
  assert.match(css, /\.state-change-negative/);
  assert.match(css, /\.state-change-item-gain/);
  assert.match(css, /\.state-change-item-loss/);
});
