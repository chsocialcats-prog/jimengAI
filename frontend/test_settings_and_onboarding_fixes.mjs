import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");

test("独立角色卡编辑器不提供初始数值关系编辑，并保留历史关系", () => {
  const start = source.indexOf("async function submitCardForm");
  const end = source.indexOf("async function renderCreator", start);
  const cardEditor = source.slice(start, end);
  assert.ok(start >= 0, "独立角色卡编辑器应存在");
  assert.doesNotMatch(cardEditor, /id="initial-relation-rows"/);
  assert.doesNotMatch(cardEditor, /collectNumericPairRows\("#initial-relation-rows"\)/);
  assert.match(cardEditor, /relations: cardEditorState\.initialState\?\.relations \|\| \{\}/);
});

test("保存其他设置时不会用空输入覆盖已保存的 API Key", () => {
  assert.match(source, /const apiKey = \$\("#cfg-key"\)\?\.value\.trim\(\) \|\| "";/);
  assert.match(
    source,
    /if \(apiKey\) \{[\s\S]*?body\.deepseek\.api_key = apiKey;[\s\S]*?\}/
  );
});

test("开局设定弹窗无论是否只读都能通过关闭按钮关闭", () => {
  assert.match(
    source,
    /modalRoot\?\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.target\.closest\("\[data-close\]"\)[\s\S]*?modalRoot\.innerHTML = "";/
  );
  const start = source.indexOf("function openAdventureOnboarding");
  const end = source.indexOf("function toggleStatusSidebar", start);
  const onboarding = source.slice(start, end);
  assert.match(onboarding, /type="button" data-close>关闭<\/button>/);
});
