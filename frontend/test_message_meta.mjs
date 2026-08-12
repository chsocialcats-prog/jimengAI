import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { nowISO } from "./js/core/format.mjs";
import { messageMetaHtml, replyCharacterCount } from "./js/adventure-page.mjs";

const adventureJs = fs.readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./css/style.css", import.meta.url), "utf8");

function extractFunctionSource(signature) {
  const start = adventureJs.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should be defined`);
  const bodyStart = adventureJs.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${signature} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < adventureJs.length; index += 1) {
    if (adventureJs[index] === "{") depth += 1;
    if (adventureJs[index] === "}" && --depth === 0) {
      return adventureJs.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${signature}`);
}

test("回复字数忽略空白但保留中文标点", () => {
  assert.equal(replyCharacterCount("  你好，\n世界！  "), 6);
  assert.equal(replyCharacterCount("a b\nc"), 3);
});

test("发送时间使用本地时间而不是 UTC 时间", () => {
  class FakeDate {
    toISOString() { return "2026-08-11T14:18:00.000Z"; }
    getFullYear() { return 2026; }
    getMonth() { return 7; }
    getDate() { return 11; }
    getHours() { return 22; }
    getMinutes() { return 18; }
    getSeconds() { return 0; }
  }
  const OriginalDate = globalThis.Date;
  globalThis.Date = FakeDate;
  try {
    assert.equal(nowISO(), "2026-08-11 22:18:00");
  } finally {
    globalThis.Date = OriginalDate;
  }
});

test("AI 元信息包含时间和字数且不使用圆点分隔", () => {
  const html = messageMetaHtml({
    role: "assistant",
    content: "你好！",
    created_at: "2026-08-11 14:18:00",
  });

  assert.match(html, /class="message-meta"/);
  assert.match(html, /14:18/);
  assert.match(html, /3 字/);
  assert.doesNotMatch(html, /·/);
});

test("用户和系统消息不生成回复元信息", () => {
  const base = { content: "不应显示", created_at: "2026-08-11 14:18:00" };

  assert.equal(messageMetaHtml({ ...base, role: "user" }), "");
  assert.equal(messageMetaHtml({ ...base, role: "system" }), "");
});

test("消息渲染和流式完成逻辑接入元信息", () => {
  const messageSource = extractFunctionSource("function messageHtml(");
  const sendSource = extractFunctionSource("async function sendMessage(");
  const deltaIndex = sendSource.indexOf("onDelta:");
  const metaIndex = sendSource.indexOf("messageMetaHtml(assistantMessage)");

  assert.match(messageSource, /messageMetaHtml\(message\)/);
  assert.notEqual(deltaIndex, -1, "streaming delta handler should exist");
  assert.notEqual(metaIndex, -1, "completion should append metadata");
  assert.ok(metaIndex > deltaIndex, "metadata should be appended after streaming starts");
});

test("元信息栏右对齐、间距明显且使用小号字体", () => {
  assert.match(css, /\.message-meta\s*\{[\s\S]*justify-content:\s*flex-end/);
  assert.match(css, /\.message-meta\s*\{[\s\S]*gap:\s*(?:1[2-9]|[2-9][0-9])px/);
  assert.match(css, /\.message-meta\s*\{[\s\S]*font-size:\s*1[01]px/);
});
