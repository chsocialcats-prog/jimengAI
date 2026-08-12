import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainJs = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const adventureJs = readFileSync(new URL("./js/adventure-page.mjs", import.meta.url), "utf8");
const creatorJs = readFileSync(new URL("./js/creator-page.mjs", import.meta.url), "utf8");
const dataJs = readFileSync(new URL("./js/data.mjs", import.meta.url), "utf8");

test("creator uses one transactional bundle request for create and update", () => {
  const editStart = creatorJs.indexOf("async function saveCreatorEdit");
  const submitStart = creatorJs.indexOf("async function submitCreatorForm");
  const editSource = creatorJs.slice(editStart, submitStart);
  const submitSource = creatorJs.slice(submitStart, creatorJs.indexOf("function bindCreatorEvents", submitStart));

  assert.match(editSource, /updateWorkBundle\(editState\.workId, editState\.worldbookId/);
  assert.match(submitSource, /saveWorkBundle\(\{ work, worldbook \}\)/);
  assert.doesNotMatch(editSource + submitSource, /\/api\//);
  assert.match(dataJs, /request\(`\/api\/works\/\$\{workId\}\/bundle`/);
  assert.match(dataJs, /request\("\/api\/works\/bundle"/);
});

test("creator supports works without worldbooks and keeps offline shared books synchronized", () => {
  const loadStart = creatorJs.indexOf("async function loadCreatorEditData");
  const saveStart = creatorJs.indexOf("async function saveCreatorEdit");
  const submitStart = creatorJs.indexOf("async function submitCreatorForm");
  const loadSource = creatorJs.slice(loadStart, creatorJs.indexOf("function areWorkCardIdsAvailable", loadStart));
  const saveSource = creatorJs.slice(saveStart, submitStart);

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
