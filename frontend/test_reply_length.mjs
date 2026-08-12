import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_REPLY_LENGTH,
  REPLY_LENGTH_PRESETS,
  loadReplyLength,
  normalizeReplyLength,
  replyLengthStorageKey,
  saveReplyLength,
} from "./js/chat/reply-length.mjs";

const mainJs = fs.readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const adventureJs = fs.readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");
const dataJs = fs.readFileSync(new URL("./js/data.mjs", import.meta.url), "utf8");

function extractFunctionSource(signature, source = adventureJs) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should be defined`);
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${signature}`);
}

test("回复长度助手提供四档选项并将未知值归一化为详细", () => {
  assert.deepEqual(Object.keys(REPLY_LENGTH_PRESETS), ["short", "standard", "detailed", "long"]);
  assert.equal(DEFAULT_REPLY_LENGTH, "detailed");
  assert.equal(normalizeReplyLength("long"), "long");
  assert.equal(normalizeReplyLength("unknown"), "detailed");
  assert.equal(normalizeReplyLength(null), "detailed");
});

test("回复长度偏好按会话分别保存和读取", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };

  assert.equal(replyLengthStorageKey("conversation-a"), "adventure_reply_length:conversation-a");
  assert.equal(loadReplyLength("conversation-a", storage), "detailed");
  saveReplyLength("conversation-a", "long", storage);
  saveReplyLength("conversation-b", "short", storage);
  assert.equal(loadReplyLength("conversation-a", storage), "long");
  assert.equal(loadReplyLength("conversation-b", storage), "short");
});

test("在线请求携带当前会话的回复长度，离线分支保持原样", () => {
  const streamSource = extractFunctionSource("export async function streamChat(", dataJs);

  assert.match(streamSource, /async function streamChat\(conversationId, content, handlers, metadata = \{\}\)/);
  assert.match(streamSource, /if \(MODE === "offline"\)/);
  assert.match(streamSource, /JSON\.stringify\(\{ content, metadata \}\)/);
});

test("回复长度选择器只在在线聊天页渲染", () => {
  const adventureSource = extractFunctionSource("async function renderAdventure(");

  assert.match(adventureSource, /MODE === "online" \? loadReplyLength\(conv\.id\) : null/);
  assert.match(adventureSource, /id="reply-length-select"/);
  assert.match(adventureSource, /MODE === "online" \?/);
  assert.match(adventureSource, /REPLY_LENGTH_PRESETS/);
});

test("选择器会持久化选择、在流式回复时禁用，并随请求发送", () => {
  const adventureSource = extractFunctionSource("async function renderAdventure(");
  const bindSource = extractFunctionSource("function bindAdventureEvents(");
  const sendSource = extractFunctionSource("async function sendMessage(");
  const streamingUiSource = extractFunctionSource("function setStreamingUi(");
  const css = fs.readFileSync(new URL("./css/style.css", import.meta.url), "utf8");

  assert.match(adventureSource, /session\.replyLength/);
  assert.match(bindSource, /saveReplyLength\(session\.conv\.id/);
  assert.match(streamingUiSource, /reply-length-select/);
  assert.match(streamingUiSource, /disabled = streaming/);
  assert.match(sendSource, /reply_length:\s*activeSession\.replyLength/);
  assert.match(css, /\.reply-length-control/);
});
