import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("剧本编辑器提供封面链接与本地上传入口", () => {
  assert.match(source, /id="work-cover-url"/);
  assert.match(source, /id="work-cover-file"/);
  assert.match(source, /function coverHtml\(/);
});
