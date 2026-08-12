import assert from "node:assert/strict";
import test from "node:test";
import { readSource, sourceSection } from "./test_helpers.mjs";

const mainJs = readSource("./js/main.js");
const adventureJs = readSource("./js/adventure-page.mjs");
const creatorJs = readSource("./js/creator-page.mjs");
const dataJs = readSource("./js/data.mjs");

test("creator uses one transactional bundle request for create and update", () => {
  const editSource = sourceSection(creatorJs, "async function saveCreatorEdit", "async function submitCreatorForm");
  const submitSource = sourceSection(creatorJs, "async function submitCreatorForm", "function bindCreatorEvents");

  assert.match(editSource, /updateWorkBundle\(editState\.workId, editState\.worldbookId/);
  assert.match(submitSource, /saveWorkBundle\(\{ work, worldbook \}\)/);
  assert.doesNotMatch(editSource + submitSource, /\/api\//);
  assert.match(dataJs, /request\(`\/api\/works\/\$\{workId\}\/bundle`/);
  assert.match(dataJs, /request\("\/api\/works\/bundle"/);
});

test("creator supports works without worldbooks and keeps offline shared books synchronized", () => {
  const loadSource = sourceSection(creatorJs, "async function loadCreatorEditData", "function areWorkCardIdsAvailable");
  const saveSource = sourceSection(creatorJs, "async function saveCreatorEdit", "async function submitCreatorForm");

  assert.match(loadSource, /if \(!worldbook\)/);
  assert.match(loadSource, /id: null/);
  assert.match(saveSource, /updateWorkBundle/);
  assert.match(dataJs, /const savedWorldbookId = worldbookId \?\? \+\+mockSeq/);
  assert.match(dataJs, /mockWorks\.filter[\s\S]*\.forEach/);
});

test("snapshot restore refreshes messages and correction-aware offline snapshots", () => {
  assert.match(dataJs, /persona_corrections: clone\(conversation\.persona_corrections/);
  assert.match(dataJs, /memory_corrections: clone\(conversation\.memory_corrections/);
  assert.match(adventureJs, /session\.messages = Array\.isArray\(restored\.messages\)/);
  assert.match(adventureJs, /renderMessages\(\);/);
});
