import { nowISO } from "./core/format.mjs";
import { createReadOnlyDemoAdapter } from "./read-only-demo.mjs";

export const MOCK_DATA_KEY = "adventure_mock_data";
export const MOCK_SETTINGS_KEY = "adventure_mock_settings";
export const API_KEY_DRAFT_KEY = "adventure_api_key_draft";

export let MODE = "offline";
export let AI_ENABLED = false;

let accountApiClient = null;
let accountReadOnlyAdapter = null;
let accountMode = false;

export function configureDataAccess({ apiClient = null, readOnlyAdapter = null } = {}) {
  accountApiClient = apiClient;
  accountReadOnlyAdapter = readOnlyAdapter || createReadOnlyDemoAdapter();
  accountMode = Boolean(apiClient);
}

export function applyAccountConfigMode(config = {}) {
  if (!accountMode) return { mode: MODE, aiEnabled: AI_ENABLED };
  const apiKeySet = config.api_key_set ?? config.deepseek?.api_key_set ?? false;
  const apiKeyUnreadable = config.api_key_unreadable ?? config.deepseek?.api_key_unreadable ?? false;
  MODE = apiKeySet && !apiKeyUnreadable ? "online" : "mock";
  AI_ENABLED = MODE === "online";
  return { mode: MODE, aiEnabled: AI_ENABLED };
}

export function isAccountMode() {
  return accountMode;
}

let mockSeq = 0;
let mockWorks = [];
let mockCards = [];
let mockConversations = {};

const DEFAULT_SETTINGS = {
  deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", api_key_set: false, timeout_seconds: 60 },
  generation: {
    temperature: 0.8,
    max_tokens: 2048,
    reasoning_effort: "off",
    context_window_tokens: 32768,
    compression_trigger_ratio: 0.75,
    compression_keep_recent_messages: 8,
    compression_summary_max_tokens: 1200,
  },
};

