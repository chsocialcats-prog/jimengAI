import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("状态栏会渲染剧情角色的独立属性", () => {
  assert.match(source, /state\.characters/);
  assert.match(source, /剧情角色/);
  assert.match(source, /character-state-card/);
});

test("编辑器为剧情角色显示可编辑的默认属性", () => {
  assert.match(source, /function defaultCharacterAttributes\(card = \{\}\)/);
  assert.match(source, /心情: 50/);
  assert.match(source, /好感度: Number\(relation\) \|\| 0/);
  assert.match(source, /Object\.entries\(defaultCharacterAttributes\(card\)\)/);
  assert.match(source, /addCharacterAttributeRow\("心情", 50\)/);
});
