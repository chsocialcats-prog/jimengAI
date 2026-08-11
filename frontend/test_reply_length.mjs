import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainJs = fs.readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const helperStart = mainJs.indexOf("const REPLY_LENGTH_PRESETS =");
const helperEnd = mainJs.indexOf("\n\nmodalRoot?.addEventListener", helperStart);
assert.notEqual(helperStart, -1, "reply length helpers should be defined");
assert.notEqual(helperEnd, -1, "reply length helper block should be complete");
const helperSource = mainJs.slice(helperStart, helperEnd);

function loadHelpers() {
  return new Function(`${helperSource}; return { REPLY_LENGTH_PRESETS, DEFAULT_REPLY_LENGTH, normalizeReplyLength, replyLengthStorageKey, loadReplyLength, saveReplyLength };`)();
}

test("回复长度助手提供四档选项并将未知值归一化为详细", () => {
  const { REPLY_LENGTH_PRESETS, DEFAULT_REPLY_LENGTH, normalizeReplyLength } = loadHelpers();

  assert.deepEqual(Object.keys(REPLY_LENGTH_PRESETS), ["short", "standard", "detailed", "long"]);
  assert.equal(DEFAULT_REPLY_LENGTH, "detailed");
  assert.equal(normalizeReplyLength("long"), "long");
  assert.equal(normalizeReplyLength("unknown"), "detailed");
  assert.equal(normalizeReplyLength(null), "detailed");
});

test("回复长度偏好按会话分别保存和读取", () => {
  const { loadReplyLength, replyLengthStorageKey, saveReplyLength } = loadHelpers();
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