export const DEFAULT_MOCK_WORKS = [
  {
    id: 1,
    title: "雾中王都",
    description: "王都被迷雾笼罩了十年。你带着一封旧信走进城门，雨正落在石板路上。",
    opening: "雨落在石板路上，城门的卫兵盯着你看了很久。\n「信呢？」他问。\n选项：\n- 递出那封旧信\n- 询问铁鸦王都的传闻\n- 转身离开城门",
    tags: ["20+", "奇幻", "大世界"],
    plays: 128,
    card_id: 1,
    worldbook_id: 1,
    created_at: "2026-08-01 20:30:00",
    card: {
      id: 1,
      name: "守门人 铁鸦",
      persona: "沉默寡言的老兵，见过王都最繁华的日子，也见过它被雾吞没的夜晚。",
      personality: "警惕、守信、外冷内热",
      speaking_style: "短句，语气低沉，很少说超过十个字",
      relationships: { 玩家: "手里握着他老友的信" },
      directives: ["不轻易信任外乡人", "提到王都往事时会沉默"],
      initial_state: { attributes: { 魅力: 60, 武力: 40 }, items: [], relations: {} },
    },
    worldbook: {
      id: 1,
      title: "雾中王都设定",
      description: "王都与迷雾的基础设定",
      entries: [
        { title: "迷雾", keywords: ["雾", "迷雾", "浓雾"], content: "迷雾会让人迷失方向，但老居民知道怎么走。雾里偶尔能听到钟声。", priority: 10, enabled: true },
        { title: "旧信", keywords: ["信", "旧信"], content: "信来自十年前失踪的城主，信封上只有一句话：让带信的人活着离开。", priority: 20, enabled: true },
      ],
    },
  },
  {
    id: 2,
    title: "深夜便利店",
    description: "凌晨两点，便利店来了一个不买任何东西的客人。",
    opening: "凌晨两点，便利店的灯还在亮着。\n门口的风铃响了一下，进来的人浑身湿透。\n「夜班？」他问。",
    tags: ["20+", "悬疑", "现代"],
    plays: 96,
    card_id: 2,
    worldbook_id: 2,
    created_at: "2026-08-03 22:10:00",
    card: {
      id: 2,
      name: "雨夜来客",
      persona: "不知道名字的年轻男人，总是在雨夜出现，只和店员说话。",
      personality: "温和、疲倦、偶尔说些奇怪的话",
      speaking_style: "轻声，句子很完整，像在背台词",
      relationships: { 玩家: "似乎认识你，但你对他没有印象" },
      directives: ["不回答自己是谁", "提到某个已经消失的地址"],
      initial_state: { attributes: { 观察: 55, 口才: 65 }, items: [], relations: {} },
    },
    worldbook: {
      id: 2,
      title: "城市夜话",
      description: "深夜城市的日常与异常",
      entries: [
        { title: "凌晨两点", keywords: ["凌晨", "两点", "夜"], content: "凌晨两点之后，这座城市会发生一些白天解释不了的事。", priority: 10, enabled: true },
      ],
    },
  },
  {
    id: 3,
    title: "自定义人生",
    description: "随机或定制你的身份、世界与开局，让 AI 为你衍生一段属于你的故事。",
    opening: "你的故事从这一刻开始。\n你是谁、身处何处、为什么在这里，都由你决定。\n请告诉我你的身份、世界，或直接说「随机开局」。",
    tags: ["20+", "自由", "自定义"],
    plays: 214,
    card_id: 3,
    worldbook_id: 3,
    created_at: "2026-08-05 09:15:00",
    card: {
      id: 3,
      name: "叙述者",
      persona: "高自由度旁白，根据玩家的设定生成世界、角色与剧情。",
      personality: "客观、细腻、尊重玩家的选择",
      speaking_style: "小说式旁白，偶尔以第二人称直接对玩家说话",
      relationships: { 玩家: "故事的书写者" },
      directives: ["跟随玩家自定义的设定", "每次回复推进剧情并保留选择的后果"],
      initial_state: { attributes: { 想象力: 80, 命运: 50 }, items: [], relations: {} },
    },
    worldbook: {
      id: 3,
      title: "自定义规则",
      description: "高自由度开局规则",
      entries: [
        { title: "随机开局", keywords: ["随机", "开局", "身份"], content: "玩家说随机开局时，生成一个带身份、地点和目标的完整开局。", priority: 20, enabled: true },
      ],
    },
  },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function toItems(data) {
  if (Array.isArray(data)) return data;
  return (data && data.items) || [];
}

async function request(path, { method = "GET", body } = {}) {
  if (accountApiClient) {
    if (method === "GET") return accountApiClient.get(path);
    if (method === "POST") return accountApiClient.post(path, body);
    if (method === "PUT") return accountApiClient.put(path, body);
    if (method === "DELETE") return accountApiClient.delete(path);
  }
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail || data?.error || data;
    const error = new Error(detail?.message || data?.message || `请求失败 (${response.status})`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return data;
}

export async function detectMode() {
  if (accountApiClient) {
    try {
      await request("/api/health");
      MODE = "mock";
      AI_ENABLED = false;
      return { mode: MODE, aiEnabled: AI_ENABLED, available: true };
    } catch {
      MODE = "offline";
      AI_ENABLED = false;
      return { mode: MODE, aiEnabled: false, available: false };
    }
  }
  try {
    const health = await request("/api/health");
    MODE = health.ai_enabled ? "online" : "mock";
    AI_ENABLED = Boolean(health.ai_enabled);
  } catch {
    MODE = "offline";
    AI_ENABLED = false;
  }
  return { mode: MODE, aiEnabled: AI_ENABLED };
}

export function normalizeMockReplyTemplateFields(work) {
  const normalizedWork = work && typeof work === "object" ? { ...work } : {};
  const replyTemplates = Array.isArray(normalizedWork.reply_templates) ? normalizedWork.reply_templates : [];
  const activeId = typeof normalizedWork.active_reply_template_id === "string" ? normalizedWork.active_reply_template_id : "";
  const validTemplateIds = new Set(replyTemplates.filter((template) => template && typeof template.id === "string" && template.id.trim()).map((template) => template.id));
  return { ...normalizedWork, reply_templates: replyTemplates, active_reply_template_id: validTemplateIds.has(activeId) ? activeId : "" };
}

function migrateMockReplyTemplateFields() {
  let migrated = false;
  mockWorks = mockWorks.map((work) => {
    const normalized = normalizeMockReplyTemplateFields(work);
    if (!work || typeof work !== "object" || !Array.isArray(work.reply_templates) || typeof work.active_reply_template_id !== "string" || work.active_reply_template_id !== normalized.active_reply_template_id) migrated = true;
    return normalized;
  });
  return migrated;
}

function hasNonEmptyMockCardSnapshot(cardSnapshot) {
  return Boolean(cardSnapshot && typeof cardSnapshot === "object" && Object.keys(cardSnapshot).length);
}

function migrateMockConversationCardSnapshots() {
  let migrated = false;
  Object.values(mockConversations).forEach((conversation) => {
    if (hasNonEmptyMockCardSnapshot(conversation.card_snapshot)) return;
    const work = mockWorks.find((item) => Number(item.id) === Number(conversation.work_id));
    if (!work?.card) return;
    conversation.card_snapshot = clone(work.card);
    migrated = true;
  });
  return migrated;
}

function migrateMockConversationCorrections() {
  let migrated = false;
  Object.values(mockConversations).forEach((conversation) => {
    if (!Array.isArray(conversation.persona_corrections)) {
      conversation.persona_corrections = [];
      migrated = true;
    }
    if (!Array.isArray(conversation.memory_corrections)) {
      conversation.memory_corrections = [];
      migrated = true;
    }
  });
  return migrated;
}

function deriveMockCards(works) {
  const cardsById = new Map();
  works.forEach((work) => {
    const cardId = Number(work.card_id);
    if (!Number.isFinite(cardId) || cardsById.has(cardId) || !work.card) return;
    cardsById.set(cardId, { ...work.card, id: cardId });
  });
  return [...cardsById.values()];
}

function saveMockData() {
  localStorage.setItem(MOCK_DATA_KEY, JSON.stringify({ works: mockWorks, cards: mockCards, conversations: mockConversations, seq: mockSeq }));
}

export function loadMockData() {
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_DATA_KEY) || "null");
    if (saved && Array.isArray(saved.works)) {
      mockWorks = saved.works;
      const needsReplyTemplateMigration = migrateMockReplyTemplateFields();
      const needsCardMigration = !Array.isArray(saved.cards);
      mockCards = needsCardMigration ? deriveMockCards(mockWorks) : saved.cards;
      mockConversations = saved.conversations || {};
      const needsConversationSnapshotMigration = migrateMockConversationCardSnapshots();
      const needsConversationCorrectionMigration = migrateMockConversationCorrections();
      mockSeq = Math.max(Number(saved.seq) || 0, mockWorks.length * 100, ...mockWorks.map((work) => Number(work.id) || 0), ...mockCards.map((card) => Number(card.id) || 0));
      if (needsCardMigration || needsConversationSnapshotMigration || needsConversationCorrectionMigration || needsReplyTemplateMigration) saveMockData();
      return;
    }
  } catch {}
  mockWorks = clone(DEFAULT_MOCK_WORKS);
  migrateMockReplyTemplateFields();
  mockCards = deriveMockCards(mockWorks);
  mockConversations = {};
  mockSeq = Math.max(mockWorks.length * 100, ...mockCards.map((card) => Number(card.id) || 0));
  saveMockData();
}

