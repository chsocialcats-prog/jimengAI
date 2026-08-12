import assert from "node:assert/strict";
import test from "node:test";
import {
  cardSummaryText,
  orderedWorkCards,
  resolveSessionCards,
  workCardIds,
} from "./js/domain/role-cards.mjs";
import { readSource, sourceSection } from "./test_helpers.mjs";

const source = readSource("./js/main.js");
const adventureSource = readSource("./js/adventure-page.mjs");
const creatorSource = readSource("./js/creator-page.mjs");
const dataSource = readSource("./js/data.mjs");

function adventureRuntime({ conversation, workResult = null }) {
  const adventure = sourceSection(adventureSource, "async function renderAdventure", "function openAdventureOnboarding");
  const calls = { getWork: [], getWorldbook: [], navigate: [] };
  const backButton = { addEventListener(_type, handler) { this.handler = handler; } };
  const appEl = { innerHTML: "", addEventListener() {} };
  const factory = new Function(
    "MODE", "getConversation", "getWork", "getWorldbook", "getMessages", "getState", "getSnapshots",
    "resolveSessionCards", "cardSummaryText", "esc", "icon", "bindAdventureEvents",
    "renderMessages", "renderSidebar", "setStreamingUi", "scrollMessages", "REPLY_LENGTH_PRESETS", "loadReplyLength", "appEl", "$",
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
    () => {}, () => {}, () => {}, () => {}, () => {}, { detailed: { label: "详细", hint: "" } }, () => "detailed", appEl,
    (selector) => selector === "#back-btn" ? backButton : null,
  );
  return { runtime, calls, backButton };
}

test("legacy single-card work data normalizes to one ordered active card", () => {
  const cards = orderedWorkCards({ card_id: 9, card: { id: 9, name: "legacy" } });
  assert.deepEqual(cards.map((card) => card.name), ["legacy"]);
});

test("work cards follow card_ids order instead of response object order", () => {
  const cards = orderedWorkCards({
    card_ids: [2, 1],
    cards: [{ id: 1, name: "first" }, { id: 2, name: "second" }],
  });
  assert.deepEqual(cards.map((card) => card.name), ["second", "first"]);
});

test("work card_ids exclude response cards outside the selected IDs", () => {
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
  const cards = orderedWorkCards({
    card_ids: [],
    cards: [{ id: 1, name: "unexpected response card" }],
  });
  assert.deepEqual(cards, []);
});

test("work responses without card_ids keep cards as legacy fallback", () => {
  const cards = orderedWorkCards({
    cards: [{ id: 1, name: "legacy first" }, { id: 2, name: "legacy second" }],
  });
  assert.deepEqual(cards.map((card) => card.name), ["legacy first", "legacy second"]);
});

test("session resolution keeps frozen snapshots after live cards change", () => {
  const cards = resolveSessionCards(
    { card_snapshots: [{ id: 1, name: "frozen one" }, { id: 2, name: "frozen two" }] },
    { card_ids: [2, 1], cards: [{ id: 2, name: "live rename" }, { id: 1, name: "live other" }] }
  );
  assert.deepEqual(cards.map((card) => card.name), ["frozen one", "frozen two"]);
});

test("new no-card snapshots remain a valid no-character session", () => {
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
  const bindings = sourceSection(adventureSource, "function bindAdventureEvents", "async function openCorrectionModal");
  const onboarding = sourceSection(adventureSource, "async function renderOnboarding", "async function renderAdventure");
  assert.match(bindings, /session\.conv\.work_id\s*\?\s*`#\/work\/\$\{session\.conv\.work_id\}`\s*:\s*"#\/"/);
  assert.match(onboarding, /conversation\.work_id\s*\?\s*`#\/work\/\$\{conversation\.work_id\}`\s*:\s*"#\/"/);
});

