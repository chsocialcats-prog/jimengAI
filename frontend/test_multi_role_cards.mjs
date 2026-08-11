import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./js/main.js", import.meta.url), "utf8");

function cardResolutionRuntime() {
  const start = source.indexOf("function isRoleCard");
  const end = source.indexOf("function workCardHtml", start);
  assert.ok(start >= 0, "missing multi-card resolution helpers");
  assert.ok(end > start, "missing work-card rendering boundary");
  return new Function(`${source.slice(start, end)}\nreturn { orderedWorkCards, resolveSessionCards, cardSummaryText };`)();
}

function adventureRuntime({ conversation, workResult = null }) {
  const adventure = sliceBetween("async function renderAdventure", "function openAdventureOnboarding");
  const calls = { getWork: [], getWorldbook: [], navigate: [] };
  const backButton = { addEventListener(_type, handler) { this.handler = handler; } };
  const appEl = { innerHTML: "", addEventListener() {} };
  const factory = new Function(
    "MODE", "api", "getWork", "getWorldbook", "getMessages", "getState", "getSnapshots",
    "resolveSessionCards", "cardSummaryText", "esc", "icon", "bindAdventureEvents",
    "renderMessages", "renderSidebar", "setStreamingUi", "scrollMessages", "appEl", "$",
    `let session;\n${adventure}\nreturn { renderAdventure, getSession: () => session };`
  );
  const runtime = factory(
    "online",
    async () => conversation,
    async (id) => { calls.getWork.push(id); return workResult; },
    async (id) => { calls.getWorldbook.push(id); return { id, description: "frozen world" }; },
    async () => [], async () => ({}), async () => [],
    (conv, work) => Array.isArray(conv.card_snapshots) ? conv.card_snapshots : (work?.cards || []),
    (cards) => cards.map((card) => card.name).join(", "),
    (value) => String(value ?? ""), () => "",
    () => {}, () => {}, () => {}, () => {}, () => {}, appEl,
    (selector) => selector === "#back-btn" ? backButton : null,
  );
  return { runtime, calls, backButton };
}

test("legacy single-card work data normalizes to one ordered active card", () => {
  const { orderedWorkCards } = cardResolutionRuntime();
  const cards = orderedWorkCards({ card_id: 9, card: { id: 9, name: "legacy" } });
  assert.deepEqual(cards.map((card) => card.name), ["legacy"]);
});

test("work cards follow card_ids order instead of response object order", () => {
  const { orderedWorkCards } = cardResolutionRuntime();
  const cards = orderedWorkCards({
    card_ids: [2, 1],
    cards: [{ id: 1, name: "first" }, { id: 2, name: "second" }],
  });
  assert.deepEqual(cards.map((card) => card.name), ["second", "first"]);
});

test("work card_ids exclude response cards outside the selected IDs", () => {
  const { orderedWorkCards } = cardResolutionRuntime();
  const cards = orderedWorkCards({
    card_ids: [2],
    cards: [
      { id: 1, name: "extra first" },
      { id: 2, name: "selected" },
      { id: 3, name: "extra last" },
    ],
  });
  assert.deepEqual(cards.map((card) => card.name), ["selected"]);
});

test("explicit empty work card_ids select no cards despite response cards", () => {
  const { orderedWorkCards } = cardResolutionRuntime();
  const cards = orderedWorkCards({
    card_ids: [],
    cards: [{ id: 1, name: "unexpected response card" }],
  });
  assert.deepEqual(cards, []);
});

test("work responses without card_ids keep cards as legacy fallback", () => {
  const { orderedWorkCards } = cardResolutionRuntime();
  const cards = orderedWorkCards({
    cards: [{ id: 1, name: "legacy first" }, { id: 2, name: "legacy second" }],
  });
  assert.deepEqual(cards.map((card) => card.name), ["legacy first", "legacy second"]);
});

