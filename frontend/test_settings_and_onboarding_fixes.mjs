import assert from "node:assert/strict";
import test from "node:test";
import { readSource, sourceSection } from "./test_helpers.mjs";

const source = readSource("./js/main.js");
const adventureSource = readSource("./js/adventure-page.mjs");

test("独立角色卡编辑器不提供初始数值关系编辑，并保留历史关系", () => {
  const cardEditor = sourceSection(source, "async function submitCardForm", "async function renderSettings");
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
  const onboarding = sourceSection(adventureSource, "function openAdventureOnboarding", "function toggleStatusSidebar");
  assert.match(onboarding, /type="button" data-close>关闭<\/button>/);
});
