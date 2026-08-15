import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsViewModel } from "./js/settings-page.mjs";
import { ownershipMeta } from "./js/worldbook-page.mjs";
import { readFile } from "node:fs/promises";

const worldbookPageSource = await readFile(new URL("./js/worldbook-page.mjs", import.meta.url), "utf8");

test("设置视图只显示 API Key 状态，不把 Key 放入输入初值", () => {
  const model = buildSettingsViewModel({ deepseek: { api_key_set: true }, api_key_unreadable: false });
  assert.equal(model.apiKeyInputValue, "");
  assert.equal(model.apiKeyStatus, "已配置（不可读取）");
});

test("世界书所有权元数据完全由后端 can_edit 决定", () => {
  assert.deepEqual(ownershipMeta({ owner_username: "alice", can_edit: false }), {
    ownerLabel: "创建者：alice",
    canEdit: false,
    readOnly: true,
  });
});

test("世界书编辑器复用账户 API，并按 can_edit 管理条目", () => {
  assert.match(worldbookPageSource, /export async function renderWorldbookEditor/);
  assert.match(worldbookPageSource, /apiClient\.post\("\/api\/worldbooks"/);
  assert.match(worldbookPageSource, /apiClient\.put\(`\/api\/worldbooks\/\$\{encodedId\}`/);
  assert.match(worldbookPageSource, /apiClient\.post\(`\/api\/worldbooks\/\$\{encodeURIComponent\(savedId\)\}\/entries`/);
  assert.match(worldbookPageSource, /projectOwnership\(book\)\.canEdit/);
  assert.doesNotMatch(worldbookPageSource, /owner_username\s*===/);
});

test("世界书详情按概览和可扫描条目展示设定", () => {
  const detailStart = worldbookPageSource.indexOf("export async function renderWorldbookDetail");
  const editorStart = worldbookPageSource.indexOf("function entryDraftHtml", detailStart);
  const detail = worldbookPageSource.slice(detailStart, editorStart);
  for (const marker of ["resource-detail-overview", "世界观概览", "worldbook-detail-entry", "设定索引", "worldbook-entry-content"]) {
    assert.match(detail, new RegExp(marker));
  }
  assert.match(detail, /keywords\.map\(\(keyword\)/);
});