test("session resolution keeps frozen snapshots after live cards change", () => {
  const { resolveSessionCards } = cardResolutionRuntime();
  const cards = resolveSessionCards(
    { card_snapshots: [{ id: 1, name: "frozen one" }, { id: 2, name: "frozen two" }] },
    { card_ids: [2, 1], cards: [{ id: 2, name: "live rename" }, { id: 1, name: "live other" }] }
  );
  assert.deepEqual(cards.map((card) => card.name), ["frozen one", "frozen two"]);
});

test("new no-card snapshots remain a valid no-character session", () => {
  const { resolveSessionCards, cardSummaryText } = cardResolutionRuntime();
  const cards = resolveSessionCards(
    { card_snapshots: [] },
    { card_ids: [1], cards: [{ id: 1, name: "later card" }] }
  );
  assert.deepEqual(cards, []);
  assert.equal(cardSummaryText(cards), "暂无角色");
});

test("online historical session without a work uses its frozen cards and conversation worldbook", async () => {
  const { runtime, calls } = adventureRuntime({
    conversation: {
      id: 71,
      title: "orphaned history",
      work_id: null,
      worldbook_id: 88,
      card_snapshots: [{ id: 3, name: "frozen card" }],
    },
  });

  await runtime.renderAdventure(71);

  assert.deepEqual(calls.getWork, []);
  assert.deepEqual(calls.getWorldbook, [88]);
  assert.deepEqual(runtime.getSession().cards.map((card) => card.name), ["frozen card"]);
  assert.equal(runtime.getSession().work, null);
});

test("adventure and onboarding return links avoid a null work route", () => {
  const bindings = sliceBetween("function bindAdventureEvents", "async function openCorrectionModal");
  const onboarding = sliceBetween("async function renderOnboarding", "async function renderAdventure");
  assert.match(bindings, /session\.conv\.work_id\s*\?\s*`#\/work\/\$\{session\.conv\.work_id\}`\s*:\s*"#\/"/);
  assert.match(onboarding, /conversation\.work_id\s*\?\s*`#\/work\/\$\{conversation\.work_id\}`\s*:\s*"#\/"/);
});