export async function initializeData() {
  if (accountMode) {
    return detectMode();
  }
  loadMockData();
  return detectMode();
}

function getMockCard(id) {
  return mockCards.find((card) => Number(card.id) === Number(id)) || null;
}

export function filterWorks(works, query, tag) {
  const q = String(query || "").trim().toLowerCase();
  return works.filter((work) => {
    const matchesQ = !q || `${work.title || ""} ${work.description || ""} ${(work.tags || []).join(" ")}`.toLowerCase().includes(q);
    return matchesQ && (!tag || (work.tags || []).includes(tag));
  });
}

export function sortWorks(works, sort) {
  const list = [...works];
  if (sort === "newest") list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  else if (sort === "popular") list.sort((a, b) => Number(b.plays || 0) - Number(a.plays || 0));
  return list;
}

async function listAllPages(path, params = {}) {
  const pageSize = 100;
  const items = [];
  for (let page = 1; ; page += 1) {
    const search = new URLSearchParams({ ...params, page: String(page), page_size: String(pageSize) });
    const data = await request(`${path}?${search.toString()}`);
    const pageItems = toItems(data);
    items.push(...pageItems);
    const total = Number(data?.total);
    if ((Number.isFinite(total) && items.length >= total) || pageItems.length < pageSize) break;
  }
  return items;
}

