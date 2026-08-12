import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const adventureSource = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");

test("状态栏会渲染剧情角色的独立属性", () => {
  assert.match(adventureSource, /state\.characters/);
  assert.match(adventureSource, /剧情角色/);
  assert.match(adventureSource, /character-state-card/);
});

test("编辑器为剧情角色显示可编辑的默认属性", () => {
  assert.match(mainSource, /function defaultCharacterAttributes\(card = \{\}\)/);
  assert.match(mainSource, /心情: 50/);
  assert.match(mainSource, /好感度: Number\(relation\) \|\| 0/);
  assert.match(mainSource, /Object\.entries\(defaultCharacterAttributes\(card\)\)/);
  assert.match(mainSource, /addCharacterAttributeRow\("心情", 50\)/);
});