test("adventure state and persona corrections consume resolved ordered session cards", () => {
  const adventure = sliceBetween("async function renderAdventure", "function openAdventureOnboarding");
  const correction = sliceBetween("async function openCorrectionModal", "function addDynamicRow");
  const createConversationSource = sliceBetween("async function createConversation", "async function listConversations");
  assert.match(adventure, /const cards = resolveSessionCards\(conv, work\);/);
  assert.match(adventure, /session = \{ conv, work, cards, card: cards\[0\] \|\| null,/);
  assert.match(correction, /session\.cards/);
  assert.match(correction, /flatMap\(\(card\)/);
  assert.match(createConversationSource, /const work = await getWork\(workId\);/);
  assert.match(source, /card_ids:\s*collectWorkCardIds\(\)/);
  assert.match(source, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
});

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("role-card editor hides player attributes while retaining legacy initial state on save", () => {
  const editor = sliceBetween("async function renderCardEditor", "async function renderCreator");
  const submit = sliceBetween("async function submitCardForm", "function bindCardEditorEvents");
  assert.doesNotMatch(editor, /id="attribute-rows"/);
  assert.doesNotMatch(editor, /id="add-attribute"/);
  assert.match(editor, /id="character-attribute-rows"/);
  assert.match(editor, /id="relation-rows"/);
  assert.match(submit, /\.\.\.cardEditorState\.initialState/);
  assert.doesNotMatch(submit, /attributes:\s*collectAttributeRows\("#attribute-rows"\)/);
});

test("script settings render script-level attribute rows with explicit empty clearing", () => {
  const creator = sliceBetween("async function renderCreator", "async function renderSettings");
  const fill = sliceBetween("function fillCreatorForm", "async function loadCreatorEditData");
  const submit = sliceBetween("async function submitCreatorForm", "function bindCreatorEvents");
  assert.match(creator, /id="player-attribute-rows"/);
  assert.match(creator, /id="add-player-attribute"/);
  assert.match(fill, /populateAttributeRows\("#player-attribute-rows", work\.player_attributes/);
  assert.match(submit, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
  assert.match(source, /if \(!key && !rawValue\) return;/);
  assert.match(source, /throw new Error\("属性名称不能为空"\)/);
  assert.match(source, /throw new Error\(`属性名称重复：\$\{key\}`\)/);
});

test("script settings manage unique role cards in visible order", () => {
  const creator = sliceBetween("async function renderCreator", "async function renderSettings");
  const bindings = sliceBetween("function bindCreatorEvents", "function referencedWorksForCard");
  assert.match(creator, /id="work-card-rows"/);
  assert.match(creator, /id="work-card-add"/);
  assert.match(creator, /id="add-work-card"/);
  assert.match(source, /function populateWorkCardRows\(cards = \[\], selectedIds = \[\]\)/);
  assert.match(source, /function collectWorkCardIds\(\)/);
  assert.match(source, /data-work-card-action="remove"/);
  assert.match(source, /data-work-card-action="up"/);
  assert.match(source, /data-work-card-action="down"/);
  assert.match(source, /availableCards = workCardOptions\.filter\(\(card\) => !selectedIds\.includes\(Number\(card\.id\)\)\)/);
  assert.match(bindings, /dataset\.workCardAction/);
});

test("legacy single-card scripts load as one card and save the multi-card API payload", () => {
  const creator = sliceBetween("async function renderCreator", "async function renderSettings");
  const submit = sliceBetween("async function submitCreatorForm", "function bindCreatorEvents");
  assert.match(source, /function workCardIds\(work = \{\}\)/);
  assert.match(creator, /populateWorkCardRows\(cards, workCardIds\(editData\.work\)\)/);
  assert.match(submit, /card_ids:\s*collectWorkCardIds\(\)/);
  assert.match(submit, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
  assert.doesNotMatch(submit, /card_id:/);
  assert.doesNotMatch(submit, /api\("\/api\/cards"/);
});

test("existing script loading keeps saving locked until work, cards, and selected card IDs initialize", () => {
  const creator = sliceBetween("async function renderCreator", "async function renderSettings");
  const submit = sliceBetween("async function submitCreatorForm", "function bindCreatorEvents");

  assert.match(creator, /id="creator-save-btn"[^>]* disabled/);
  assert.match(creator, /const \[editDataResult, cardsResult\] = await Promise\.allSettled\(\[/);
  assert.match(creator, /loadCreatorEditData\(workId\),\s*listAllCards\(\),/);
  assert.match(creator, /if \(editDataResult\.status === "fulfilled"\) \{[\s\S]*fillCreatorForm\(editData\);/);
  assert.match(creator, /if \(cardsResult\.status === "fulfilled" && editData\) \{[\s\S]*areWorkCardIdsAvailable\(editData\.work, cards\)/);
  assert.match(creator, /setCreatorEditSaveEnabled\(true\)/);
  assert.match(creator, /setCreatorEditSaveEnabled\(false\)/);
  assert.match(creator, /无法加载角色卡列表/);
  assert.match(submit, /if \(creatorEditWorkId && !creatorEditState\) \{[\s\S]*return;/);
});

test("referenced-card warnings include scripts using a non-first selected card", () => {
  const references = sliceBetween("function referencedWorksForCard", "function referencedWorkNames");
  const editor = sliceBetween("async function renderCardEditor", "async function renderCreator");
  assert.match(references, /workCardIds\(work\)\.includes\(Number\(cardId\)\)/);
  assert.match(editor, /引用剧本：\$\{referenceNames\}/);
  assert.match(editor, /已经开始的旧会话不会改变/);
});