export async function listAllWorks(query = "", tag = "") {
  if (accountMode && MODE === "offline") return filterWorks(accountReadOnlyAdapter.listWorks(), query, tag);
  if (MODE === "offline") return filterWorks(mockWorks.map((work) => ({ ...work, card: undefined, worldbook: undefined })), query, tag);
  const params = {};
  if (query) params.q = query;
  if (tag) params.tag = tag;
  return listAllPages("/api/works", params);
}

export const listWorks = listAllWorks;

export async function getWork(id) {
  if (accountMode && MODE === "offline") {
    const work = accountReadOnlyAdapter.listWorks().find((item) => String(item.id) === String(id));
    if (!work) throw new Error("作品不存在");
    return work;
  }
  if (MODE === "offline") {
    const work = mockWorks.find((item) => Number(item.id) === Number(id));
    if (!work) throw new Error("作品不存在");
    return clone(work);
  }
  return request(`/api/works/${id}`);
}

export async function listAllCards(query = "") {
  if (accountMode && MODE === "offline") {
    const q = String(query || "").trim().toLowerCase();
    return accountReadOnlyAdapter.listCards().filter((card) => !q || `${card.name || ""} ${card.persona || ""}`.toLowerCase().includes(q));
  }
  if (MODE === "offline") {
    const q = String(query || "").trim().toLowerCase();
    return clone(mockCards.filter((card) => !q || `${card.name || ""} ${card.persona || ""} ${card.personality || ""}`.toLowerCase().includes(q)));
  }
  return listAllPages("/api/cards", query ? { q: query } : {});
}

export const listCards = listAllCards;

export async function getCard(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.listCards().find((card) => String(card.id) === String(id)) || null;
  if (!id) return null;
  if (MODE === "offline") {
    const card = getMockCard(id);
    if (!card) throw new Error("角色卡不存在");
    return clone(card);
  }
  return request(`/api/cards/${id}`);
}

export async function createCard(payload) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.create(payload);
  if (MODE === "offline") {
    const timestamp = nowISO();
    const card = { id: ++mockSeq, ...payload, created_at: timestamp, updated_at: timestamp };
    mockCards.unshift(card);
    saveMockData();
    return clone(card);
  }
  return request("/api/cards", { method: "POST", body: payload });
}

export async function updateCard(id, payload) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.update({ id, ...payload });
  if (MODE === "offline") {
    const card = getMockCard(id);
    if (!card) throw new Error("角色卡不存在");
    Object.assign(card, payload, { id: card.id, updated_at: nowISO() });
    saveMockData();
    return clone(card);
  }
  return request(`/api/cards/${id}`, { method: "PUT", body: payload });
}

export async function deleteCard(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.delete(id);
  if (MODE === "offline") {
    mockCards = mockCards.filter((card) => Number(card.id) !== Number(id));
    saveMockData();
    return;
  }
  await request(`/api/cards/${id}`, { method: "DELETE" });
}

export async function getWorldbook(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.listWorldbooks().find((book) => String(book.id) === String(id)) || null;
  if (!id || MODE === "offline") return null;
  return request(`/api/worldbooks/${id}`);
}

export async function getWorldbookEntries(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.listWorldbooks().find((book) => String(book.id) === String(id))?.entries || [];
  if (!id || MODE === "offline") return [];
  return toItems(await request(`/api/worldbooks/${id}/entries`));
}

