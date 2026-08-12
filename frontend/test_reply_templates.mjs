import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMockReplyTemplateFields } from "./js/data.mjs";
import { readSource, sourceSection } from "./test_helpers.mjs";

const mainJs = readSource("./js/main.js");
const adventureJs = readSource("./js/adventure-page.mjs");
const creatorSource = readSource("./js/creator-page.mjs");
const css = readSource("./css/style.css");

function extractFunction(name) {
  const start = mainJs.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const bodyStart = mainJs.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < mainJs.length; index += 1) {
    if (mainJs[index] === "{") depth += 1;
    if (mainJs[index] === "}" && --depth === 0) {
      return new Function(`${mainJs.slice(start, index + 1)}; return ${name};`)();
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test("作品编辑器提供多模板编辑和当前模板选择", () => {
  assert.match(creatorSource, /reply-template-rows/);
  assert.match(creatorSource, /add-reply-template/);
  assert.match(creatorSource, /active_reply_template_id/);
  assert.match(creatorSource, /function addReplyTemplateCard\(template = \{\}\)/);
  assert.match(creatorSource, /function collectReplyTemplates\(\)/);
  assert.match(css, /reply-template-card/);
});

test("模板字段会进入创建和更新作品请求", () => {
  assert.match(creatorSource, /reply_templates/);
  assert.match(creatorSource, /active_reply_template_id/);
  assert.match(creatorSource, /collectReplyTemplates\(\)/);
});

test("离线作品上载会补齐并验证回复模板字段", () => {
  const normalize = normalizeMockReplyTemplateFields;

  assert.deepEqual(normalize({ id: 1 }), {
    id: 1,
    reply_templates: [],
    active_reply_template_id: "",
  });
  assert.deepEqual(
    normalize({
      id: 2,
      reply_templates: [{ id: "kept", name: "保留", content: "body"}],
      active_reply_template_id: "missing",
    }),
    {
      id: 2,
      reply_templates: [{ id: "kept", name: "保留", content: "body"}],
      active_reply_template_id: "",
    },
  );
  assert.equal(
    normalize({
      reply_templates: [{ id: "kept", name: "保留", content: "body"}],
      active_reply_template_id: "kept",
    }).active_reply_template_id,
    "kept",
  );
});

test("作品编辑器可以显式禁用模板并提交空活动 ID", () => {
  assert.match(creatorSource, /id="disable-reply-template"/);
  assert.match(creatorSource, /不启用模板/);
  assert.match(creatorSource, /function selectedReplyTemplateId\(\)/);
  assert.match(creatorSource, /active_reply_template_id:\s*selectedReplyTemplateId\(\)/);
  assert.match(creatorSource, /disable-reply-template[\s\S]*return ""/);
});

test("聊天渲染区域没有模板切换控件", () => {
  const adventureSource = sourceSection(adventureJs, "async function renderAdventure", "function openAdventureOnboarding");
  assert.doesNotMatch(adventureSource, /reply-template-rows|add-reply-template|reply-template-card/);
});
