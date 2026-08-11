import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const indexHtml = await readFile(new URL("./index.html", import.meta.url), "utf8");
const mainJs = await readFile(new URL("./js/main.js", import.meta.url), "utf8");

test("top navigation exposes the role-card library", () => {
  assert.match(indexHtml, /<a href="#\/cards" data-nav="cards" data-icon="users">角色卡<\/a>/);
});

test("role cards have independent offline storage and CRUD helpers", () => {
  assert.match(mainJs, /let mockCards = \[\];/);
  assert.match(mainJs, /cards: mockCards/);
  assert.match(mainJs, /async function listCards\(query = ""\)/);
  assert.match(mainJs, /async function createCard\(payload\)/);
  assert.match(mainJs, /async function updateCard\(id, payload\)/);
  assert.match(mainJs, /async function deleteCard\(id\)/);
  assert.match(mainJs, /function mockListCards\(query = ""\)/);
  assert.match(mainJs, /mockWorks = JSON\.parse\(JSON\.stringify\(DEFAULT_MOCK_WORKS\)\);\s*mockCards = deriveMockCards\(mockWorks\);\s*saveMockData\(\);/);
});

test("role-card routes distinguish the library, new editor, and existing editor", () => {
  assert.match(mainJs, /if \(name === "cards"\) return \{ name: "cards" \};/);
  assert.match(mainJs, /if \(name === "card" && id === "new"\) return \{ name: "card", id: null \};/);
  assert.match(mainJs, /if \(name === "card" && id\) return \{ name: "card", id: Number\(id\) \};/);
  assert.match(mainJs, /current\.name === "cards"\s*\|\|\s*current\.name === "card"/);
  assert.match(mainJs, /current\.name === "cards"\) await renderCards\(\)/);
  assert.match(mainJs, /current\.name === "card"\) await renderCardEditor\(current\.id\)/);
});

