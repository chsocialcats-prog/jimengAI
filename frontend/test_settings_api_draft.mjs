import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("./js/data.mjs", import.meta.url), "utf8");

test("设置页保留本机 API Key 草稿，并用当前输入预览模型", () => {
  assert.match(dataSource, /const API_KEY_DRAFT_KEY = "adventure_api_key_draft"/);
  assert.match(dataSource, /localStorage\.setItem\(API_KEY_DRAFT_KEY, apiKey\)/);
  assert.match(dataSource, /request\("\/api\/models\/preview", \{ method: "POST", body: connection \}\)/);
  assert.match(source, /previewModels\(\{/);
  assert.match(source, /apiKeyInput\?\.addEventListener\("input"/);
});