function createMockConversation(work) {
  const card = getMockCard(work.card_id) || work.card || {};
  const initialState = clone(card.initial_state || { attributes: {}, items: [], relations: {} });
  initialState.money = initialState.money ?? 100;
  initialState.quests = initialState.quests || [];
  initialState.flags = initialState.flags || {};
  initialState.logs = initialState.logs || [];
  if (card.name) initialState.characters = { [card.name]: { attributes: { 心情: 50, 好感度: Number(initialState.relations?.[card.name]) || 0, ...(card.character_attributes || {}) }, flags: [] } };
  const id = ++mockSeq;
  const timestamp = nowISO();
  const conversation = {
    id, work_id: work.id, card_id: work.card_id || null, card_snapshot: clone(card), title: work.title,
    status: "active", current_state: clone(initialState), created_at: timestamp, updated_at: timestamp,
    messages: [{ id: `m${id}-0`, role: "system", content: work.opening || "故事从这里开始。", created_at: timestamp }],
    snapshots: [], persona_corrections: [], memory_corrections: [], state: clone(initialState),
  };
  mockConversations[id] = conversation;
  return clone(conversation);
}

export async function createConversation(workId) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.startAdventure(workId);
  const work = await getWork(workId);
  if (MODE === "offline") return createMockConversation(work);
  return request("/api/conversations", { method: "POST", body: { work_id: workId, title: work.title } });
}

export async function getConversation(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.startAdventure(id);
  if (MODE === "offline") {
    const conversation = mockConversations[id];
    if (!conversation) throw new Error("会话不存在");
    return clone(conversation);
  }
  return request(`/api/conversations/${id}`);
}

export async function listConversations(workId) {
  if (accountMode && MODE === "offline") return [];
  if (MODE === "offline") return clone(Object.values(mockConversations).filter((item) => Number(item.work_id) === Number(workId)).sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""))));
  const params = new URLSearchParams({ work_id: String(workId), page: "1", page_size: "100" });
  return toItems(await request(`/api/conversations?${params.toString()}`));
}

export async function getMessages(id) {
  if (accountMode && MODE === "offline") return [];
  return MODE === "offline" ? clone(mockConversations[id]?.messages || []) : toItems(await request(`/api/conversations/${id}/messages`));
}

export async function getState(id) {
  if (accountMode && MODE === "offline") return {};
  return MODE === "offline" ? clone(mockConversations[id]?.state || {}) : request(`/api/conversations/${id}/state`);
}

export async function getSnapshots(id) {
  if (accountMode && MODE === "offline") return [];
  return MODE === "offline" ? clone(mockConversations[id]?.snapshots || []) : toItems(await request(`/api/conversations/${id}/snapshots`));
}

export async function createSnapshot(conversationId, name) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.save({ conversationId, name });
  if (MODE !== "offline") return request(`/api/conversations/${conversationId}/snapshots`, { method: "POST", body: { name: name || "未命名存档", note: "手动存档" } });
  const conversation = mockConversations[conversationId];
  const snapshot = { id: ++mockSeq, conversation_id: conversationId, name: name || "未命名存档", state: clone(conversation.state), messages: clone(conversation.messages || []), persona_corrections: clone(conversation.persona_corrections || []), memory_corrections: clone(conversation.memory_corrections || []), created_at: nowISO(), note: "手动存档" };
  conversation.snapshots.unshift(snapshot);
  saveMockData();
  return clone(snapshot);
}

export async function restoreSnapshot(conversationId, snapshotId) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.save({ conversationId, snapshotId });
  if (MODE !== "offline") return request(`/api/conversations/${conversationId}/snapshots/${snapshotId}/restore`, { method: "POST" });
  const conversation = mockConversations[conversationId];
  const snapshot = conversation.snapshots.find((item) => item.id === Number(snapshotId));
  if (!snapshot) throw new Error("存档不存在");
  conversation.state = clone(snapshot.state);
  if (Array.isArray(snapshot.messages)) conversation.messages = clone(snapshot.messages);
  if (Object.hasOwn(snapshot, "persona_corrections")) conversation.persona_corrections = clone(snapshot.persona_corrections || []);
  if (Object.hasOwn(snapshot, "memory_corrections")) conversation.memory_corrections = clone(snapshot.memory_corrections || []);
  saveMockData();
  return { state: clone(conversation.state), conversation: clone(conversation), messages: clone(conversation.messages || []) };
}

