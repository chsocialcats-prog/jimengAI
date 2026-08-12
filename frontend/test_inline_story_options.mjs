import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("./js/data.mjs", import.meta.url), "utf8");

test("AI 回复中的剧情选项以内嵌按钮呈现并可直接发送", () => {
  assert.match(source, /function messageOptionsHtml\(aiText, explicitOptions/);
  assert.match(source, /function extractImplicitOptions\(text\)/);
  assert.match(source, /class="message-options"/);
  assert.match(source, /bindMessageOptionEvents\(list\)/);
  assert.match(source, /bindMessageOptionEvents\(messageText\.closest\("\.message"\)\)/);
  assert.match(source, /sendMessage\(value\)/);
});

test("结构化选项优先显示，并兼容编号和加粗标题", () => {
  assert.match(source, /function messageOptionsHtml\(aiText, explicitOptions/);
  assert.match(source, /data\.options/);
  assert.ok(source.includes(String.raw`\d+[.)、．]`));
  assert.match(source, /streamOptions/);
});

test("流式响应结束时会处理没有换行的最后一个 SSE 事件", () => {
  assert.match(dataSource, /if \(done\) \{[\s\S]*?buffer\.split\(\/\\r\?\\n\/\)\.forEach\(processSseLine\)/);
});