test("script saves keep ordered role-card references without synchronizing card content", () => {
  const saveStart = mainJs.indexOf("async function saveCreatorEdit");
  const bindStart = mainJs.indexOf("function bindCreatorEvents", saveStart);
  const creatorSave = mainJs.slice(saveStart, bindStart);
  assert.match(creatorSave, /card_ids: collectWorkCardIds\(\)/);
  assert.match(creatorSave, /player_attributes: collectAttributeRows\("#player-attribute-rows"\)/);
  assert.doesNotMatch(creatorSave, /syncMockCard\(card/);
  assert.doesNotMatch(creatorSave, /api\("\/api\/cards"/);
  assert.doesNotMatch(creatorSave, /api\(`\/api\/cards\/\$\{/);
});

test("role-card library provides search, reference metadata, and CRUD actions", () => {
  assert.match(mainJs, /function referencedWorksForCard\(cardId, works\)/);
  assert.match(mainJs, /workCardIds\(work\)\.includes\(Number\(cardId\)\)/);
  assert.match(mainJs, /async function renderCards\(\)/);
  assert.match(mainJs, /async function renderCardResults\(\)/);
  assert.match(mainJs, /id="card-library-search"/);
  assert.match(mainJs, /id="card-library-results"/);
  assert.match(mainJs, /data-card-action="create"/);
  assert.match(mainJs, /data-card-action="edit"/);
  assert.match(mainJs, /data-card-action="delete"/);
  assert.match(mainJs, /function bindCardsEvents\(\)/);
  const bindStart = mainJs.indexOf("function bindCardsEvents");
  const bindEnd = mainJs.indexOf("function fillCardForm", bindStart);
  const bindSource = mainJs.slice(bindStart, bindEnd);
  assert.doesNotMatch(bindSource, /renderCards\(\)/);
  assert.match(bindSource, /renderCardResults\(\)/);
});

test("independent role-card editor keeps role fields, hidden legacy state, and future-session warning", () => {
  assert.match(mainJs, /async function renderCardEditor\(cardId = null\)/);
  assert.match(mainJs, /function fillCardForm\(card(?:, [^)]*)?\)/);
  assert.match(mainJs, /async function submitCardForm\(\)/);
  for (const selector of ["card-name", "card-persona", "card-personality", "card-speaking", "directive-rows", "character-attribute-rows", "relation-rows"]) {
    assert.match(mainJs, new RegExp(`id="${selector}"`));
  }
  assert.match(mainJs, /此角色卡已被 \$\{references\.length\} 个剧本引用，保存后会影响这些剧本之后新开的会话；已经开始的旧会话不会改变。/);
  assert.match(mainJs, /relations: cardEditorState\.initialState\?\.relations \|\| \{\}/);
  assert.match(mainJs, /fillCardForm\(\s*\{ \.\.\.importedCard, id: cardEditorState\.cardId \},/);
});

test("referenced-card warnings and save confirmations identify every affected script safely", () => {
  assert.match(mainJs, /function referencedWorkNames\(references = \[\]\)/);
  assert.match(mainJs, /function referencedWorkNamesHtml\(references = \[\]\)/);
  assert.match(mainJs, /referencedWorkNames\(references\)\.map\(esc\)\.join\("、"\)/);

  const submitStart = mainJs.indexOf("async function submitCardForm");
  const bindStart = mainJs.indexOf("function bindCardEditorEvents", submitStart);
  const submit = mainJs.slice(submitStart, bindStart);
  assert.match(submit, /const referenceNames = referencedWorkNames\(references\)\.join\("、"\);/);
  assert.match(submit, /引用剧本：\$\{referenceNames\}/);

  const editorStart = mainJs.indexOf("async function renderCardEditor");
  const creatorStart = mainJs.indexOf("async function renderCreator", editorStart);
  const editor = mainJs.slice(editorStart, creatorStart);
  assert.match(editor, /const referenceNames = referencedWorkNamesHtml\(references\);/);
  assert.match(editor, /warning\.innerHTML = `此角色卡已被 \$\{references\.length\} 个剧本引用.*引用剧本：\$\{referenceNames\}/s);
});

test("role-card cards show source and a personality-first summary", () => {
  assert.match(mainJs, /function cardPersonalitySummary\(card,/);
  assert.match(mainJs, /return card\?\.personality \|\| card\?\.persona \|\| fallback;/);
  const resultsStart = mainJs.indexOf("async function renderCardResults");
  const bindingsStart = mainJs.indexOf("function bindCardsEvents", resultsStart);
  const results = mainJs.slice(resultsStart, bindingsStart);
  assert.match(results, /esc\(cardPersonalitySummary\(card\)\)/);
  assert.match(results, /来源：\$\{esc\(card\.source \|\| "未标注来源"\)\}/);
});

test("script editor manages existing role cards and submits ordered ids", () => {
  const creatorStart = mainJs.indexOf("async function renderCreator");
  const creatorEnd = mainJs.indexOf("async function renderSettings", creatorStart);
  const creator = mainJs.slice(creatorStart, creatorEnd);
  assert.match(creator, /id="work-card-rows"/);
  assert.match(creator, /不使用角色卡/);
  assert.match(mainJs, /function populateWorkCardRows\(/);

  const submitStart = mainJs.indexOf("async function submitCreatorForm");
  const submitEnd = mainJs.indexOf("function bindCreatorEvents", submitStart);
  const submit = mainJs.slice(submitStart, submitEnd);
  assert.match(submit, /card_ids/);
  assert.match(submit, /player_attributes/);
  assert.doesNotMatch(submit, /api\("\/api\/cards"/);
  assert.doesNotMatch(submit, /api\(`\/api\/cards\/\$\{/);
});

test("script selector summary looks up the selected card and includes its personality or persona", () => {
  assert.match(mainJs, /let workCardOptions = \[\];/);
  const populateStart = mainJs.indexOf("function populateWorkCardRows");
  const fillStart = mainJs.indexOf("function fillCreatorForm", populateStart);
  const selector = mainJs.slice(populateStart, fillStart);
  assert.match(selector, /workCardOptions = cards;/);
  assert.match(selector, /const selectedCard = workCardOptions\.find\(\(card\) => Number\(card\.id\) === Number\(selected\?\.value\)\);/);
  assert.match(selector, /`本剧本将引用：\$\{selectedCard\.name\} · \$\{cardPersonalitySummary\(selectedCard\)\}`/);
  assert.match(selector, /"本剧本不使用角色卡。"/);
});

test("script editor no longer embeds role-card or initial numeric-relation controls", () => {
  const creatorStart = mainJs.indexOf("async function renderCreator");
  const creatorEnd = mainJs.indexOf("async function renderSettings", creatorStart);
  const creator = mainJs.slice(creatorStart, creatorEnd);
  assert.doesNotMatch(creator, /id="card-name"/);
  assert.doesNotMatch(creator, /id="initial-relation-rows"/);
  assert.doesNotMatch(creator, /add-initial-relation/);
});

test("script edit loading omits card mutation and adventure rendering resolves ordered session cards", () => {
  const loadStart = mainJs.indexOf("async function loadCreatorEditData");
  const loadEnd = mainJs.indexOf("async function confirmCreatorEditSave", loadStart);
  const load = mainJs.slice(loadStart, loadEnd);
  assert.match(load, /return \{ work, worldbook, entries \};/);
  assert.doesNotMatch(load, /getCard\(/);

  const adventureStart = mainJs.indexOf("async function renderAdventure");
  const adventureEnd = mainJs.indexOf("function openAdventureOnboarding", adventureStart);
  const adventure = mainJs.slice(adventureStart, adventureEnd);
  assert.match(adventure, /const cards = resolveSessionCards\(conv, work\);/);
  assert.match(adventure, /session = \{ conv, work, cards, card: cards\[0\] \|\| null,/);
  assert.match(adventure, /session-card-summary/);
});

test("adventure resolution gives the conversation snapshot array authority, including no-card sessions", () => {
  const adventureStart = mainJs.indexOf("async function renderAdventure");
  const adventureEnd = mainJs.indexOf("function openAdventureOnboarding", adventureStart);
  const adventure = mainJs.slice(adventureStart, adventureEnd);
  assert.match(mainJs, /function resolveSessionCards\(conversation = \{\}, work = \{\}\)/);
  assert.match(mainJs, /if \(Array\.isArray\(conversation\.card_snapshots\)\)/);
  assert.match(mainJs, /return normalizeRoleCards\(conversation\.card_snapshots\);/);
  assert.match(adventure, /cardSummaryText\(cards\)/);
});

test("Mock 新会话保存角色卡快照且后续编辑不覆盖旧会话", () => {
  const createStart = mainJs.indexOf("function createMockConversation");
  const createEnd = mainJs.indexOf("async function listWorks", createStart);
  const create = mainJs.slice(createStart, createEnd);
  assert.match(create, /card_snapshot/);
  assert.match(create, /JSON\.parse\(JSON\.stringify\(card/);
  assert.doesNotMatch(mainJs, /mockConversations = .*mockCards/);
});

test("Mock 旧会话只从嵌入的作品角色卡迁移空快照", () => {
  const migrationStart = mainJs.indexOf("function migrateMockConversationCardSnapshots");
  const migrationEnd = mainJs.indexOf("function saveMockData", migrationStart);
  const migration = mainJs.slice(migrationStart, migrationEnd);
  assert.match(migration, /if \(hasNonEmptyMockCardSnapshot\(conversation\.card_snapshot\)\) return;/);
  assert.match(migration, /work\?\.card/);
  assert.match(migration, /conversation\.card_snapshot = JSON\.parse\(JSON\.stringify\(work\.card\)\);/);
  assert.doesNotMatch(migration, /getMockCard\(/);
});

test("existing-card editor waits for the card load independently of reference loading", () => {
  const editorStart = mainJs.indexOf("async function renderCardEditor");
  const creatorStart = mainJs.indexOf("async function renderCreator", editorStart);
  const editor = mainJs.slice(editorStart, creatorStart);
  assert.match(mainJs, /async function loadCardIntoEditor\(cardId\)/);
  assert.match(editor, /loaded: !isEditing/);
  assert.match(editor, /id="card-save-btn"[^>]*\$\{isEditing \? " disabled" : ""\}/);
  assert.match(editor, /loadCardIntoEditor\(cardId\)/);
  assert.match(editor, /const works = await listAllWorks\(\);/);
});

test("JSON imports preserve an existing card's hidden initial state", () => {
  const fillStart = mainJs.indexOf("function fillCardForm");
  const submitStart = mainJs.indexOf("async function submitCardForm", fillStart);
  const fill = mainJs.slice(fillStart, submitStart);
  const bindStart = mainJs.indexOf("function bindCardEditorEvents");
  const renderStart = mainJs.indexOf("async function renderCardEditor", bindStart);
  const bindings = mainJs.slice(bindStart, renderStart);
  assert.match(fill, /preserveHiddenInitialState = false/);
  assert.match(fill, /JSON\.parse\(JSON\.stringify\(cardEditorState\.initialState \|\| \{\}\)\)/);
  assert.doesNotMatch(fill, /card\.initial_state\?\.attributes/);
  assert.match(bindings, /preserveHiddenInitialState: Boolean\(cardEditorState\.cardId\)/);
});

test("reference-sensitive role-card surfaces aggregate every cards and works page", () => {
  assert.match(mainJs, /async function listAllPages\(path, params = \{\}\)/);
  assert.match(mainJs, /async function listAllCards\(query = ""\)/);
  assert.match(mainJs, /async function listAllWorks\(query = "", tag = ""\)/);
  const libraryStart = mainJs.indexOf("async function renderCardResults");
  const libraryEnd = mainJs.indexOf("function bindCardsEvents", libraryStart);
  const library = mainJs.slice(libraryStart, libraryEnd);
  assert.match(library, /listAllCards\(cardLibraryQuery\)/);
  assert.match(library, /listAllWorks\(\)/);
  const actionsStart = mainJs.indexOf("function bindCardActionEvents");
  const actionsEnd = mainJs.indexOf("function fillCardForm", actionsStart);
  assert.match(mainJs.slice(actionsStart, actionsEnd), /await listAllWorks\(\)/);
  const creatorStart = mainJs.indexOf("async function renderCreator");
  const settingsStart = mainJs.indexOf("async function renderSettings", creatorStart);
  assert.match(mainJs.slice(creatorStart, settingsStart), /await listAllCards\(\)/);
});

test("persona corrections use all role cards resolved for the active session", () => {
  const adventureStart = mainJs.indexOf("async function renderAdventure");
  const correctionStart = mainJs.indexOf("async function openCorrectionModal", adventureStart);
  const correctionEnd = mainJs.indexOf("function addDynamicRow", correctionStart);
  const adventure = mainJs.slice(adventureStart, correctionStart);
  const correction = mainJs.slice(correctionStart, correctionEnd);
  assert.match(adventure, /session = \{ conv, work, cards, card: cards\[0\] \|\| null,/);
  assert.match(correction, /const cards = Array\.isArray\(session\.cards\)/);
  assert.match(correction, /cards\.flatMap\(\(card\)/);
  assert.doesNotMatch(correction, /await getCard\(/);
});

test("role-card editor exposes JSON format help beside the upload control", () => {
  const editorStart = mainJs.indexOf("async function renderCardEditor");
  const editorEnd = mainJs.indexOf("async function renderCreator", editorStart);
  const editor = mainJs.slice(editorStart, editorEnd);
  assert.match(editor, /id="card-file"/);
  assert.match(editor, /id="card-json-format-btn"/);
  assert.match(editor, /JSON 格式/);

  const bindStart = mainJs.indexOf("function bindCardEditorEvents");
  const bindEnd = mainJs.indexOf("function setCardEditorSaveEnabled", bindStart);
  const bindings = mainJs.slice(bindStart, bindEnd);
  assert.match(bindings, /card-json-format-btn/);
  assert.match(bindings, /openModal\(roleCardJsonFormatHtml\(\)\)/);

  const helpStart = mainJs.indexOf("function roleCardJsonFormatHtml");
  const helpEnd = mainJs.indexOf("function bindCardEditorEvents", helpStart);
  const help = mainJs.slice(helpStart, helpEnd);
  for (const field of ["name", "persona", "personality", "speaking_style", "relationships", "directives", "initial_state", "character_attributes", "source"]) {
    assert.match(help, new RegExp('"' + field + '"'));
  }
  assert.match(help, /json-format-example/);
  assert.match(help, /data-close/);
});