export async function deleteSnapshot(conversationId, snapshotId) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.delete({ conversationId, snapshotId });
  if (MODE === "offline") {
    mockConversations[conversationId].snapshots = mockConversations[conversationId].snapshots.filter((item) => item.id !== Number(snapshotId));
    saveMockData();
    return;
  }
  await request(`/api/conversations/${conversationId}/snapshots/${snapshotId}`, { method: "DELETE" });
}

export async function deleteConversation(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.delete(id);
  if (MODE === "offline") {
    delete mockConversations[id];
    saveMockData();
    return;
  }
  await request(`/api/conversations/${id}`, { method: "DELETE" });
}

export async function updateConversation(id, title) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.update({ id, title });
  if (MODE === "offline") {
    const conversation = mockConversations[id];
    if (!conversation) throw new Error("会话不存在");
    conversation.title = title;
    conversation.updated_at = nowISO();
    saveMockData();
    return clone(conversation);
  }
  return request(`/api/conversations/${id}`, { method: "PUT", body: { title } });
}

export async function deleteWork(id) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.delete(id);
  if (MODE === "offline") {
    mockWorks = mockWorks.filter((work) => Number(work.id) !== Number(id));
    Object.values(mockConversations).forEach((conversation) => { if (Number(conversation.work_id) === Number(id)) conversation.work_id = null; });
    saveMockData();
    return;
  }
  await request(`/api/works/${id}`, { method: "DELETE" });
}

export async function saveWorkBundle({ work, worldbook }) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.create({ work, worldbook });
  if (MODE !== "offline") return request("/api/works/bundle", { method: "POST", body: { work, worldbook } });
  const id = ++mockSeq;
  const savedWork = { id, ...work, worldbook_id: id, worldbook: { ...worldbook, id }, plays: 0, created_at: nowISO(), updated_at: nowISO() };
  mockWorks.unshift(savedWork);
  saveMockData();
  return { work: clone(savedWork), worldbook: clone(savedWork.worldbook) };
}

export async function updateWorkBundle(workId, worldbookId, { work, worldbook }) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.update({ id: workId, work, worldbook });
  if (MODE !== "offline") return request(`/api/works/${workId}/bundle`, { method: "PUT", body: { work, worldbook } });
  const savedWork = mockWorks.find((item) => Number(item.id) === Number(workId));
  if (!savedWork) throw new Error("作品不存在");
  const savedWorldbookId = worldbookId ?? ++mockSeq;
  const savedWorldbook = { ...worldbook, id: savedWorldbookId, entries: worldbook.entries };
  if (worldbookId != null) mockWorks.filter((item) => Number(item.worldbook_id) === Number(worldbookId)).forEach((item) => { item.worldbook = clone(savedWorldbook); });
  savedWork.worldbook_id = savedWorldbookId;
  savedWork.worldbook = savedWorldbook;
  Object.assign(savedWork, work, { updated_at: nowISO() });
  saveMockData();
  return { work: clone(savedWork), worldbook: clone(savedWorldbook) };
}

export async function submitOnboarding(conversationId, answers) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.save({ conversationId, answers });
  if (MODE !== "offline") return request(`/api/conversations/${conversationId}/onboarding`, { method: "POST", body: { answers } });
  const conversation = mockConversations[conversationId];
  if (!conversation) throw new Error("会话不存在");
  conversation.onboarding_answers = clone(answers);
  conversation.onboarding_status = "completed";
  conversation.updated_at = nowISO();
  saveMockData();
  return clone(conversation);
}