test("adventure state and persona corrections consume resolved ordered session cards", () => {
  const adventure = sourceSection(adventureSource, "async function renderAdventure", "function openAdventureOnboarding");
  const correction = adventureSource.slice(adventureSource.indexOf("async function openCorrectionModal"));
  const createConversationSource = sourceSection(
    dataSource,
    "export async function createConversation",
    "export async function getConversation"
  );
  assert.match(adventure, /const cards = resolveSessionCards\(conv, work\);/);
  assert.match(adventure, /session = \{ conv, work, cards, card: cards\[0\] \|\| null,/);
  assert.match(correction, /session\.cards/);
  assert.match(correction, /flatMap\(\(card\)/);
  assert.match(createConversationSource, /const work = await getWork\(workId\);/);
  assert.match(creatorSource, /card_ids:\s*collectWorkCardIds\(\)/);
  assert.match(creatorSource, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
});

test("role-card editor hides player attributes while retaining legacy initial state on save", () => {
  const editor = sourceSection(source, "async function renderCardEditor", "async function renderSettings");
  const submit = sourceSection(source, "async function submitCardForm", "function bindCardEditorEvents");
  assert.doesNotMatch(editor, /id="attribute-rows"/);
  assert.doesNotMatch(editor, /id="add-attribute"/);
  assert.match(editor, /id="character-attribute-rows"/);
  assert.match(editor, /id="relation-rows"/);
  assert.match(submit, /\.\.\.cardEditorState\.initialState/);
  assert.doesNotMatch(submit, /attributes:\s*collectAttributeRows\("#attribute-rows"\)/);
});

test("script settings render script-level attribute rows with explicit empty clearing", () => {
  const creator = creatorSource;
  const fill = sourceSection(creatorSource, "function fillCreatorForm", "async function loadCreatorEditData");
  const submit = sourceSection(creatorSource, "async function submitCreatorForm", "function bindCreatorEvents");
  assert.match(creator, /id="player-attribute-rows"/);
  assert.match(creator, /id="add-player-attribute"/);
  assert.match(fill, /populateAttributeRows\("#player-attribute-rows", work\.player_attributes/);
  assert.match(submit, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
  assert.match(creatorSource, /if \(!key && !rawValue\) return;/);
  assert.match(creatorSource, /throw new Error\("属性名称不能为空"\)/);
  assert.match(creatorSource, /throw new Error\(`属性名称重复：\$\{key\}`\)/);
});

test("script settings manage unique role cards in visible order", () => {
  const creator = creatorSource;
  const bindings = sourceSection(creatorSource, "function bindCreatorEvents", "export async function renderCreator");
  assert.match(creator, /id="work-card-rows"/);
  assert.match(creator, /id="work-card-add"/);
  assert.match(creator, /id="add-work-card"/);
  assert.match(creatorSource, /function populateWorkCardRows\(cards = \[\], selectedIds = \[\]\)/);
  assert.match(creatorSource, /function collectWorkCardIds\(\)/);
  assert.match(creatorSource, /data-work-card-action="remove"/);
  assert.match(creatorSource, /data-work-card-action="up"/);
  assert.match(creatorSource, /data-work-card-action="down"/);
  assert.match(creatorSource, /availableCards = workCardOptions\.filter\(\(card\) => !selectedIds\.includes\(Number\(card\.id\)\)\)/);
  assert.match(bindings, /dataset\.workCardAction/);
});

test("legacy single-card scripts load as one card and save the multi-card API payload", () => {
  const creator = creatorSource;
  const submit = sourceSection(creatorSource, "async function submitCreatorForm", "function bindCreatorEvents");
  assert.deepEqual(workCardIds({ card_id: 3 }), [3]);
  assert.match(creator, /populateWorkCardRows\(cards, workCardIds\(editData\.work\)\)/);
  assert.match(submit, /card_ids:\s*collectWorkCardIds\(\)/);
  assert.match(submit, /player_attributes:\s*collectAttributeRows\("#player-attribute-rows"\)/);
  assert.doesNotMatch(submit, /card_id:/);
  assert.doesNotMatch(submit, /api\("\/api\/cards"/);
});

test("existing script loading keeps saving locked until work, cards, and selected card IDs initialize", () => {
  const creator = creatorSource;
  const submit = sourceSection(creatorSource, "async function submitCreatorForm", "function bindCreatorEvents");

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
  const references = sourceSection(source, "function referencedWorksForCard", "function referencedWorkNames");
  const editor = sourceSection(source, "async function renderCardEditor", "async function renderSettings");
  assert.match(references, /workCardIds\(work\)\.includes\(Number\(cardId\)\)/);
  assert.match(editor, /引用剧本：\$\{referenceNames\}/);
  assert.match(editor, /已经开始的旧会话不会改变/);
});