export async function addCorrection(conversationId, kind, content) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.update({ conversationId, kind, content });
  if (MODE !== "offline") return request(`/api/conversations/${conversationId}/corrections`, { method: "POST", body: { kind, content } });
  const conversation = mockConversations[conversationId];
  if (!conversation) throw new Error("会话不存在");
  const key = kind === "persona" ? "persona_corrections" : "memory_corrections";
  const corrections = Array.isArray(conversation[key]) ? conversation[key] : [];
  conversation[key] = [...corrections, { content, created_at: nowISO() }].slice(-50);
  saveMockData();
  return clone(conversation);
}

export async function stopConversation(conversationId) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.save({ conversationId, stopped: true });
  if (MODE === "offline") return null;
  return request(`/api/conversations/${conversationId}/stop`, { method: "POST" });
}

function summarizeState(state) {
  const attrs = Object.entries(state.attributes || {}).map(([key, value]) => `${key} ${value}`).join("，") || "无";
  return `属性：${attrs}\n金钱：${state.money ?? 0}\n背包：${(state.items || []).join("、") || "空"}`;
}

function mockReply(content, state) {
  const text = String(content || "").trim();
  if (text.startsWith("/status") || text.startsWith("/状态")) return `当前状态：\n${summarizeState(state)}`;
  if (text.startsWith("/inventory") || text.startsWith("/背包")) return `背包：${(state.items || []).join("、") || "空"}\n金钱：${state.money ?? 0}`;
  if (text.startsWith("/save") || text.startsWith("/存档")) return "进度已保存。你可以在右侧存档列表里恢复。";
  if (text.startsWith("/help") || text.startsWith("/帮助")) return "可用指令：/状态、/背包、/存档、/帮助。";
  const replies = [
    `你${text}。雾气在灯下翻涌，远处传来一声钟响。\n「继续走，别回头。」\n选项：\n- 询问铁鸦王都的传闻\n- 递出那封旧信\n- 转身离开城门`,
    `你${text}。烛火晃了晃，旧木门发出吱呀声。\n你的心跳漏了一拍，但你没有停下。\n选项：\n- 压低声音继续前进\n- 先观察周围\n- 呼叫同伴`,
    `你${text}。夜色被拉得很长，巷口的灯笼突然熄灭。\n有什么东西在阴影里移动。\n选项：\n- 握紧武器\n- 朝阴影喊话\n- 快步离开`,
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function applyMockStateDelta(conversation, content) {
  const state = conversation.state;
  if (/剑|刀|武器|装备/.test(content) && !state.items.includes("旧铁剑")) state.items.push("旧铁剑");
  if (/金币|钱|报酬/.test(content)) state.money = (state.money || 0) + 20;
  if (/救|帮助|委托/.test(content) && !(state.quests || []).some((quest) => quest.title.includes("委托"))) state.quests.push({ title: "完成城中委托", status: "进行中" });
  if (!state.logs) state.logs = [];
  state.logs.unshift({ type: "mock", message: "状态随剧情轻微变化", time: nowISO() });
}

async function mockStreamChat(conversationId, content, handlers) {
  const conversation = mockConversations[conversationId];
  if (!conversation) {
    handlers.onError?.("会话不存在");
    handlers.onFinish?.();
    return;
  }
  const timestamp = nowISO();
  conversation.messages.push({ id: `m${++mockSeq}`, role: "user", content, created_at: timestamp });
  saveMockData();
  handlers.onMeta?.({ conversation_id: conversationId, message_id: `m${mockSeq}` });
  const reply = mockReply(content, conversation.state);
  let accumulated = "";
  for (const chunk of reply.match(/[\s\S]{1,4}/g) || []) {
    accumulated += chunk;
    handlers.onDelta?.(chunk);
    await sleep(28);
  }
  applyMockStateDelta(conversation, content);
  conversation.messages.push({ id: `m${++mockSeq}`, role: "assistant", content: accumulated, created_at: nowISO() });
  conversation.snapshots.unshift({ id: ++mockSeq, conversation_id: conversationId, name: `自动存档 ${conversation.snapshots.length + 1}`, state: clone(conversation.state), messages: clone(conversation.messages || []), persona_corrections: clone(conversation.persona_corrections || []), memory_corrections: clone(conversation.memory_corrections || []), created_at: nowISO(), note: "自动存档" });
  saveMockData();
  handlers.onState?.({ current_state: clone(conversation.state) });
  handlers.onDone?.({ message_id: `m${mockSeq}`, usage: { total_tokens: accumulated.length } });
  handlers.onFinish?.();
}

export async function streamChat(conversationId, content, handlers, metadata = {}) {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.startAdventure(conversationId);
  if (MODE === "offline") return mockStreamChat(conversationId, content, handlers);
  let response;
  try {
    response = accountApiClient
      ? await accountApiClient.openEventStream(`/api/conversations/${conversationId}/chat`, {
        body: { content, metadata },
      })
      : await fetch(`/api/conversations/${conversationId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, metadata }) });
  } catch (error) {
    handlers.onError?.(error.message || "无法连接对话接口");
    handlers.onFinish?.();
    return;
  }
  if (!response.ok || !response.body) {
    let message = "对话接口返回错误";
    try { message = (await response.json())?.error?.message || message; } catch {}
    handlers.onError?.(message);
    handlers.onFinish?.();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  const processSseLine = (line) => {
    if (line.startsWith("event: ")) eventName = line.slice(7).trim();
    else if (line.startsWith("data: ")) {
      let data;
      try { data = JSON.parse(line.slice(6)); } catch { return; }
      if (eventName === "meta") handlers.onMeta?.(data);
      else if (eventName === "delta") handlers.onDelta?.(data.content || "");
      else if (eventName === "context") handlers.onContext?.(data);
      else if (eventName === "state") handlers.onState?.(data);
      else if (eventName === "done") handlers.onDone?.(data);
      else if (eventName === "error") handlers.onError?.(data.message || "AI 请求失败");
      eventName = "";
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        buffer.split(/\r?\n/).forEach(processSseLine);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(processSseLine);
    }
  } catch (error) {
    handlers.onError?.(error.message || "流式响应中断");
  }
  handlers.onFinish?.();
}

export async function seedDemo() {
  if (accountMode && MODE === "offline") return accountReadOnlyAdapter.create({ demo: true });
  if (MODE === "offline") {
    mockWorks = clone(DEFAULT_MOCK_WORKS);
    mockCards = deriveMockCards(mockWorks);
    saveMockData();
    return;
  }
  const sample = DEFAULT_MOCK_WORKS[0];
  const card = await request("/api/cards", { method: "POST", body: sample.card });
  const worldbook = await request("/api/worldbooks", { method: "POST", body: { title: sample.worldbook.title, description: sample.worldbook.description } });
  for (const entry of sample.worldbook.entries) await request(`/api/worldbooks/${worldbook.id}/entries`, { method: "POST", body: entry });
  await request("/api/works", { method: "POST", body: { title: sample.title, description: sample.description, card_id: card.id, worldbook_id: worldbook.id, opening: sample.opening, tags: sample.tags } });
}

export async function loadSettings() {
  if (accountApiClient) return accountApiClient.get("/api/config");
  if (MODE !== "offline") return request("/api/config");
  try {
    return JSON.parse(localStorage.getItem(MOCK_SETTINGS_KEY) || "null") || clone(DEFAULT_SETTINGS);
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

export function getApiKeyDraft() {
  if (accountMode) return "";
  return localStorage.getItem(API_KEY_DRAFT_KEY) || "";
}

export function setApiKeyDraft(apiKey) {
  if (accountMode) return;
  localStorage.setItem(API_KEY_DRAFT_KEY, apiKey);
}

export function clearLegacyApiKeyDraft() {
  try { localStorage.removeItem(API_KEY_DRAFT_KEY); } catch {}
}

export function previewModels(connection) {
  if (accountApiClient) return accountApiClient.post("/api/models/preview", connection);
  return request("/api/models/preview", { method: "POST", body: connection });
}

export async function saveSettings(settings) {
  if (accountApiClient) return accountApiClient.put("/api/config", settings);
  if (MODE === "offline") {
    localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }
  return request("/api/config", { method: "PUT", body: settings });
}
