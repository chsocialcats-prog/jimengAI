// AI 对话冒险平台前端主程序
import { icon, mountIcons } from "./icons.js";

const appEl = document.getElementById("app");
const modeBadge = document.getElementById("mode-badge");
const themeToggle = document.getElementById("theme-toggle");
const toastRoot = document.getElementById("toast-root");
const modalRoot = document.getElementById("modal-root");

const AGE_KEY = "adventure_age_confirmed";
const THEME_KEY = "adventure_theme";
const MOCK_DATA_KEY = "adventure_mock_data";
const MOCK_SETTINGS_KEY = "adventure_mock_settings";
const API_KEY_DRAFT_KEY = "adventure_api_key_draft";

const REPLY_LENGTH_PRESETS = {
  short: { label: "简短", maxTokens: 1024, hint: "约 300-500 字" },
  standard: { label: "标准", maxTokens: 2048, hint: "约 600-1000 字" },
  detailed: { label: "详细", maxTokens: 4096, hint: "约 1000-1800 字" },
  long: { label: "很长", maxTokens: 8192, hint: "约 2000-3500 字" },
};
const DEFAULT_REPLY_LENGTH = "detailed";
const REPLY_LENGTH_STORAGE_PREFIX = "adventure_reply_length:";

function normalizeReplyLength(value) {
  return Object.prototype.hasOwnProperty.call(REPLY_LENGTH_PRESETS, value)
    ? value
    : DEFAULT_REPLY_LENGTH;
}

function replyLengthStorageKey(conversationId) {
  return `${REPLY_LENGTH_STORAGE_PREFIX}${conversationId}`;
}

function loadReplyLength(conversationId, storage = localStorage) {
  if (!conversationId || !storage) return DEFAULT_REPLY_LENGTH;
  try {
    return normalizeReplyLength(storage.getItem(replyLengthStorageKey(conversationId)));
  } catch {
    return DEFAULT_REPLY_LENGTH;
  }
}

function saveReplyLength(conversationId, value, storage = localStorage) {
  const normalized = normalizeReplyLength(value);
  if (!conversationId || !storage) return normalized;
  try {
    storage.setItem(replyLengthStorageKey(conversationId), normalized);
  } catch {}
  return normalized;
}

modalRoot?.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close]");
  if (!closeButton || !modalRoot.contains(closeButton)) return;
  event.preventDefault();
  event.stopPropagation();
  modalRoot.innerHTML = "";
});

let MODE = "offline";
let AI_ENABLED = false;
let session = null;
let bypassAdventureLeavePrompt = false;
let mockSeq = 0;
let mockWorks = [];
let mockCards = [];
let mockConversations = {};
let libraryFilter = { q: "", tag: "", sort: "recommend" };
let creatorEditState = null;
let creatorEditWorkId = null;
let cardEditorState = { cardId: null, initialState: {} };
let cardLibraryQuery = "";
let cardLibraryRenderToken = 0;
let workCardOptions = [];

const $ = (selector, root = document) => root.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function formatTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function nowISO() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value) || 0;
  return Math.max(min, Math.min(max, n));
}

function toItems(data) {
  if (Array.isArray(data)) return data;
  return (data && data.items) || [];
}

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(html, { onConfirm } = {}) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  const backdrop = modalRoot.querySelector(".modal-backdrop");
  const close = () => { modalRoot.innerHTML = ""; };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));
  const confirmBtn = backdrop.querySelector("[data-confirm]");
  if (confirmBtn && onConfirm) {
    confirmBtn.addEventListener("click", () => {
      const input = backdrop.querySelector("[data-value]");
      onConfirm(input ? input.value : null);
      close();
    });
  }
  return { close, backdrop };
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail || data?.error || data;
    const error = new Error(detail?.message || data?.message || `请求失败 (${res.status})`);
    error.status = res.status;
    error.detail = detail;
    throw error;
  }
  return data;
}

async function detectMode() {
  try {
    const health = await api("/api/health");
    MODE = health.ai_enabled ? "online" : "mock";
    AI_ENABLED = Boolean(health.ai_enabled);
  } catch {
    MODE = "offline";
    AI_ENABLED = false;
  }
  updateModeBadge();
}

function updateModeBadge() {
  const text = MODE === "online" ? "DeepSeek 在线" : MODE === "mock" ? "Mock 模式" : "离线演示";
  modeBadge.textContent = text;
  modeBadge.classList.toggle("online", MODE === "online");
  modeBadge.classList.toggle("mock", MODE !== "online");
}

const DEFAULT_MOCK_WORKS = [
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
        {
          title: "迷雾",
          keywords: ["雾", "迷雾", "浓雾"],
          content: "迷雾会让人迷失方向，但老居民知道怎么走。雾里偶尔能听到钟声。",
          priority: 10,
          enabled: true,
        },
        {
          title: "旧信",
          keywords: ["信", "旧信"],
          content: "信来自十年前失踪的城主，信封上只有一句话：让带信的人活着离开。",
          priority: 20,
          enabled: true,
        },
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
        {
          title: "凌晨两点",
          keywords: ["凌晨", "两点", "夜"],
          content: "凌晨两点之后，这座城市会发生一些白天解释不了的事。",
          priority: 10,
          enabled: true,
        },
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
        {
          title: "随机开局",
          keywords: ["随机", "开局", "身份"],
          content: "玩家说随机开局时，生成一个带身份、地点和目标的完整开局。",
          priority: 20,
          enabled: true,
        },
      ],
    },
  },
];

function normalizeMockReplyTemplateFields(work) {
  const normalizedWork = work && typeof work === "object" ? { ...work } : {};
  const replyTemplates = Array.isArray(normalizedWork.reply_templates)
    ? normalizedWork.reply_templates
    : [];
  const activeId = typeof normalizedWork.active_reply_template_id === "string"
    ? normalizedWork.active_reply_template_id
    : "";
  const validTemplateIds = new Set(
    replyTemplates
      .filter((template) => template && typeof template.id === "string" && template.id.trim())
      .map((template) => template.id)
  );

  return {
    ...normalizedWork,
    reply_templates: replyTemplates,
    active_reply_template_id: validTemplateIds.has(activeId) ? activeId : "",
  };
}

function migrateMockReplyTemplateFields() {
  let migrated = false;
  mockWorks = mockWorks.map((work) => {
    const normalized = normalizeMockReplyTemplateFields(work);
    if (
      !work || typeof work !== "object"
      || !Array.isArray(work.reply_templates)
      || typeof work.active_reply_template_id !== "string"
      || work.active_reply_template_id !== normalized.active_reply_template_id
    ) {
      migrated = true;
    }
    return normalized;
  });
  return migrated;
}

function loadMockData() {
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_DATA_KEY) || "null");
    if (saved && Array.isArray(saved.works)) {
      mockWorks = saved.works;
      const needsReplyTemplateMigration = migrateMockReplyTemplateFields();
      const needsCardMigration = !Array.isArray(saved.cards);
      mockCards = needsCardMigration ? deriveMockCards(mockWorks) : saved.cards;
      mockConversations = saved.conversations || {};
      const needsConversationSnapshotMigration = migrateMockConversationCardSnapshots();
      mockSeq = Math.max(
        Number(saved.seq) || 0,
        mockWorks.length * 100,
        ...mockWorks.map((work) => Number(work.id) || 0),
        ...mockCards.map((card) => Number(card.id) || 0)
      );
      if (needsCardMigration || needsConversationSnapshotMigration || needsReplyTemplateMigration) saveMockData();
      return;
    }
  } catch {}
  mockWorks = JSON.parse(JSON.stringify(DEFAULT_MOCK_WORKS));
  migrateMockReplyTemplateFields();
  mockCards = deriveMockCards(mockWorks);
  mockConversations = {};
  mockSeq = Math.max(mockWorks.length * 100, ...mockCards.map((card) => Number(card.id) || 0));
  saveMockData();
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
    conversation.card_snapshot = JSON.parse(JSON.stringify(work.card));
    migrated = true;
  });
  return migrated;
}

function saveMockData() {
  localStorage.setItem(MOCK_DATA_KEY, JSON.stringify({ works: mockWorks, cards: mockCards, conversations: mockConversations, seq: mockSeq }));
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

function getMockCard(id) {
  return mockCards.find((card) => Number(card.id) === Number(id)) || null;
}

function syncMockCard(payload, id) {
  const existing = getMockCard(id);
  if (existing) {
    Object.assign(existing, payload, { id });
    return existing;
  }
  const card = { ...payload, id };
  mockCards.unshift(card);
  return card;
}

function mockListCards(query = "") {
  const q = String(query || "").trim().toLowerCase();
  return mockCards
    .filter((card) => !q || `${card.name || ""} ${card.persona || ""} ${card.personality || ""}`.toLowerCase().includes(q))
    .map((card) => JSON.parse(JSON.stringify(card)));
}

function mockListWorks(query = "", tag = "") {
  return filterWorks(
    mockWorks.map((work) => ({ ...work, card: undefined, worldbook: undefined })),
    query,
    tag
  );
}

function filterWorks(works, query, tag) {
  const q = String(query || "").trim().toLowerCase();
  return works.filter((work) => {
    const matchesQ = !q || `${work.title || ""} ${work.description || ""} ${(work.tags || []).join(" ")}`.toLowerCase().includes(q);
    const matchesTag = !tag || (work.tags || []).includes(tag);
    return matchesQ && matchesTag;
  });
}

function sortWorks(works, sort) {
  const list = [...works];
  if (sort === "newest") {
    list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  } else if (sort === "popular") {
    list.sort((a, b) => Number(b.plays || 0) - Number(a.plays || 0));
  }
  return list;
}

function createMockConversation(work) {
  const card = getMockCard(work.card_id) || work.card || {};
  const cardSnapshot = JSON.parse(JSON.stringify(card));
  const initialState = JSON.parse(JSON.stringify(card.initial_state || { attributes: {}, items: [], relations: {} }));
  initialState.money = initialState.money ?? 100;
  initialState.quests = initialState.quests || [];
  initialState.flags = initialState.flags || {};
  initialState.logs = initialState.logs || [];
  if (card.name) {
    initialState.characters = {
      [card.name]: {
        attributes: { 心情: 50, 好感度: Number(initialState.relations?.[card.name]) || 0, ...(card.character_attributes || {}) },
        flags: [],
      },
    };
  }
  const id = ++mockSeq;
  const timestamp = nowISO();
  const conv = {
    id,
    work_id: work.id,
    card_id: work.card_id || null,
    card_snapshot: cardSnapshot,
    title: work.title,
    status: "active",
    current_state: JSON.parse(JSON.stringify(initialState)),
    created_at: timestamp,
    updated_at: timestamp,
    messages: [{ id: `m${id}-0`, role: "system", content: work.opening || "故事从这里开始。", created_at: timestamp }],
    snapshots: [],
    state: JSON.parse(JSON.stringify(initialState)),
  };
  mockConversations[id] = conv;
  return conv;
}

async function listAllPages(path, params = {}) {
  const pageSize = 100;
  const items = [];
  for (let page = 1; ; page += 1) {
    const search = new URLSearchParams({ ...params, page: String(page), page_size: String(pageSize) });
    const data = await api(`${path}?${search.toString()}`);
    const pageItems = toItems(data);
    items.push(...pageItems);
    const total = Number(data?.total);
    if (Number.isFinite(total) && items.length >= total) break;
    if (pageItems.length < pageSize) break;
  }
  return items;
}

async function listAllWorks(query = "", tag = "") {
  if (MODE === "offline") return mockListWorks(query, tag);
  const params = {};
  if (query) params.q = query;
  if (tag) params.tag = tag;
  return listAllPages("/api/works", params);
}

async function listWorks(query = "", tag = "") {
  return listAllWorks(query, tag);
}

async function getWork(id) {
  if (MODE === "offline") {
    const work = mockWorks.find((item) => item.id === Number(id));
    if (!work) throw new Error("作品不存在");
    return JSON.parse(JSON.stringify(work));
  }
  return api(`/api/works/${id}`);
}

async function getCard(id) {
  if (!id) return null;
  if (MODE === "offline") {
    const card = getMockCard(id);
    if (!card) throw new Error("角色卡不存在");
    return JSON.parse(JSON.stringify(card));
  }
  return api(`/api/cards/${id}`);
}

async function listAllCards(query = "") {
  if (MODE === "offline") return mockListCards(query);
  return listAllPages("/api/cards", query ? { q: query } : {});
}

async function listCards(query = "") {
  return listAllCards(query);
}

async function createCard(payload) {
  if (MODE === "offline") {
    const timestamp = nowISO();
    const card = { id: ++mockSeq, ...payload, created_at: timestamp, updated_at: timestamp };
    mockCards.unshift(card);
    saveMockData();
    return JSON.parse(JSON.stringify(card));
  }
  return api("/api/cards", { method: "POST", body: payload });
}

async function updateCard(id, payload) {
  if (MODE === "offline") {
    const card = getMockCard(id);
    if (!card) throw new Error("角色卡不存在");
    Object.assign(card, payload, { id: card.id, updated_at: nowISO() });
    saveMockData();
    return JSON.parse(JSON.stringify(card));
  }
  return api(`/api/cards/${id}`, { method: "PUT", body: payload });
}

async function deleteCard(id) {
  if (MODE === "offline") {
    mockCards = mockCards.filter((card) => Number(card.id) !== Number(id));
    saveMockData();
    return;
  }
  await api(`/api/cards/${id}`, { method: "DELETE" });
}

async function getWorldbook(id) {
  if (!id || MODE === "offline") return null;
  return api(`/api/worldbooks/${id}`);
}

async function getWorldbookEntries(id) {
  if (!id || MODE === "offline") return [];
  const data = await api(`/api/worldbooks/${id}/entries`);
  return toItems(data);
}

async function createConversation(workId) {
  const work = await getWork(workId);
  if (MODE === "offline") return createMockConversation(work);
  return api("/api/conversations", { method: "POST", body: { work_id: workId, title: work.title } });
}

async function listConversations(workId) {
  if (MODE === "offline") {
    return Object.values(mockConversations)
      .filter((conversation) => Number(conversation.work_id) === Number(workId))
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  }
  const params = new URLSearchParams({ work_id: String(workId), page: "1", page_size: "100" });
  const data = await api(`/api/conversations?${params.toString()}`);
  return toItems(data);
}

async function getMessages(conversationId) {
  if (MODE === "offline") return JSON.parse(JSON.stringify(mockConversations[conversationId].messages || []));
  const data = await api(`/api/conversations/${conversationId}/messages`);
  return toItems(data);
}

async function getState(conversationId) {
  if (MODE === "offline") return JSON.parse(JSON.stringify(mockConversations[conversationId].state || {}));
  return api(`/api/conversations/${conversationId}/state`);
}

async function getSnapshots(conversationId) {
  if (MODE === "offline") return JSON.parse(JSON.stringify(mockConversations[conversationId].snapshots || []));
  const data = await api(`/api/conversations/${conversationId}/snapshots`);
  return toItems(data);
}

async function createSnapshot(conversationId, name) {
  if (MODE === "offline") {
    const conv = mockConversations[conversationId];
    const snapshot = {
      id: ++mockSeq,
      conversation_id: conversationId,
      name: name || "未命名存档",
      state: JSON.parse(JSON.stringify(conv.state)),
      created_at: nowISO(),
      note: "手动存档",
    };
    conv.snapshots.unshift(snapshot);
    saveMockData();
    return snapshot;
  }
  return api(`/api/conversations/${conversationId}/snapshots`, {
    method: "POST",
    body: { name: name || "未命名存档", note: "手动存档" },
  });
}

async function restoreSnapshot(conversationId, snapshotId) {
  if (MODE === "offline") {
    const conv = mockConversations[conversationId];
    const snapshot = conv.snapshots.find((item) => item.id === Number(snapshotId));
    if (!snapshot) throw new Error("存档不存在");
    conv.state = JSON.parse(JSON.stringify(snapshot.state));
    saveMockData();
    return conv.state;
  }
  const data = await api(`/api/conversations/${conversationId}/snapshots/${snapshotId}/restore`, { method: "POST" });
  return data.state || {};
}

async function deleteSnapshot(conversationId, snapshotId) {
  if (MODE === "offline") {
    const conv = mockConversations[conversationId];
    conv.snapshots = conv.snapshots.filter((item) => item.id !== Number(snapshotId));
    saveMockData();
    return;
  }
  await api(`/api/conversations/${conversationId}/snapshots/${snapshotId}`, { method: "DELETE" });
}

async function deleteConversation(conversationId) {
  if (MODE === "offline") {
    delete mockConversations[conversationId];
    saveMockData();
    return;
  }
  await api(`/api/conversations/${conversationId}`, { method: "DELETE" });
}

async function deleteWork(workId) {
  if (MODE === "offline") {
    mockWorks = mockWorks.filter((work) => Number(work.id) !== Number(workId));
    Object.values(mockConversations).forEach((conversation) => {
      if (Number(conversation.work_id) === Number(workId)) conversation.work_id = null;
    });
    saveMockData();
    return;
  }
  await api(`/api/works/${workId}`, { method: "DELETE" });
}

async function updateConversation(conversationId, title) {
  if (MODE === "offline") {
    const conversation = mockConversations[conversationId];
    if (!conversation) throw new Error("会话不存在");
    conversation.title = title;
    conversation.updated_at = nowISO();
    saveMockData();
    return conversation;
  }
  return api(`/api/conversations/${conversationId}`, { method: "PUT", body: { title } });
}

async function streamChat(conversationId, content, handlers) {
  if (MODE === "offline") {
    await mockStreamChat(conversationId, content, handlers);
    return;
  }
  let response;
  try {
    response = await fetch(`/api/conversations/${conversationId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (error) {
    handlers.onError?.(error.message || "无法连接对话接口");
    handlers.onFinish?.();
    return;
  }
  if (!response.ok || !response.body) {
    let message = "对话接口返回错误";
    try {
      const data = await response.json();
      message = (data && data.error && data.error.message) || message;
    } catch {}
    handlers.onError?.(message);
    handlers.onFinish?.();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  const processSseLine = (line) => {
    if (line.startsWith("event: ")) {
      eventName = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      let data;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        return;
      }
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
        for (const line of buffer.split(/\r?\n/)) processSseLine(line);
        buffer = "";
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) processSseLine(line);
    }
  } catch (error) {
    handlers.onError?.(error.message || "流式响应中断");
  }
  handlers.onFinish?.();
}

function summarizeState(state) {
  const attrs = Object.entries(state.attributes || {})
    .map(([key, value]) => `${key} ${value}`)
    .join("，") || "无";
  const items = (state.items || []).join("、") || "空";
  return `属性：${attrs}\n金钱：${state.money ?? 0}\n背包：${items}`;
}

function mockReply(content, state) {
  const text = String(content || "").trim();
  if (text.startsWith("/status") || text.startsWith("/状态")) {
    return `当前状态：\n${summarizeState(state)}`;
  }
  if (text.startsWith("/inventory") || text.startsWith("/背包")) {
    const items = (state.items || []).join("、") || "空";
    return `背包：${items}\n金钱：${state.money ?? 0}`;
  }
  if (text.startsWith("/save") || text.startsWith("/存档")) {
    return "进度已保存。你可以在右侧存档列表里恢复。";
  }
  if (text.startsWith("/help") || text.startsWith("/帮助")) {
    return "可用指令：/状态、/背包、/存档、/帮助。";
  }
  const replies = [
    `你${text}。雾气在灯下翻涌，远处传来一声钟响。\n「继续走，别回头。」\n选项：\n- 询问铁鸦王都的传闻\n- 递出那封旧信\n- 转身离开城门`,
    `你${text}。烛火晃了晃，旧木门发出吱呀声。\n你的心跳漏了一拍，但你没有停下。\n选项：\n- 压低声音继续前进\n- 先观察周围\n- 呼叫同伴`,
    `你${text}。夜色被拉得很长，巷口的灯笼突然熄灭。\n有什么东西在阴影里移动。\n选项：\n- 握紧武器\n- 朝阴影喊话\n- 快步离开`,
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

function applyMockStateDelta(conv, content) {
  const state = conv.state;
  if (/剑|刀|武器|装备/.test(content)) {
    const item = "旧铁剑";
    if (!state.items.includes(item)) state.items.push(item);
  }
  if (/金币|钱|报酬/.test(content)) {
    state.money = (state.money || 0) + 20;
  }
  if (/救|帮助|委托/.test(content) && !(state.quests || []).some((quest) => quest.title.includes("委托"))) {
    state.quests.push({ title: "完成城中委托", status: "进行中" });
  }
  if (!state.logs) state.logs = [];
  state.logs.unshift({ type: "mock", message: "状态随剧情轻微变化", time: nowISO() });
}

async function mockStreamChat(conversationId, content, handlers) {
  const conv = mockConversations[conversationId];
  if (!conv) {
    handlers.onError?.("会话不存在");
    handlers.onFinish?.();
    return;
  }
  const timestamp = nowISO();
  conv.messages.push({ id: `m${++mockSeq}`, role: "user", content, created_at: timestamp });
  saveMockData();
  handlers.onMeta?.({ conversation_id: conversationId, message_id: `m${mockSeq}` });
  const reply = mockReply(content, conv.state);
  const chunks = reply.match(/[\s\S]{1,4}/g) || [];
  let acc = "";
  for (const chunk of chunks) {
    acc += chunk;
    handlers.onDelta?.(chunk);
    await sleep(28);
  }
  applyMockStateDelta(conv, content);
  conv.messages.push({ id: `m${++mockSeq}`, role: "assistant", content: acc, created_at: nowISO() });
  conv.snapshots.unshift({
    id: ++mockSeq,
    conversation_id: conversationId,
    name: `自动存档 ${conv.snapshots.length + 1}`,
    state: JSON.parse(JSON.stringify(conv.state)),
    created_at: nowISO(),
    note: "自动存档",
  });
  saveMockData();
  handlers.onState?.({ current_state: JSON.parse(JSON.stringify(conv.state)) });
  handlers.onDone?.({ message_id: `m${mockSeq}`, usage: { total_tokens: acc.length } });
  handlers.onFinish?.();
}

async function seedDemo() {
  if (MODE === "offline") {
    mockWorks = JSON.parse(JSON.stringify(DEFAULT_MOCK_WORKS));
    mockCards = deriveMockCards(mockWorks);
    saveMockData();
    toast("已载入示例作品", "success");
    return;
  }
  const sample = DEFAULT_MOCK_WORKS[0];
  try {
    const card = await api("/api/cards", { method: "POST", body: sample.card });
    const worldbook = await api("/api/worldbooks", {
      method: "POST",
      body: { title: sample.worldbook.title, description: sample.worldbook.description },
    });
    for (const entry of sample.worldbook.entries) {
      await api(`/api/worldbooks/${worldbook.id}/entries`, { method: "POST", body: entry });
    }
    await api("/api/works", {
      method: "POST",
      body: {
        title: sample.title,
        description: sample.description,
        card_id: card.id,
        worldbook_id: worldbook.id,
        opening: sample.opening,
        tags: sample.tags,
      },
    });
    toast("已创建示例作品", "success");
  } catch (error) {
    toast(error.message || "载入示例失败", "error");
  }
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, id] = hash.split("/");
  if (name === "work" && id) return { name: "work", id: Number(id) };
  if (name === "adventure" && id) return { name: "adventure", id: Number(id) };
  if (name === "onboarding" && id) return { name: "onboarding", id: Number(id) };
  if (name === "cards") return { name: "cards" };
  if (name === "card" && id === "new") return { name: "card", id: null };
  if (name === "card" && id) return { name: "card", id: Number(id) };
  if (name === "creator") return { name: "creator", id: id ? Number(id) : null };
  if (name === "settings") return { name: "settings" };
  return { name: "library" };
}

function adventureHash() {
  return session?.conv ? `#/adventure/${session.conv.id}` : "";
}

function hasUnsavedAdventureProgress() {
  return Boolean(session?.conv && (session.streaming || session.hasUnsavedProgress));
}

function commitNavigation(hash) {
  if (location.hash === hash) return;
  bypassAdventureLeavePrompt = true;
  location.hash = hash;
}

function requestAdventureLeave(targetHash) {
  if (!hasUnsavedAdventureProgress() || targetHash === adventureHash()) {
    commitNavigation(targetHash);
    return;
  }

  const { close, backdrop } = openModal(`
    <h2>保存冒险进度？</h2>
    <p>本次冒险自上次存档后已有新进度。你可以先创建一个存档，再离开当前对话。</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" data-close>继续冒险</button>
      <button class="btn btn-ghost" type="button" data-leave-without-save>直接离开</button>
      <button class="btn btn-primary" type="button" data-save-and-leave>先存档并离开</button>
    </div>
  `);
  const saveAndLeaveButton = backdrop.querySelector("[data-save-and-leave]");
  backdrop.querySelector("[data-leave-without-save]")?.addEventListener("click", () => {
    close();
    commitNavigation(targetHash);
  });
  saveAndLeaveButton?.addEventListener("click", async () => {
    const activeSession = session;
    if (!activeSession) return;
    saveAndLeaveButton.disabled = true;
    saveAndLeaveButton.textContent = "正在存档…";
    try {
      await createSnapshot(activeSession.conv.id, "离开前存档");
      activeSession.hasUnsavedProgress = false;
      close();
      commitNavigation(targetHash);
    } catch (error) {
      saveAndLeaveButton.disabled = false;
      saveAndLeaveButton.textContent = "先存档并离开";
      toast(error.message || "存档失败，请稍后重试", "error");
    }
  });
}

function navigate(hash) {
  requestAdventureLeave(hash);
}

function handleHashChange() {
  const targetHash = location.hash || "#/";
  if (bypassAdventureLeavePrompt) {
    bypassAdventureLeavePrompt = false;
    route();
    return;
  }
  if (hasUnsavedAdventureProgress() && targetHash !== adventureHash()) {
    history.replaceState(null, "", adventureHash());
    requestAdventureLeave(targetHash);
    return;
  }
  route();
}

function handleBeforeUnload(event) {
  if (!hasUnsavedAdventureProgress()) return;
  event.preventDefault();
  event.returnValue = "";
}

async function route() {
  const current = parseRoute();
  document.querySelectorAll(".nav-links a").forEach((link) => {
    const nav = link.dataset.nav || "";
    const active = (nav === "library" && current.name === "library")
      || (nav === "cards" && (current.name === "cards" || current.name === "card"))
      || nav === current.name;
    link.classList.toggle("active", active);
  });
  session = null;
  try {
    if (current.name === "work") await renderWorkDetail(current.id);
    else if (current.name === "adventure") await renderAdventure(current.id);
    else if (current.name === "onboarding") await renderOnboarding(current.id);
    else if (current.name === "cards") await renderCards();
    else if (current.name === "card") await renderCardEditor(current.id);
    else if (current.name === "creator") await renderCreator(current.id);
    else if (current.name === "settings") await renderSettings();
    else await renderLibrary();
  } catch (error) {
    appEl.innerHTML = `
      <div class="page">
        <div class="empty-state">${icon("alert")}<h3>页面加载失败</h3><p>${esc(error.message || "发生了未知错误")}</p>
        <div class="detail-actions"><button class="btn btn-primary" data-go-library>${icon("arrow-left")} 返回作品库</button></div>
      </div>`;
    $("[data-go-library]")?.addEventListener("click", () => navigate("#/"));
  }
  mountIcons(appEl);
}

function loadingHtml() {
  return `<div class="loading">加载中...</div>`;
}

function emptyHtml(title, subtitle, actionsHtml = "") {
  return `
    <div class="empty-state">
      ${icon("book")}
      <h3>${esc(title)}</h3>
      <p>${esc(subtitle)}</p>
      ${actionsHtml ? `<div class="detail-actions">${actionsHtml}</div>` : ""}
  </div>`;
}

function isRoleCard(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

function normalizeRoleCards(cards, legacyCard = null) {
  const list = Array.isArray(cards)
    ? cards
    : (isRoleCard(cards) ? [cards] : (isRoleCard(legacyCard) ? [legacyCard] : []));
  return list.filter(isRoleCard);
}

function orderedWorkCards(work = {}) {
  const cards = normalizeRoleCards(work.cards, work.card);
  const hasCardIds = Object.prototype.hasOwnProperty.call(work, "card_ids");
  if (!hasCardIds) return cards;

  const cardIds = Array.isArray(work.card_ids)
    ? work.card_ids.map(Number).filter(Number.isFinite)
    : [];
  if (!cardIds.length || !cards.length) return [];

  const cardsById = new Map(cards.map((card) => [Number(card.id), card]));
  const usedIds = new Set();
  const ordered = cardIds.flatMap((cardId) => {
    const card = cardsById.get(cardId);
    if (!card || usedIds.has(cardId)) return [];
    usedIds.add(cardId);
    return [card];
  });
  return ordered;
}

function resolveSessionCards(conversation = {}, work = {}) {
  if (Array.isArray(conversation.card_snapshots)) {
    return normalizeRoleCards(conversation.card_snapshots);
  }
  const legacySnapshots = normalizeRoleCards(null, conversation.card_snapshot);
  return legacySnapshots.length ? legacySnapshots : orderedWorkCards(work);
}

function cardSummaryText(cards = []) {
  const names = normalizeRoleCards(cards)
    .map((card) => String(card.name || "未命名角色").trim())
    .filter(Boolean);
  return names.length ? names.join("、") : "暂无角色";
}

function roleCardSummaryHtml(cards = []) {
  const resolvedCards = normalizeRoleCards(cards);
  if (!resolvedCards.length) return '<span class="role-card-summary empty">暂无角色</span>';
  return `<span class="role-card-summary">角色：${esc(cardSummaryText(resolvedCards))}</span>`;
}

function workCardHtml(work) {
  const tone = `cover-${(Number(work.id) % 6) + 1}`;
  const tags = (work.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
  const cards = orderedWorkCards(work);
  return `
    <article class="work-card" data-work-id="${Number(work.id)}">
      ${coverHtml(work, tone)}
      <div class="work-card-body">
        <h3 class="work-card-title">${esc(work.title)}</h3>
        <p class="work-card-description">${esc(work.description || "")}</p>
        ${roleCardSummaryHtml(cards)}
        ${tags ? `<div class="tag-list">${tags}</div>` : ""}
        <div class="work-card-meta">
          <span>${icon("clock")} ${formatTime(work.created_at)}</span>
          <span>${icon("users")} ${Number(work.plays || 0)} 次游玩</span>
        </div>
        <div class="work-card-actions">
          <button class="btn btn-sm btn-ghost" data-action="view">${icon("eye")} 查看</button>
          <button class="btn btn-sm btn-primary" data-action="start">${icon("play")} 开始</button>
        </div>
      </div>
    </article>`;
}

function coverHtml(work, tone) {
  const image = work.cover_url ? `<img class="cover-image" src="${esc(work.cover_url)}" alt="${esc(work.title)} 封面">` : "";
  return `<div class="cover ${tone}">${image}<div class="cover-inner"><p class="cover-kicker">AI 对话冒险</p><h3 class="cover-title">${esc(work.title)}</h3></div></div>`;
}

async function renderLibrary() {
  let all = [];
  try {
    all = await listWorks("", "");
  } catch (error) {
    toast(error.message || "作品列表加载失败", "error");
  }
  const tags = [...new Set(all.flatMap((work) => work.tags || []))].sort((a, b) => a.localeCompare(b, "zh"));
  const filtered = sortWorks(filterWorks(all, libraryFilter.q, libraryFilter.tag), libraryFilter.sort);
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">作品库</h1>
          <p class="page-subtitle">选择一张角色卡，进入属于你的文字冒险。</p>
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary" id="creator-btn">${icon("pen")} 创作作品</button>
        </div>
      </div>
      <div class="toolbar">
        <label class="field search-field">
          <span class="field-label">搜索</span>
          <input id="library-search" class="input" type="search" placeholder="搜索作品或标签" value="${esc(libraryFilter.q)}">
        </label>
        <label class="field">
          <span class="field-label">标签</span>
          <select id="library-tag" class="select">
            <option value="">全部标签</option>
            ${tags.map((tag) => `<option value="${esc(tag)}" ${libraryFilter.tag === tag ? "selected" : ""}>${esc(tag)}</option>`).join("")}
          </select>
        </label>
        <div class="segmented" id="sort-segment">
          <button data-sort="recommend" class="${libraryFilter.sort === "recommend" ? "active" : ""}">推荐</button>
          <button data-sort="newest" class="${libraryFilter.sort === "newest" ? "active" : ""}">最新</button>
          <button data-sort="popular" class="${libraryFilter.sort === "popular" ? "active" : ""}">热门</button>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="demo-btn">${icon("download")} 载入示例</button>
      </div>
      <div id="work-grid" class="work-grid">${loadingHtml()}</div>
    </div>`;

  const grid = $("#work-grid");
  if (filtered.length) {
    grid.innerHTML = filtered.map(workCardHtml).join("");
  } else {
    const actions = `
      <button class="btn btn-primary" data-grid-action="creator">${icon("pen")} 创作作品</button>
      <button class="btn" data-grid-action="demo">${icon("download")} 载入示例</button>`;
    grid.innerHTML = emptyHtml(
      "没有找到作品",
      libraryFilter.q || libraryFilter.tag ? "换个关键词或标签试试。" : "创建第一个作品，或载入示例。",
      actions
    );
  }
  bindLibraryEvents();
}

function bindLibraryEvents() {
  const search = $("#library-search");
  if (search) {
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        libraryFilter.q = search.value.trim();
        renderLibrary();
      }, 250);
    });
  }
  const tag = $("#library-tag");
  if (tag) {
    tag.addEventListener("change", () => {
      libraryFilter.tag = tag.value;
      renderLibrary();
    });
  }
  const segment = $("#sort-segment");
  if (segment) {
    segment.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        libraryFilter.sort = btn.dataset.sort;
        renderLibrary();
      });
    });
  }
  $("#creator-btn")?.addEventListener("click", () => navigate("#/creator"));
  $("#demo-btn")?.addEventListener("click", async () => {
    await seedDemo();
    renderLibrary();
  });
  const grid = $("#work-grid");
  grid?.addEventListener("click", async (event) => {
    const gridAction = event.target.closest("[data-grid-action]");
    if (gridAction) {
      if (gridAction.dataset.gridAction === "creator") navigate("#/creator");
      else if (gridAction.dataset.gridAction === "demo") {
        await seedDemo();
        renderLibrary();
      }
      return;
    }
    const card = event.target.closest(".work-card");
    if (!card) return;
    const workId = Number(card.dataset.workId);
    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn?.dataset.action === "start") await startWork(workId);
    else navigate(`#/work/${workId}`);
  });
}

async function startWork(workId) {
  try {
    const conversation = await createConversation(workId);
    toast("冒险已开始", "success");
    navigate(`#/adventure/${conversation.id}`);
  } catch (error) {
    toast(error.message || "无法开始冒险", "error");
  }
}

function renderCardPanel(card) {
  const directives = (card.directives || []).map((item) => `<span class="tag">${esc(item)}</span>`).join("");
  const relations = Object.entries(card.relationships || {})
    .map(([name, desc]) => `<div class="state-row"><strong>${esc(name)}</strong><span>${esc(desc)}</span></div>`)
    .join("");
  const attrs = Object.entries(card.initial_state?.attributes || {})
    .map(([name, value]) => `<div class="state-row"><strong>${esc(name)}</strong><span>${esc(value)}</span></div>`)
    .join("");
  return `
    <section class="section">
      <h2 class="section-title">角色卡：${esc(card.name || "未命名")}</h2>
      <div class="panel"><div class="panel-body section">
        <p class="detail-description">${esc(card.persona || "")}</p>
        ${card.personality ? `<p class="detail-description"><strong>性格</strong>：${esc(card.personality)}</p>` : ""}
        ${card.speaking_style ? `<p class="detail-description"><strong>语气</strong>：${esc(card.speaking_style)}</p>` : ""}
        ${directives ? `<div class="tag-list">${directives}</div>` : ""}
        ${relations ? `<div class="state-list">${relations}</div>` : ""}
        ${attrs ? `<div class="state-list">${attrs}</div>` : ""}
      </div></div>
  </section>`;
}

function renderCardsPanel(cards = []) {
  const resolvedCards = normalizeRoleCards(cards);
  if (!resolvedCards.length) {
    return `
      <section class="section">
        <h2 class="section-title">角色卡</h2>
        <div class="panel"><div class="panel-body section"><p class="detail-description">暂无角色。本次剧本不使用角色卡。</p></div></div>
      </section>`;
  }
  return resolvedCards.map(renderCardPanel).join("");
}

function renderWorldbookPanel(worldbook, entries = []) {
  const entryHtml = entries.map((entry) => `
    <div class="entry-card">
      <div class="entry-card-header">
        <strong>${esc(entry.title || "条目")}</strong>
        <span class="tag">优先级 ${Number(entry.priority || 0)}</span>
      </div>
      <div class="tag-list">${(entry.keywords || []).map((keyword) => `<span class="tag">${esc(keyword)}</span>`).join("")}</div>
      <p class="detail-description">${esc(entry.content || "")}</p>
    </div>`).join("");
  return `
    <section class="section">
      <h2 class="section-title">世界书：${esc(worldbook.title || "未命名")}</h2>
      <div class="panel"><div class="panel-body section">
        <p class="detail-description">${esc(worldbook.description || "")}</p>
        ${entryHtml ? `<div class="entry-list">${entryHtml}</div>` : `<div class="state-row"><strong>暂无条目</strong><span>世界书</span></div>`}
      </div></div>
    </section>`;
}

async function renderWorkDetail(workId) {
  const work = await getWork(workId);
  let cards = orderedWorkCards(work);
  if (!cards.length && workCardIds(work).length) {
    cards = (await Promise.all(workCardIds(work).map((cardId) => getCard(cardId)))).filter(Boolean);
  }
  const worldbook = MODE === "offline" ? work.worldbook || null : await getWorldbook(work.worldbook_id);
  const entries = MODE === "offline" ? (worldbook?.entries || []) : await getWorldbookEntries(work.worldbook_id);
  const tone = `cover-${(Number(work.id) % 6) + 1}`;
  const tags = (work.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join("");
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">${esc(work.title)}</h1>
          <p class="page-subtitle">作品详情</p>
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost" id="back-btn">${icon("arrow-left")} 返回</button>
        </div>
      </div>
      <div class="detail-layout">
        <div class="detail-hero">
          ${coverHtml(work, tone)}
        </div>
        <div class="detail-main">
          <div class="panel">
            <div class="panel-body section">
              <h2 class="detail-title">${esc(work.title)}</h2>
              ${tags ? `<div class="tag-list">${tags}</div>` : ""}
              <p class="detail-description">${esc(work.description || "")}</p>
              <div class="detail-meta">
                <span>创建于 ${formatTime(work.created_at)}</span>
                <span>${roleCardSummaryHtml(cards)}</span>
                <span>${worldbook ? `世界书：${esc(worldbook.title)}` : "无世界书"}</span>
              </div>
              <div class="detail-actions">
                <button class="btn btn-primary" id="start-btn">${icon("play")} 开始冒险</button>
                <button class="btn btn-ghost" id="edit-work-btn">${icon("pen")} 编辑作品</button>
                <button class="btn btn-danger" id="delete-work-btn">${icon("trash")} 删除剧本</button>
              </div>
            </div>
          </div>
          <section class="section">
            <h2 class="section-title">开场剧情</h2>
            <div class="panel"><div class="panel-body message ai"><span class="message-label">开场</span><span>${esc(work.opening || "故事从这里开始。")}</span></div></div>
          </section>
          <section class="section" aria-labelledby="conversation-section-title">
            <div class="section-head">
              <div>
                <h2 class="section-title" id="conversation-section-title">冒险记录</h2>
                <p class="section-hint">从上次离开的地方继续，或开启一段新的冒险。</p>
              </div>
              <button class="btn btn-primary btn-sm" id="new-adventure-btn">${icon("play")} 新建冒险</button>
            </div>
            <div class="panel"><div class="panel-body" id="conversation-list" aria-live="polite">${conversationListLoadingHtml()}</div></div>
          </section>
          ${renderCardsPanel(cards)}
          ${worldbook ? renderWorldbookPanel(worldbook, entries) : ""}
        </div>
      </div>
    </div>`;
  $("#back-btn")?.addEventListener("click", () => navigate("#/"));
  $("#start-btn")?.addEventListener("click", () => startWork(workId));
  $("#edit-work-btn")?.addEventListener("click", () => navigate(`#/creator/${workId}`));
  $("#delete-work-btn")?.addEventListener("click", async () => {
    const message = `确定删除《${work.title}》吗？\n\n只会删除剧本本身；角色卡、世界书会保留。已有冒险记录也会保留，但不再关联此剧本。`;
    if (!confirm(message)) return;
    try {
      await deleteWork(workId);
      toast("剧本已删除", "success");
      navigate("#/");
    } catch (error) {
      toast(error.message || "删除剧本失败", "error");
    }
  });
  $("#new-adventure-btn")?.addEventListener("click", () => startWork(workId));
  loadConversationList(workId);
}

function conversationListLoadingHtml() {
  return `<div class="conversation-list-status">${icon("refresh")}<span>正在读取冒险记录…</span></div>`;
}

function conversationListHtml(conversations) {
  if (!conversations.length) {
    return `<div class="empty-state conversation-empty">${icon("book")}<h3>还没有冒险记录</h3><p>点击“新建冒险”，让故事从这里开始。</p></div>`;
  }
  return `<div class="conversation-list">${conversations.map((conversation) => {
    const title = conversation.title || "未命名冒险";
    const time = conversation.updated_at || conversation.last_message_at || conversation.created_at;
    const status = conversation.status === "completed" ? "已结束" : "进行中";
    return `<div class="conversation-row">
      <div class="conversation-row-main">
        <h3 class="conversation-row-title">${esc(title)}</h3>
        <p class="conversation-row-meta">${esc(status)} · 最近更新 ${esc(formatTime(time))}</p>
      </div>
      <div class="conversation-row-actions">
        <button type="button" class="btn btn-sm btn-primary" data-conversation-open="${Number(conversation.id)}">继续</button>
        <button type="button" class="btn btn-sm btn-ghost" data-conversation-rename="${Number(conversation.id)}">重命名</button>
        <button type="button" class="icon-btn btn-sm" data-conversation-delete="${Number(conversation.id)}" title="删除此冒险" aria-label="删除此冒险">${icon("trash")}</button>
      </div>
    </div>`;
  }).join("")}</div>`;
}

async function loadConversationList(workId) {
  const list = $("#conversation-list");
  if (!list) return;
  list.innerHTML = conversationListLoadingHtml();
  try {
    const conversations = await listConversations(workId);
    if (!list.isConnected) return;
    list.innerHTML = conversationListHtml(conversations);
    bindConversationListEvents(list, workId, conversations);
  } catch (error) {
    if (!list.isConnected) return;
    list.innerHTML = `<div class="conversation-list-error">${icon("alert")}<span>冒险记录加载失败：${esc(error.message || "请稍后重试")}</span><button type="button" class="btn btn-sm btn-ghost" data-conversation-retry>重试</button></div>`;
    list.querySelector("[data-conversation-retry]")?.addEventListener("click", () => loadConversationList(workId));
  }
}

function bindConversationListEvents(list, workId, conversations = []) {
  list.querySelectorAll("[data-conversation-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const conversation = conversations.find((item) => Number(item.id) === Number(button.dataset.conversationOpen));
      navigate(`#/adventure/${button.dataset.conversationOpen}`);
    });
  });
  list.querySelectorAll("[data-conversation-rename]").forEach((button) => {
    button.addEventListener("click", async () => {
      const conversation = conversations.find((item) => Number(item.id) === Number(button.dataset.conversationRename));
      const title = window.prompt("冒险名称", conversation?.title || "未命名冒险");
      const trimmedTitle = title?.trim();
      if (!trimmedTitle) return;
      try {
        await updateConversation(Number(button.dataset.conversationRename), trimmedTitle);
        toast("冒险名称已更新", "success");
        await loadConversationList(workId);
      } catch (error) {
        toast(error.message || "重命名失败", "error");
      }
    });
  });
  list.querySelectorAll("[data-conversation-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("删除这个冒险会话？对话和存档都会消失。")) return;
      button.disabled = true;
      try {
        await deleteConversation(Number(button.dataset.conversationDelete));
        toast("会话已删除", "success");
        await loadConversationList(workId);
      } catch (error) {
        button.disabled = false;
        toast(error.message || "删除失败", "error");
      }
    });
  });
}

function stateChangeLineHtml(line) {
  const label = String(line || "").replace(/^\s*-\s*/, "");
  let changeClass = "state-change-neutral";
  let isNumeric = false;
  if (/\s\+\d+(?:\.\d+)?\s*$/.test(label)) {
    changeClass = "state-change-positive";
    isNumeric = true;
  } else if (/\s-\d+(?:\.\d+)?\s*$/.test(label)) {
    changeClass = "state-change-negative";
    isNumeric = true;
  } else if (label.includes("获得：")) {
    changeClass = "state-change-item-gain";
  } else if (label.includes("失去：")) {
    changeClass = "state-change-item-loss";
  } else if (label.includes("新增状态：")) {
    changeClass = "state-change-flag-add";
  } else if (label.includes("移除状态：")) {
    changeClass = "state-change-flag-remove";
  }
  const content = esc(label);
  const styled = isNumeric
    ? `<strong><em class="state-change ${changeClass}">${content}</em></strong>`
    : `<span class="state-change ${changeClass}">${content}</span>`;
  return `- ${styled}`;
}

function messageTextHtml(content) {
  let inStateChanges = false;
  return String(content || "").split(/\r?\n/).map((line) => {
    if (line === "【状态变化】") {
      inStateChanges = true;
      return `<span class="state-changes-title">${esc(line)}</span>`;
    }
    if (inStateChanges && /^\s*-\s+/.test(line)) return stateChangeLineHtml(line);
    if (line.trim()) inStateChanges = false;
    return esc(line);
  }).join("\n");
}

function messageHtml(message) {
  const role = message.role === "user" ? "user" : message.role === "system" ? "system" : "ai";
  const label = role === "user" ? "你" : role === "system" ? "系统" : "AI";
  const options = role === "ai" ? messageOptionsHtml(message.content, message.metadata?.options || []) : "";
  return `<div class="message ${role}" data-message-id="${esc(message.id || "")}"><span class="message-label">${label}</span><span class="message-text">${messageTextHtml(message.content)}</span>${options}</div>`;
}

function renderMessages() {
  const list = $("#message-list");
  if (!list) return;
  if (!session.messages.length) {
    list.innerHTML = `<div class="empty-state">${icon("book")}<p>故事还没有开始。</p></div>`;
    return;
  }
  list.innerHTML = session.messages.map(messageHtml).join("");
  bindMessageOptionEvents(list);
}

function scrollMessages() {
  const list = $("#message-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function appendLocalMessage(role, content) {
  const message = { id: `local-${Date.now()}-${Math.random()}`, role, content, created_at: nowISO() };
  session.messages.push(message);
  const list = $("#message-list");
  const holder = document.createElement("div");
  holder.innerHTML = messageHtml(message);
  const el = holder.firstElementChild;
  list?.appendChild(el);
  scrollMessages();
  return el;
}

function createStreamingMessage() {
  const list = $("#message-list");
  const el = document.createElement("div");
  el.className = "message ai streaming";
  el.innerHTML = `<span class="message-label">AI</span><span class="message-text"></span>`;
  list?.appendChild(el);
  scrollMessages();
  return el.querySelector(".message-text");
}

function setStreamingUi(streaming) {
  if (!session) return;
  session.streaming = streaming;
  const sendBtn = $("#send-btn");
  const stopBtn = $("#stop-btn");
  const input = $("#composer-input");
  if (sendBtn) sendBtn.disabled = streaming;
  if (stopBtn) stopBtn.style.display = streaming ? "" : "none";
  if (input) input.disabled = streaming;
  const headerMeta = $(".conversation-header-title span");
  if (headerMeta) {
    headerMeta.textContent = streaming ? "AI 正在书写..." : `${session.messages.length} 条消息 · 自动存档已开启`;
  }
}

function extractOptions(text) {
  const lines = String(text || "").split(/\r?\n/);
  const options = [];
  let collecting = false;
  const addInline = (value) => {
    if (!value) return;
    const pieces = value.split(/\s*(?=(?:\d+[.)、．]|[-•·])\s+)/).flatMap((item) => {
      const trimmed = item.trim();
      if (/^\d+[.)、．]\s*/.test(trimmed)) return [trimmed.replace(/^\d+[.)、．]\s*/, "")];
      if (/^[-•·]\s*/.test(trimmed)) return [trimmed.replace(/^[-•·]\s*/, "")];
      return trimmed.split(/[；;]/).map((part) => part.trim());
    });
    options.push(...pieces.filter(Boolean));
  };
  for (const raw of lines) {
    const line = raw.trim().replace(/^\*+|\*+$/g, "").trim();
    const heading = line.match(/^(选项|可选行动|行动)\s*[:：]?\s*(.*)$/);
    if (heading) {
      collecting = true;
      addInline(heading[2]);
      continue;
    }
    const bullet = line.match(/^(?:[-•·]|\d+[.)、．])\s*(.+)$/);
    if (collecting && bullet) {
      options.push(bullet[1].replace(/^\*+|\*+$/g, "").trim());
      continue;
    }
    if (collecting && line) collecting = false;
  }
  if (!options.length) options.push(...extractImplicitOptions(text));
  if (!options.length) {
    const match = String(text || "").match(/[（(【\[]?选项[)】\]]?\s*[:：]\s*(.+)$/m);
    if (match) {
      addInline(match[1]);
    }
  }
  return [...new Set(options.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
}

function extractImplicitOptions(text) {
  const groups = [];
  let current = [];
  let reachedStateChanges = false;
  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "【状态变化】") {
      flush();
      reachedStateChanges = true;
      continue;
    }
    if (reachedStateChanges) continue;
    const bullet = line.match(/^(?:[-•·]|\d+[.)、．])\s*(.+)$/);
    if (bullet) current.push(bullet[1].trim());
    else flush();
  }
  flush();
  return groups.at(-1) || [];
}

function messageOptionsHtml(aiText, explicitOptions = []) {
  const options = explicitOptions.length ? explicitOptions : extractOptions(aiText);
  if (!options.length) return "";
  return `<div class="message-options"><span class="options-label">可选行动</span><div class="option-grid">${options.map((option, index) => `<button class="option-button message-option" data-option="${index}" data-option-value="${esc(option)}">${esc(option)}</button>`).join("")}</div></div>`;
}

function bindMessageOptionEvents(root) {
  root?.querySelectorAll(".message-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.optionValue || "";
      if (value === "查看当前状态") {
        renderSidebar("state");
        $("#status-sidebar")?.classList.add("open");
      } else if (value === "保存进度") {
        openSaveModal();
      } else {
        sendMessage(value);
      }
    });
  });
}

async function sendMessage(content) {
  const text = String(content || "").trim();
  if (!text || !session || session.streaming) return;
  const activeSession = session;
  activeSession.hasUnsavedProgress = true;
  appendLocalMessage("user", text);
  const input = $("#composer-input");
  if (input) input.value = "";
  setStreamingUi(true);
  const optionsArea = $("#options-area");
  if (optionsArea) optionsArea.innerHTML = "";
  const messageText = createStreamingMessage();
  let acc = "";
  let streamOptions = [];
  await streamChat(activeSession.conv.id, text, {
    onDelta: (chunk) => {
      acc += chunk;
      messageText.textContent = acc;
      scrollMessages();
    },
    onState: (data) => {
      if (data && data.current_state) activeSession.state = data.current_state;
      else if (data) activeSession.state = { ...activeSession.state, ...data };
      if (session === activeSession) renderSidebar(activeSession.sidebarTab);
    },
    onContext: (data) => {
      if (session !== activeSession) return;
      const headerMeta = $(".conversation-header-title span");
      if (!headerMeta) return;
      if (data?.status === "compressing") headerMeta.textContent = "正在整理上下文";
      else if (data?.status === "compressed" || data?.status === "fallback") {
        headerMeta.textContent = "上下文已自动压缩";
        setTimeout(() => {
          if (session === activeSession && activeSession.streaming) {
            headerMeta.textContent = "AI 正在书写...";
          }
        }, 800);
      }
    },
    onError: (message) => {
      toast(message || "AI 回复失败", "error");
    },
    onDone: (data) => {
      streamOptions = Array.isArray(data?.options) ? data.options.filter(Boolean).slice(0, 4) : [];
    },
    onFinish: async () => {
      if (session !== activeSession) return;
      if (acc.trim()) {
        session.messages.push({
          id: `local-${Date.now()}-${Math.random()}`,
          role: "assistant",
          content: acc,
          metadata: { options: streamOptions },
          created_at: nowISO(),
        });
        messageText.innerHTML = messageTextHtml(acc);
      } else {
        messageText.textContent = "（没有收到回复）";
      }
      messageText.closest(".message")?.classList.remove("streaming");
      try {
        session.state = await getState(session.conv.id);
        session.snapshots = await getSnapshots(session.conv.id);
      } catch {}
      renderSidebar(session.sidebarTab);
      const message = messageText.closest(".message");
      const options = messageOptionsHtml(acc, streamOptions);
      if (options && message) {
        message.insertAdjacentHTML("beforeend", options);
        bindMessageOptionEvents(messageText.closest(".message"));
      }
      setStreamingUi(false);
      scrollMessages();
    },
  });
}

function stateSidebarHtml(state = {}) {
  const attrs = Object.entries(state.attributes || {})
    .map(([name, value]) => {
      const n = clamp(value, 0, 100);
      return `
        <div class="stat-item">
          <div class="stat-item-label"><span>${esc(name)}</span><strong>${esc(value)}</strong></div>
          <div class="stat-bar"><i style="width:${n}%"></i></div>
        </div>`;
    })
    .join("");
  const items = (state.items || []).length
    ? (state.items || []).map((item) => `<div class="state-row"><strong>${esc(item)}</strong><span>物品</span></div>`).join("")
    : `<div class="state-row"><strong>空</strong><span>背包</span></div>`;
  const quests = (state.quests || []).length
    ? (state.quests || []).map((quest) => `<div class="state-row"><strong>${esc(quest.title || "")}</strong><span class="tag">${esc(quest.status || "进行中")}</span></div>`).join("")
    : `<div class="state-row"><strong>暂无任务</strong><span>任务</span></div>`;
  const relations = Object.entries(state.relations || {})
    .map(([name, desc]) => `<div class="state-row"><strong>${esc(name)}</strong><span>${esc(desc)}</span></div>`)
    .join("");
  const characters = Object.entries(state.characters || {})
    .map(([name, character]) => {
      const attributes = Object.entries(character?.attributes || {})
        .map(([attribute, value]) => `
          <div class="stat-item">
            <div class="stat-item-label"><span>${esc(attribute)}</span><strong>${esc(value)}</strong></div>
            <div class="stat-bar"><i style="width:${clamp(value, 0, 100)}%"></i></div>
          </div>`)
        .join("");
      const flags = (character?.flags || []).map((flag) => `<span class="tag">${esc(flag)}</span>`).join("");
      return `<article class="character-state-card"><h4>${esc(name)}</h4><div class="stat-grid">${attributes || `<div class="state-row"><strong>暂无数值</strong><span>—</span></div>`}</div>${flags ? `<div class="tag-list">${flags}</div>` : ""}</article>`;
    })
    .join("");
  const logs = (state.logs || []).slice(0, 8)
    .map((log) => `<div class="state-row"><strong>${esc(log.message || log.type || "")}</strong><span>${formatTime(log.time || log.created_at)}</span></div>`)
    .join("") || `<div class="state-row"><strong>暂无日志</strong><span>记录</span></div>`;
  return `
    <section class="stat-block">
      <h3 class="stat-block-title">属性</h3>
      <div class="stat-grid">${attrs || `<div class="state-row"><strong>暂无属性</strong><span>—</span></div>`}</div>
    </section>
    <section class="stat-block">
      <h3 class="stat-block-title">金钱</h3>
      <div class="state-list"><div class="state-row"><strong>${esc(state.money ?? 0)}</strong><span>金币</span></div></div>
    </section>
    <section class="stat-block">
      <h3 class="stat-block-title">背包</h3>
      <div class="state-list">${items}</div>
    </section>
    <section class="stat-block">
      <h3 class="stat-block-title">任务</h3>
      <div class="state-list">${quests}</div>
    </section>
    ${characters ? `<section class="stat-block"><h3 class="stat-block-title">剧情角色</h3><div class="character-state-list">${characters}</div></section>` : ""}
    ${relations ? `<section class="stat-block"><h3 class="stat-block-title">关系</h3><div class="state-list">${relations}</div></section>` : ""}
    <section class="stat-block">
      <h3 class="stat-block-title">日志</h3>
      <div class="state-list">${logs}</div>
    </section>`;
}

function snapshotSidebarHtml(snapshots = []) {
  const cards = snapshots.map((snapshot) => `
    <div class="snapshot-card">
      <div class="snapshot-card-header">
        <strong>${esc(snapshot.name || "未命名存档")}</strong>
        <button class="icon-btn btn-sm" data-snapshot-restore="${Number(snapshot.id)}" title="读档">${icon("refresh")}</button>
        <button class="icon-btn btn-sm" data-snapshot-delete="${Number(snapshot.id)}" title="删除存档">${icon("trash")}</button>
      </div>
      <div class="snapshot-card-meta">${formatTime(snapshot.created_at)} · ${esc(snapshot.note || "")}</div>
    </div>`).join("");
  return `
    <button class="btn btn-primary" id="save-snapshot-btn" style="width:100%">${icon("save")} 创建存档</button>
    <div class="snapshot-list">${cards || `<div class="state-row"><strong>暂无存档</strong><span>记录</span></div>`}</div>`;
}

function renderSidebar(tab) {
  if (!session) return;
  session.sidebarTab = tab || "state";
  document.querySelectorAll("[data-sidebar-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sidebarTab === session.sidebarTab);
  });
  const body = $("#sidebar-body");
  if (!body) return;
  body.innerHTML = session.sidebarTab === "state"
    ? stateSidebarHtml(session.state)
    : snapshotSidebarHtml(session.snapshots);
  bindSidebarBodyEvents();
}

function bindSidebarBodyEvents() {
  const saveBtn = $("#save-snapshot-btn");
  if (saveBtn) saveBtn.addEventListener("click", openSaveModal);
  document.querySelectorAll("[data-snapshot-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const snapshotId = Number(btn.dataset.snapshotRestore);
      try {
        session.state = await restoreSnapshot(session.conv.id, snapshotId);
        session.snapshots = await getSnapshots(session.conv.id);
        renderSidebar(session.sidebarTab);
        toast("已读档", "success");
      } catch (error) {
        toast(error.message || "读档失败", "error");
      }
    });
  });
  document.querySelectorAll("[data-snapshot-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const snapshotId = Number(btn.dataset.snapshotDelete);
      try {
        await deleteSnapshot(session.conv.id, snapshotId);
        session.snapshots = await getSnapshots(session.conv.id);
        renderSidebar(session.sidebarTab);
        toast("存档已删除", "success");
      } catch (error) {
        toast(error.message || "删除失败", "error");
      }
    });
  });
}

function openSaveModal() {
  const count = (session.snapshots || []).length + 1;
  openModal(`
    <h2>保存进度</h2>
    <p>给这个存档起个名字，之后可以在右侧存档列表恢复。</p>
    <label class="field"><span class="field-label">存档名称</span><input class="input" data-value value="第 ${count} 章"></label>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>取消</button>
      <button class="btn btn-primary" data-confirm>保存</button>
    </div>
  `, {
    onConfirm: async (name) => {
      try {
        await createSnapshot(session.conv.id, String(name || "未命名存档").trim());
        session.snapshots = await getSnapshots(session.conv.id);
        session.hasUnsavedProgress = false;
        renderSidebar(session.sidebarTab);
        toast("存档已创建", "success");
      } catch (error) {
        toast(error.message || "保存失败", "error");
      }
    },
  });
}

async function renderOnboarding(conversationId) {
  const conversation = MODE === "offline" ? mockConversations[conversationId] : await api(`/api/conversations/${conversationId}`);
  if (!conversation) throw new Error("会话不存在");
  if (conversation.onboarding_status !== "pending") return navigate(`#/adventure/${conversationId}`);
  const config = conversation.onboarding_config || {};
  const fields = config.fields?.length ? config.fields : ["姓名", "年龄", "身份", "偏好", "边界"].map((label, index) => ({ key: `custom_${index}`, label, type: "text" }));
  appEl.innerHTML = `<div class="page"><div class="page-head"><div><h1 class="page-title">开局设定</h1><p class="page-subtitle">${esc(config.intro || "请完成本次冒险所需信息")}</p></div></div><form id="onboarding-form" class="panel"><div class="panel-body section">${fields.map((field) => {
    const required = field.required ? " required" : "";
    const label = `<label class="field"><span class="field-label">${esc(field.label)}${field.required ? " *" : ""}</span>`;
    if (field.type === "select") return `${label}<select class="input" name="${esc(field.key)}"${required}>${field.options.map((option) => `<option value="${esc(option)}"${option === field.default ? " selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    const input = field.type === "textarea" ? `<textarea class="textarea" name="${esc(field.key)}" placeholder="${esc(field.placeholder || "")}"${required}>${esc(field.default || "")}</textarea>` : `<input class="input" name="${esc(field.key)}" value="${esc(field.default || "")}" placeholder="${esc(field.placeholder || "")}"${required}>`;
    return `${label}${input}</label>`;
  }).join("")}${config.allow_freeform ? `<label class="field"><span class="field-label">补充说明</span><textarea class="textarea" name="freeform"></textarea></label>` : ""}<div class="detail-actions"><button class="btn btn-primary" type="submit">确认并开始冒险</button><button class="btn btn-ghost" type="button" id="onboarding-back">返回剧本</button></div></div></form></div>`;
  $("#onboarding-back")?.addEventListener("click", () => navigate(conversation.work_id ? `#/work/${conversation.work_id}` : "#/"));
  $("#onboarding-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const answers = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await api(`/api/conversations/${conversationId}/onboarding`, { method: "POST", body: { answers } }); navigate(`#/adventure/${conversationId}`); }
    catch (error) { toast(error.message || "开局设定保存失败", "error"); }
  });
}

async function renderAdventure(conversationId) {
  let conv;
  if (MODE === "offline") {
    conv = mockConversations[conversationId];
    if (!conv) throw new Error("冒险会话不存在");
  } else {
    conv = await api(`/api/conversations/${conversationId}`);
  }
  const work = MODE === "offline"
    ? mockWorks.find((item) => item.id === conv.work_id)
    : (conv.work_id ? await getWork(conv.work_id) : null);
  const cards = resolveSessionCards(conv, work);
  const card = cards[0] || null;
  const worldbook = MODE === "offline"
    ? work?.worldbook
    : await getWorldbook(work?.worldbook_id ?? conv.worldbook_id);
  const messages = await getMessages(conversationId);
  const state = await getState(conversationId);
  const snapshots = await getSnapshots(conversationId);
  session = { conv, work, cards, card: cards[0] || null, messages, state, snapshots, streaming: false, hasUnsavedProgress: false, sidebarTab: "state" };
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">${esc(conv.title || "冒险")}</h1>
          <p class="page-subtitle">${esc(work ? work.title : "")} · ${esc(cardSummaryText(cards))}</p>
        </div>
        <div class="detail-actions adventure-actions">
          <button class="btn btn-ghost btn-sm" id="back-btn">${icon("arrow-left")} 返回</button>
          <button class="btn btn-ghost btn-sm adventure-utility-btn" id="sidebar-toggle"><span class="button-emoji" aria-hidden="true">🧭</span><span>状态</span></button>
          <button class="btn btn-ghost btn-sm adventure-utility-btn" id="onboarding-review-btn"><span class="button-emoji" aria-hidden="true">✨</span><span>编辑开局设定</span></button>
          <button class="btn btn-ghost btn-sm" id="delete-btn">${icon("trash")} 删除</button>
        </div>
      </div>
      <div class="adventure-shell">
        <div class="conversation-pane">
          <div class="conversation-header">
            <div class="conversation-header-title">
              <strong>${esc(conv.title)}</strong>
              <span></span>
            </div>
            <div class="session-card-summary">${esc(cardSummaryText(cards))}</div>
            <button class="btn btn-sm btn-danger" id="stop-btn" style="display:none">${icon("stop")} 停止</button>
          </div>
          <div id="message-list" class="message-list"></div>
          <div id="options-area" class="options-area"></div>
          <div class="composer">
            <div class="quick-commands">
              <button class="quick-command" data-command="/状态">/状态</button>
              <button class="quick-command" data-command="/背包">/背包</button>
              <button class="quick-command" data-command="/存档">/存档</button>
              <button class="quick-command" data-command="/帮助">/帮助</button>
              <button class="quick-command" data-correction="persona">修正人设</button>
              <button class="quick-command" data-correction="memory">修正记忆</button>
            </div>
            <div class="composer-row">
              <textarea id="composer-input" class="textarea compact" placeholder="输入你的行动..."></textarea>
              <button class="btn btn-primary" id="send-btn">${icon("send")} 发送</button>
            </div>
          </div>
        </div>
        <aside class="status-sidebar" id="status-sidebar">
          <div class="sidebar-tabs">
            <button data-sidebar-tab="state" class="active">状态</button>
            <button data-sidebar-tab="snapshots">存档</button>
          </div>
          <div id="sidebar-body" class="sidebar-body"></div>
        </aside>
      </div>
    </div>`;
  bindAdventureEvents();
  $("#onboarding-review-btn")?.addEventListener("click", () => openAdventureOnboarding(session.conv, work, cards, worldbook, false));
  if (conv.onboarding_status === "pending") openAdventureOnboarding(conv, work, cards, worldbook, false);
  renderMessages();
  renderSidebar(session.sidebarTab);
  setStreamingUi(false);
  scrollMessages();
}

function openAdventureOnboarding(conversation, work, cards, worldbook, readOnly) {
  const config = conversation.onboarding_config || work?.onboarding || {};
  const fields = config.fields || [];
  const cardDetails = normalizeRoleCards(cards).length
    ? normalizeRoleCards(cards).map((card) => `<h3>角色设定：${esc(card.name || "未命名角色")}</h3><p>${esc(card.persona || card.personality || "")}</p>`).join("")
    : "<h3>角色设定</h3><p>暂无角色</p>";
  const details = `<h2>${readOnly ? "本次会话设定" : "创建本次会话"}</h2><p>${esc(config.intro || "以下信息仅作用于当前聊天；可选填写，未填内容将沿用剧本默认设定。")}</p><h3>开场剧情</h3><p>${esc(work?.opening || "")}</p>${cardDetails}<h3>世界与记忆</h3><p>${esc(worldbook?.description || "")}</p>`;
  const visibleFields = readOnly ? [...fields, ...Object.keys(conversation.onboarding_answers || {}).filter((key) => !fields.some((field) => field.key === key)).map((key) => ({ key, label: key, type: "text" }))] : fields;
  const form = visibleFields.map((field) => {
    const value = conversation.onboarding_answers?.[field.key] || field.default || "";
    if (readOnly) return `<p><strong>${esc(field.label)}：</strong>${esc(value || "未填写")}</p>`;
    if (field.type === "select") return `<label class="field"><span class="field-label">${esc(field.label)}</span><select class="input" name="${esc(field.key)}">${(field.options || []).map((item) => `<option${item === value ? " selected" : ""}>${esc(item)}</option>`).join("")}</select></label>`;
    return `<label class="field"><span class="field-label">${esc(field.label)}</span><input class="input" name="${esc(field.key)}" value="${esc(value)}" placeholder="可留空" ${field.required ? "required" : ""}></label>`;
  }).join("");
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${details}<form id="adventure-onboarding-form">${form}${readOnly ? "" : '<div id="custom-settings"></div><button type="button" class="btn btn-ghost btn-sm" id="add-custom-setting">＋ 添加自定义设定</button>'}<div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>关闭</button>${readOnly ? "" : '<button class="btn btn-primary" type="submit">确认开始</button>'}</div></form></div></div>`;
  $("#add-custom-setting")?.addEventListener("click", () => { const row = document.createElement("div"); row.className = "form-grid"; row.innerHTML = '<input class="input custom-setting-key" placeholder="设定名称"><input class="input custom-setting-value" placeholder="设定内容">'; $("#custom-settings")?.appendChild(row); });
  $("#adventure-onboarding-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const answers = Object.fromEntries(new FormData(event.currentTarget).entries()); document.querySelectorAll("#custom-settings .form-grid").forEach((row) => { const key = row.querySelector(".custom-setting-key")?.value.trim(); const value = row.querySelector(".custom-setting-value")?.value.trim(); if (key && value) answers[key] = value; }); try { await api(`/api/conversations/${conversation.id}/onboarding`, { method: "POST", body: { answers } }); modalRoot.innerHTML = ""; location.reload(); } catch (error) { toast(error.message || "保存失败", "error"); } });
}

function toggleStatusSidebar() {
  const sidebar = $("#status-sidebar");
  const button = $("#sidebar-toggle");
  if (!sidebar) return;
  if (window.matchMedia("(max-width: 960px)").matches) {
    const open = sidebar.classList.toggle("open");
    button?.setAttribute("aria-expanded", String(open));
    return;
  }
  const hidden = sidebar.classList.toggle("desktop-hidden");
  const shell = $(".adventure-shell");
  shell?.classList.toggle("sidebar-collapsed", hidden);
  button?.setAttribute("aria-expanded", String(!hidden));
}

function bindAdventureEvents() {
  $("#back-btn")?.addEventListener("click", () => navigate(session.conv.work_id ? `#/work/${session.conv.work_id}` : "#/"));
  $("#sidebar-toggle")?.addEventListener("click", toggleStatusSidebar);
  appEl.addEventListener("click", (event) => {
    const sidebar = $("#status-sidebar");
    const toggle = $("#sidebar-toggle");
    if (sidebar?.classList.contains("open") && !sidebar.contains(event.target) && !toggle?.contains(event.target)) {
      sidebar.classList.remove("open");
    }
  });
  $("#delete-btn")?.addEventListener("click", async () => {
    if (!confirm("删除这个冒险会话？对话和存档都会消失。")) return;
    try {
      await deleteConversation(session.conv.id);
      toast("会话已删除", "success");
      navigate("#/");
    } catch (error) {
      toast(error.message || "删除失败", "error");
    }
  });
  $("#stop-btn")?.addEventListener("click", async () => {
    try {
      if (MODE !== "offline") {
        await api(`/api/conversations/${session.conv.id}/stop`, { method: "POST" });
      }
    } catch {}
  });
  document.querySelectorAll(".quick-command").forEach((btn) => {
    btn.addEventListener("click", () => btn.dataset.correction ? openCorrectionModal(btn.dataset.correction) : sendMessage(btn.dataset.command));
  });
  const sendBtn = $("#send-btn");
  const input = $("#composer-input");
  if (sendBtn) sendBtn.addEventListener("click", () => sendMessage(input?.value));
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage(input.value);
      }
    });
  }
  document.querySelectorAll("[data-sidebar-tab]").forEach((btn) => {
    btn.addEventListener("click", () => renderSidebar(btn.dataset.sidebarTab));
  });
}

async function openCorrectionModal(kind) {
  const title = kind === "persona" ? "修正人设" : "修正记忆";
  const cards = Array.isArray(session.cards) ? session.cards : normalizeRoleCards(null, session.card);
  const worldbook = MODE === "offline" ? session.work?.worldbook : await getWorldbook(session.work?.worldbook_id);
  const defaultContent = kind === "persona"
    ? cards.flatMap((card) => [card?.name, card?.persona, card?.personality, card?.speaking_style, ...(card?.directives || [])]).filter(Boolean).join("\n")
    : [worldbook?.description, ...(worldbook?.entries || []).filter((entry) => /记忆|过去|回忆/.test(`${entry.title} ${entry.content}`)).map((entry) => entry.content)].filter(Boolean).join("\n");
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>${title}</h2><p>已自动带入剧本默认设定；可直接保存或编辑。仅影响当前对话之后的 AI 回复。</p><textarea id="correction-content" class="textarea" required>${esc(defaultContent)}</textarea><div class="modal-actions"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="save-correction">保存</button></div></div></div>`;
  modalRoot.querySelector("[data-close]")?.addEventListener("click", () => modalRoot.innerHTML = "");
  $("#save-correction")?.addEventListener("click", async () => {
    const content = $("#correction-content")?.value.trim();
    if (!content) return toast("请填写修正内容", "error");
    try { const conv = await api(`/api/conversations/${session.conv.id}/corrections`, { method: "POST", body: { kind, content } }); session.conv = conv; modalRoot.innerHTML = ""; toast("修正已保存，将在下一次回复生效", "success"); }
    catch (error) { toast(error.message || "保存失败", "error"); }
  });
}

function addDynamicRow(containerSelector, options = {}) {
  const container = $(containerSelector);
  if (!container) return;
  const row = document.createElement("div");
  row.className = "dynamic-row";
  if (options.mode === "pair") {
    row.innerHTML = `
      <input class="input" placeholder="${esc(options.placeholders?.[0] || "名称")}">
      <input class="input" placeholder="${esc(options.placeholders?.[1] || "说明")}">
      <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>`;
  } else {
    row.innerHTML = `
      <input class="input" placeholder="${esc(options.placeholder || "内容")}">
      <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>`;
  }
  row.querySelector("button").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function addCharacterAttributeRow(name = "", value = "") {
  addAttributeRow("#character-attribute-rows", name, value);
}

function addAttributeRow(selector, name = "", value = "") {
  addDynamicRow(selector, { mode: "pair", placeholders: ["属性名", "数值或文本"] });
  const inputs = document.querySelectorAll(`${selector} .dynamic-row input`);
  inputs[inputs.length - 2].value = name;
  inputs[inputs.length - 1].value = value;
}

function populateAttributeRows(selector, attributes = {}) {
  const container = $(selector);
  if (!container) return;
  container.innerHTML = "";
  Object.entries(attributes && typeof attributes === "object" ? attributes : {})
    .forEach(([name, value]) => addAttributeRow(selector, name, value));
}

function defaultCharacterAttributes(card = {}) {
  const configured = card.character_attributes || {};
  if (Object.keys(configured).length) return configured;
  const relation = card.initial_state?.relations?.[card.name];
  return { 心情: 50, 好感度: Number(relation) || 0 };
}

function addEntryCard(entry = {}) {
  const container = $("#entry-rows");
  if (!container) return;
  const card = document.createElement("div");
  card.className = "entry-card";
  if (entry.id !== undefined && entry.id !== null) card.dataset.entryId = String(entry.id);
  card.innerHTML = `
    <div class="entry-card-header">
      <input class="input entry-title" placeholder="条目标题">
      <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>
    </div>
    <input class="input entry-keywords" placeholder="关键词（逗号分隔，例如：王都, 城门）">
    <textarea class="textarea compact entry-content" placeholder="条目内容，命中关键词时注入上下文"></textarea>
    <label class="field"><span class="field-label">优先级</span><input class="input entry-priority" type="number" step="1" value="10"></label>
    <label class="entry-toggle"><input type="checkbox" class="entry-enabled" checked> 启用</label>`;
  card.querySelector(".entry-title").value = entry.title ?? "";
  card.querySelector(".entry-keywords").value = Array.isArray(entry.keywords) ? entry.keywords.join(", ") : (entry.keywords ?? "");
  card.querySelector(".entry-content").value = entry.content ?? "";
  card.querySelector(".entry-priority").value = Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 10;
  card.querySelector(".entry-enabled").checked = entry.enabled !== false;
  card.querySelector("button").addEventListener("click", () => card.remove());
  container.appendChild(card);
}

function collectSingleRows(selector) {
  return Array.from(document.querySelectorAll(`${selector} .dynamic-row input`))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function collectPairRows(selector) {
  const result = {};
  document.querySelectorAll(`${selector} .dynamic-row`).forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const key = inputs[0]?.value.trim();
    const value = inputs[1]?.value.trim();
    if (key) result[key] = value || "";
  });
  return result;
}

function collectAttributeRows(selector) {
  const result = {};
  document.querySelectorAll(`${selector} .dynamic-row`).forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const key = inputs[0]?.value.trim();
    const rawValue = inputs[1]?.value.trim() || "";
    if (!key && !rawValue) return;
    if (!key) throw new Error("属性名称不能为空");
    if (Object.hasOwn(result, key)) throw new Error(`属性名称重复：${key}`);
    const numericValue = Number(rawValue);
    result[key] = rawValue !== "" && Number.isFinite(numericValue) ? numericValue : rawValue;
  });
  return result;
}

function collectEntryCards() {
  return Array.from(document.querySelectorAll("#entry-rows .entry-card"))
    .map((card) => {
      const entryId = card.dataset.entryId;
      return {
        ...(entryId ? { id: Number(entryId) } : {}),
        title: card.querySelector(".entry-title")?.value.trim() || "条目",
        keywords: (card.querySelector(".entry-keywords")?.value || "")
          .split(/[,，、]/)
          .map((item) => item.trim())
          .filter(Boolean),
        content: card.querySelector(".entry-content")?.value.trim() || "",
        priority: Number(card.querySelector(".entry-priority")?.value) || 0,
        enabled: card.querySelector(".entry-enabled")?.checked ?? true,
      };
    })
    .filter((entry) => entry.content || entry.keywords.length);
}

function addOnboardingField(field = {}) {
  const row = document.createElement("div");
  row.className = "form-grid onboarding-field-row";
  row.innerHTML = `<input class="input onboarding-label" placeholder="字段名称" value="${esc(field.label || "")}"><input class="input onboarding-placeholder" placeholder="填写提示" value="${esc(field.placeholder || "")}"><select class="input onboarding-type"><option value="text">短文本</option><option value="textarea">长文本</option><option value="select">单选</option></select><label class="field"><span class="field-label">必填</span><input type="checkbox" class="onboarding-required"></label><input class="input onboarding-options" placeholder="选项（用逗号分隔）" value="${esc((field.options || []).join(", "))}"><button type="button" class="icon-btn">${icon("trash")}</button>`;
  row.querySelector(".onboarding-type").value = field.type || "text";
  row.querySelector(".onboarding-required").checked = Boolean(field.required);
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("#onboarding-field-rows")?.appendChild(row);
}

function collectOnboardingFields() {
  return Array.from(document.querySelectorAll(".onboarding-field-row")).map((row, index) => ({ key: `field_${index + 1}`, label: row.querySelector(".onboarding-label").value.trim(), placeholder: row.querySelector(".onboarding-placeholder").value.trim(), type: row.querySelector(".onboarding-type").value, required: row.querySelector(".onboarding-required").checked, options: row.querySelector(".onboarding-options").value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })).filter((field) => field.label);
}

function workCardIds(work = {}) {
  const rawIds = Array.isArray(work.card_ids)
    ? work.card_ids
    : (work.card_id === null || work.card_id === undefined || work.card_id === "" ? [] : [work.card_id]);
  return [...new Set(rawIds.map(Number).filter(Number.isFinite))];
}

function collectWorkCardIds() {
  return [...new Set(
    Array.from(document.querySelectorAll("#work-card-rows [data-card-id]"))
      .map((row) => Number(row.dataset.cardId))
      .filter(Number.isFinite)
  )];
}

function populateWorkCardRows(cards = [], selectedIds = []) {
  const rows = $("#work-card-rows");
  const addSelect = $("#work-card-add");
  const addButton = $("#add-work-card");
  workCardOptions = Array.isArray(cards) ? cards : [];
  selectedIds = [...new Set((selectedIds || []).map(Number).filter(Number.isFinite))];
  const selectedCards = selectedIds
    .map((id) => workCardOptions.find((card) => Number(card.id) === id))
    .filter(Boolean);
  const availableCards = workCardOptions.filter((card) => !selectedIds.includes(Number(card.id)));
  if (rows) {
    rows.innerHTML = selectedCards.length
      ? selectedCards.map((card, index) => `
        <div class="work-card-row" data-card-id="${Number(card.id)}">
          <div class="work-card-row-summary"><strong>${esc(card.name || "未命名角色")}</strong><span>${esc(cardPersonalitySummary(card))} · 来源：${esc(card.source || "未标注来源")}</span></div>
          <div class="work-card-row-actions">
            <button class="btn btn-sm btn-ghost" type="button" data-work-card-action="up"${index === 0 ? " disabled" : ""}>上移</button>
            <button class="btn btn-sm btn-ghost" type="button" data-work-card-action="down"${index === selectedCards.length - 1 ? " disabled" : ""}>下移</button>
            <button class="btn btn-sm btn-danger" type="button" data-work-card-action="remove">${icon("trash")} 移除</button>
          </div>
        </div>`).join("")
      : '<p class="detail-meta work-card-empty">当前剧本暂未引用角色卡；不使用角色卡也可以保存。</p>';
  }
  if (addSelect) {
    addSelect.innerHTML = availableCards.length
      ? `<option value="">选择要添加的角色卡</option>${availableCards.map((card) => `<option value="${Number(card.id)}">${esc(card.name || "未命名角色")}</option>`).join("")}`
      : '<option value="">没有可添加的角色卡</option>';
    addSelect.disabled = !availableCards.length;
  }
  if (addButton) addButton.disabled = !availableCards.length;
}

function populateWorkCardSelect(cards = [], selectedId = null) {
  const select = $("#work-card-id");
  if (!select) return;
  workCardOptions = cards;
  select.innerHTML = `<option value="">不使用角色卡</option>${cards.map((card) => `<option value="${Number(card.id)}">${esc(card.name)}</option>`).join("")}`;
  select.value = selectedId ? String(selectedId) : "";
  updateWorkCardSummary();
}

function updateWorkCardSummary() {
  const selected = $("#work-card-id")?.selectedOptions?.[0];
  const summary = $("#work-card-summary");
  const selectedCard = workCardOptions.find((card) => Number(card.id) === Number(selected?.value));
  if (summary) summary.textContent = selectedCard
    ? `本剧本将引用：${selectedCard.name} · ${cardPersonalitySummary(selectedCard)}`
    : "本剧本不使用角色卡。";
}

function addReplyTemplateCard(template = {}) {
  const card = document.createElement("div");
  const templateId = template.id || `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  card.className = "reply-template-card";
  card.dataset.templateId = templateId;
  card.innerHTML = `
    <div class="reply-template-header">
      <input class="input reply-template-name" placeholder="模板名称" value="${esc(template.name || "")}">
      <label class="entry-toggle"><input type="radio" name="active-reply-template" class="reply-template-active"> 当前模板</label>
      <button type="button" class="btn btn-sm btn-ghost reply-template-delete">删除</button>
    </div>
    <textarea class="textarea compact reply-template-content" placeholder="AI 回复模板内容">${esc(template.content || "")}</textarea>`;
  card.querySelector(".reply-template-active").checked = Boolean(template.active);
  card.querySelector(".reply-template-delete").addEventListener("click", () => card.remove());
  $("#reply-template-rows")?.appendChild(card);
}

function collectReplyTemplates() {
  return Array.from(document.querySelectorAll("#reply-template-rows .reply-template-card"))
    .map((card) => ({
      id: card.dataset.templateId,
      name: card.querySelector(".reply-template-name")?.value.trim() || "",
      content: card.querySelector(".reply-template-content")?.value.trim() || "",
    }))
    .filter((template) => template.name || template.content);
}

function selectedReplyTemplateId() {
  const selected = document.querySelector('input[name="active-reply-template"]:checked');
  if (selected?.id === "disable-reply-template") return "";
  return selected?.closest(".reply-template-card")?.dataset.templateId || "";
}

function fillCreatorForm(data = {}) {
  const work = data.work || data;
  const worldbook = data.worldbook || {};
  const set = (id, value) => {
    const el = $(id);
    if (el) el.value = value ?? "";
  };
  set("#work-title", work.title);
  set("#work-description", work.description);
  set("#work-opening", work.opening);
  set("#work-tags", Array.isArray(work.tags) ? work.tags.join(", ") : work.tags);
  set("#work-cover-url", work.cover_url);
  populateAttributeRows("#player-attribute-rows", work.player_attributes);
  const templateContainer = $("#reply-template-rows");
  if (templateContainer) templateContainer.innerHTML = "";
  const activeTemplateId = typeof work.active_reply_template_id === "string"
    ? work.active_reply_template_id
    : "";
  (work.reply_templates || []).forEach((template) => addReplyTemplateCard({
    ...template,
    active: template.id === activeTemplateId,
  }));
  const disableTemplate = $("#disable-reply-template");
  if (disableTemplate) disableTemplate.checked = !activeTemplateId;
  $("#onboarding-field-rows") && ($("#onboarding-field-rows").innerHTML = "");
  (work.onboarding?.fields || []).forEach(addOnboardingField);
  set("#wb-title", worldbook.title);
  set("#wb-description", worldbook.description);
  const entryContainer = $("#entry-rows");
  if (entryContainer) entryContainer.innerHTML = "";
  const entries = Array.isArray(data.entries) ? data.entries : (Array.isArray(worldbook.entries) ? worldbook.entries : []);
  entries.forEach((entry) => addEntryCard(entry));
}

async function loadCreatorEditData(workId) {
  const work = await getWork(workId);
  const [worldbook, entries] = MODE === "offline"
    ? [work.worldbook || null, work.worldbook?.entries || []]
    : await Promise.all([
      getWorldbook(work.worldbook_id),
      getWorldbookEntries(work.worldbook_id),
    ]);
  if (!worldbook) throw new Error("该作品关联的世界书不存在或已被删除。");
  return { work, worldbook, entries };
}

function areWorkCardIdsAvailable(work, cards) {
  const availableIds = new Set((cards || []).map((card) => Number(card.id)).filter(Number.isFinite));
  return workCardIds(work).every((cardId) => availableIds.has(cardId));
}

function setCreatorEditSaveEnabled(enabled) {
  const saveButton = $("#creator-save-btn");
  if (saveButton) saveButton.disabled = !enabled;
}

async function confirmCreatorEditSave(editState) {
  const works = await listWorks();
  const otherWorks = works.filter((item) => Number(item.id) !== Number(editState.workId));
  const sharedWorldbookWorks = otherWorks.filter((item) => Number(item.worldbook_id) === Number(editState.worldbookId));
  const impact = sharedWorldbookWorks.length
    ? `另有 ${sharedWorldbookWorks.length} 个作品会同步使用这本世界书。`
    : "没有其他作品共用这本世界书。";
  return window.confirm(`即将更新世界书和作品。${impact}\n\n是否继续保存？`);
}

async function saveCreatorEdit({ worldbook, work }) {
  const editState = creatorEditState;
  if (!editState) throw new Error("编辑数据尚未加载完成。");
  if (!await confirmCreatorEditSave(editState)) return false;

  if (MODE === "offline") {
    const savedWork = mockWorks.find((item) => Number(item.id) === Number(editState.workId));
    if (!savedWork) throw new Error("作品不存在");
    savedWork.worldbook = { ...worldbook, id: editState.worldbookId, entries: worldbook.entries };
    Object.assign(savedWork, work, { updated_at: nowISO() });
    saveMockData();
    return true;
  }

  await api(`/api/worldbooks/${editState.worldbookId}`, {
    method: "PUT",
    body: { title: worldbook.title, description: worldbook.description },
  });
  const currentEntryIds = new Set(worldbook.entries.filter((entry) => entry.id).map((entry) => entry.id));
  for (const entry of worldbook.entries) {
    const body = { title: entry.title, keywords: entry.keywords, content: entry.content, priority: entry.priority, enabled: entry.enabled };
    if (entry.id) {
      await api(`/api/worldbooks/${editState.worldbookId}/entries/${entry.id}`, { method: "PUT", body });
    } else {
      await api(`/api/worldbooks/${editState.worldbookId}/entries`, { method: "POST", body });
    }
  }
  for (const entryId of editState.entryIds) {
    if (!currentEntryIds.has(entryId)) {
      await api(`/api/worldbooks/${editState.worldbookId}/entries/${entryId}`, { method: "DELETE" });
    }
  }
  await api(`/api/works/${editState.workId}`, { method: "PUT", body: work });
  return true;
}

async function submitCreatorForm() {
  if (creatorEditWorkId && !creatorEditState) {
    toast("编辑数据尚未完整载入，暂不能保存。", "error");
    return;
  }
  const value = (id) => ($(id)?.value || "").trim();
  const onboarding = { enabled: true, fields: collectOnboardingFields() };
  let work;
  try {
    work = {
      title: value("#work-title") || "未命名剧本",
      description: value("#work-description") || "一个高自由度文字冒险。",
      opening: value("#work-opening") || "故事从这里开始。",
      tags: value("#work-tags") ? value("#work-tags").split(/[,，、]/).map((item) => item.trim()).filter(Boolean) : ["20+"],
      onboarding,
      cover_url: value("#work-cover-url"),
      card_ids: collectWorkCardIds(),
      player_attributes: collectAttributeRows("#player-attribute-rows"),
      reply_templates: collectReplyTemplates(),
      active_reply_template_id: selectedReplyTemplateId(),
    };
  } catch (error) {
    toast(error.message || "玩家初始属性无效", "error");
    return;
  }
  const worldbook = {
    title: value("#wb-title") || `${work.title} 的世界`,
    description: value("#wb-description"),
    entries: collectEntryCards(),
  };
  if (!work.title || !work.opening) {
    toast("作品名和开场剧情不能为空", "error");
    return;
  }
  const submitBtn = $("#creator-form")?.querySelector('[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `${icon("refresh")} 保存中...`;
  }
  try {
    if (creatorEditWorkId) {
      const saved = await saveCreatorEdit({ worldbook, work });
      if (!saved) return;
      toast("作品已更新", "success");
      navigate(`#/work/${creatorEditWorkId}`);
      return;
    }
    if (MODE === "offline") {
      const id = ++mockSeq;
      mockWorks.unshift({
        id,
        ...work,
        worldbook_id: id,
        worldbook: { ...worldbook, id },
        plays: 0,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      saveMockData();
      toast("作品已保存", "success");
      navigate(`#/work/${id}`);
      return;
    }
    const savedWorldbook = await api("/api/worldbooks", {
      method: "POST",
      body: { title: worldbook.title, description: worldbook.description },
    });
    for (const entry of worldbook.entries) {
      await api(`/api/worldbooks/${savedWorldbook.id}/entries`, { method: "POST", body: entry });
    }
    const savedWork = await api("/api/works", {
      method: "POST",
      body: { ...work, worldbook_id: savedWorldbook.id },
    });
    toast("作品已保存", "success");
    navigate(`#/work/${savedWork.id}`);
  } catch (error) {
    toast(error.message || "保存失败", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `${icon("check")} ${creatorEditWorkId ? "保存更新" : "保存作品"}`;
    }
  }
}

function bindCreatorEvents() {
  $("#add-player-attribute")?.addEventListener("click", () => addAttributeRow("#player-attribute-rows"));
  $("#add-work-card")?.addEventListener("click", () => {
    const cardId = Number($("#work-card-add")?.value);
    if (!Number.isFinite(cardId)) return;
    populateWorkCardRows(workCardOptions, [...collectWorkCardIds(), cardId]);
  });
  $("#work-card-rows")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-work-card-action]");
    if (!button) return;
    const action = button.dataset.workCardAction;
    const row = button.closest("[data-card-id]");
    const cardIds = collectWorkCardIds();
    const index = cardIds.indexOf(Number(row?.dataset.cardId));
    if (index < 0) return;
    if (action === "remove") cardIds.splice(index, 1);
    if (action === "up" && index > 0) [cardIds[index - 1], cardIds[index]] = [cardIds[index], cardIds[index - 1]];
    if (action === "down" && index < cardIds.length - 1) [cardIds[index + 1], cardIds[index]] = [cardIds[index], cardIds[index + 1]];
    populateWorkCardRows(workCardOptions, cardIds);
  });
  $("#add-entry")?.addEventListener("click", addEntryCard);
  $("#add-reply-template")?.addEventListener("click", () => addReplyTemplateCard());
  $("#add-onboarding-field")?.addEventListener("click", () => addOnboardingField());
  $("#back-btn")?.addEventListener("click", () => navigate("#/"));
  $("#preview-btn")?.addEventListener("click", () => {
    const opening = $("#work-opening")?.value.trim();
    toast(opening ? "开场已准备好，保存后即可开始冒险" : "先填写开场剧情", opening ? "success" : "error");
  });
  $("#work-cover-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast("请选择不超过 5MB 的图片文件", "error");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const input = $("#work-cover-url");
      if (input) input.value = String(reader.result || "");
      toast("封面已载入，保存作品后生效", "success");
    };
    reader.onerror = () => toast("封面读取失败", "error");
    reader.readAsDataURL(file);
  });
  $("#creator-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCreatorForm();
  });
}

function referencedWorksForCard(cardId, works) {
  return (works || []).filter((work) => workCardIds(work).includes(Number(cardId)));
}

function referencedWorkNames(references = []) {
  return references.map((work) => String(work?.title || `剧本 #${work?.id ?? "未知"}`));
}

function referencedWorkNamesHtml(references = []) {
  return referencedWorkNames(references).map(esc).join("、");
}

function cardPersonalitySummary(card, fallback = "尚未填写性格或人设简介。") {
  return card?.personality || card?.persona || fallback;
}

function showCardReferenceModal(references, message = "角色卡正在被剧本引用") {
  const workList = references.length
    ? `<ul class="reference-list">${references.map((work) => `<li>${esc(work.title || `剧本 #${work.id}`)}</li>`).join("")}</ul>`
    : "";
  openModal(`
    <h2>无法删除角色卡</h2>
    <p>${esc(message)}</p>
    ${workList}
    <div class="modal-actions"><button class="btn btn-primary" type="button" data-close>知道了</button></div>
  `);
}

async function renderCards() {
  if (!$("#card-library-search")) {
    appEl.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1 class="page-title">角色卡库</h1><p class="page-subtitle">独立维护可复用的角色卡，并查看它被哪些剧本引用。</p></div>
          <button class="btn btn-primary" type="button" data-card-action="create">${icon("plus")} 创建角色卡</button>
        </div>
        <section class="panel resource-toolbar"><div class="panel-body"><label class="field"><span class="field-label">搜索角色卡</span><input id="card-library-search" class="input" value="${esc(cardLibraryQuery)}" placeholder="按名称、人设或性格搜索"></label></div></section>
        <div id="card-library-results"></div>
      </div>`;
    bindCardsEvents();
  }
  await renderCardResults();
}

async function renderCardResults() {
  const results = $("#card-library-results");
  if (!results) return;
  const renderToken = ++cardLibraryRenderToken;
  results.innerHTML = loadingHtml();
  const [cards, works] = await Promise.all([listAllCards(cardLibraryQuery), listAllWorks()]);
  if (renderToken !== cardLibraryRenderToken) return;
  const cardsHtml = cards.length
    ? cards.map((card) => {
      const references = referencedWorksForCard(card.id, works);
      const referenceNames = referencedWorkNames(references).join("、");
      return `
        <article class="resource-card">
          <div class="resource-card-body">
            <div class="resource-card-heading">
              <h2>${esc(card.name || "未命名角色")}</h2>
              <span class="tag">${references.length} 个剧本引用</span>
            </div>
            <p class="resource-card-description">${esc(cardPersonalitySummary(card))}</p>
            <p class="resource-card-meta">来源：${esc(card.source || "未标注来源")} · ${references.length ? `引用：${esc(referenceNames)}` : "尚未被剧本引用"}</p>
          </div>
          <div class="resource-card-actions">
            <button class="btn btn-ghost" type="button" data-card-action="edit" data-card-id="${Number(card.id)}">${icon("edit")} 编辑</button>
            <button class="btn btn-danger" type="button" data-card-action="delete" data-card-id="${Number(card.id)}">${icon("trash")} 删除</button>
          </div>
        </article>`;
    }).join("")
    : emptyHtml("没有找到角色卡", cardLibraryQuery ? "试试修改搜索词，或创建一张新角色卡。" : "创建一张角色卡，供多个剧本复用。", `<button class="btn btn-primary" type="button" data-card-action="create">${icon("plus")} 创建角色卡</button>`);
  results.innerHTML = `<div class="resource-grid">${cardsHtml}</div>`;
  bindCardActionEvents(results);
}

function bindCardsEvents() {
  $("#card-library-search")?.addEventListener("input", (event) => {
    cardLibraryQuery = event.target.value;
    renderCardResults().catch((error) => toast(error.message || "角色卡列表加载失败", "error"));
  });
  bindCardActionEvents();
}

function bindCardActionEvents(root = document) {
  root.querySelectorAll("[data-card-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.cardAction;
      const cardId = Number(button.dataset.cardId);
      if (action === "create") return navigate("#/card/new");
      if (action === "edit") return navigate(`#/card/${cardId}`);
      if (action !== "delete") return;
      try {
        const works = await listAllWorks();
        const references = referencedWorksForCard(cardId, works);
        if (references.length) return showCardReferenceModal(references);
        if (!window.confirm("确定删除这张角色卡吗？此操作无法撤销。")) return;
        button.disabled = true;
        await deleteCard(cardId);
        toast("角色卡已删除", "success");
        await renderCardResults();
      } catch (error) {
        const serverReferences = error.detail?.works || error.detail?.detail?.works || [];
        if (error.status === 409 || serverReferences.length) {
          showCardReferenceModal(serverReferences, error.message || "角色卡正在被剧本引用");
        } else {
          toast(error.message || "删除角色卡失败", "error");
        }
      } finally {
        button.disabled = false;
      }
    });
  });
}

function fillCardForm(card, { preserveHiddenInitialState = false } = {}) {
  const initialState = preserveHiddenInitialState
    ? JSON.parse(JSON.stringify(cardEditorState.initialState || {}))
    : JSON.parse(JSON.stringify(card.initial_state || {}));
  cardEditorState = {
    ...cardEditorState,
    cardId: card.id ?? cardEditorState.cardId,
    initialState,
  };
  const set = (id, value) => {
    const element = $(id);
    if (element) element.value = value ?? "";
  };
  set("#card-name", card.name);
  set("#card-persona", card.persona);
  set("#card-personality", card.personality);
  set("#card-speaking", card.speaking_style);
  ["#directive-rows", "#character-attribute-rows", "#relation-rows"].forEach((selector) => {
    const container = $(selector);
    if (container) container.innerHTML = "";
  });
  (Array.isArray(card.directives) ? card.directives : []).forEach((directive) => {
    addDynamicRow("#directive-rows", { mode: "single", placeholder: "保持人设" });
    const inputs = document.querySelectorAll("#directive-rows .dynamic-row input");
    inputs[inputs.length - 1].value = directive;
  });
  Object.entries(defaultCharacterAttributes(card)).forEach(([name, value]) => addCharacterAttributeRow(name, value));
  Object.entries(card.relationships || {}).forEach(([name, value]) => {
    addDynamicRow("#relation-rows", { mode: "pair", placeholders: ["关系对象", "关系说明"] });
    const inputs = document.querySelectorAll("#relation-rows .dynamic-row input");
    inputs[inputs.length - 2].value = name;
    inputs[inputs.length - 1].value = value;
  });
}

async function submitCardForm() {
  if (!cardEditorState.loaded) return toast("角色卡尚未加载完成，无法保存", "error");
  const value = (id) => ($(id)?.value || "").trim();
  const name = value("#card-name");
  if (!name) return toast("请填写角色名", "error");
  const submitButton = $("#card-form")?.querySelector('[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = `${icon("refresh")} 保存中...`;
  }
  try {
    const works = await listAllWorks();
    const references = cardEditorState.cardId ? referencedWorksForCard(cardEditorState.cardId, works) : [];
    const referenceNames = referencedWorkNames(references).join("、");
    if (references.length && !window.confirm(`此角色卡已被 ${references.length} 个剧本引用。\n引用剧本：${referenceNames}\n保存后会影响这些剧本之后新开的会话；已经开始的旧会话不会改变。`)) return;
    const initialState = {
      ...cardEditorState.initialState,
      items: Array.isArray(cardEditorState.initialState?.items)
        ? cardEditorState.initialState.items
        : [],
      relations: cardEditorState.initialState?.relations || {},
    };
    const payload = {
      name,
      persona: value("#card-persona"),
      personality: value("#card-personality"),
      speaking_style: value("#card-speaking"),
      directives: collectSingleRows("#directive-rows"),
      character_attributes: collectAttributeRows("#character-attribute-rows"),
      relationships: collectPairRows("#relation-rows"),
      initial_state: initialState,
    };
    if (cardEditorState.cardId) await updateCard(cardEditorState.cardId, payload);
    else await createCard(payload);
    toast("角色卡已保存", "success");
    navigate("#/cards");
  } catch (error) {
    toast(error.message || "保存角色卡失败", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${icon("check")} 保存角色卡`;
    }
  }
}

function bindCardEditorEvents() {
  $("#add-directive")?.addEventListener("click", () => addDynamicRow("#directive-rows", { mode: "single", placeholder: "保持人设" }));
  $("#add-character-attribute")?.addEventListener("click", () => addCharacterAttributeRow());
  $("#add-relation")?.addEventListener("click", () => addDynamicRow("#relation-rows", { mode: "pair", placeholders: ["关系对象", "关系说明"] }));
  $("#card-editor-back")?.addEventListener("click", () => navigate("#/cards"));
  $("#card-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const importedCard = imported.card || imported;
      fillCardForm(
        { ...importedCard, id: cardEditorState.cardId },
        { preserveHiddenInitialState: Boolean(cardEditorState.cardId) }
      );
      toast("角色卡已导入", "success");
    } catch {
      toast("无法解析这个 JSON 文件", "error");
    }
  });
  $("#card-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCardForm();
  });
}

function setCardEditorSaveEnabled(enabled) {
  const saveButton = $("#card-save-btn");
  if (saveButton) saveButton.disabled = !enabled;
}

async function loadCardIntoEditor(cardId) {
  cardEditorState.loaded = false;
  setCardEditorSaveEnabled(false);
  const loadError = $("#card-load-error");
  try {
    const card = await getCard(cardId);
    fillCardForm(card);
    cardEditorState.loaded = true;
    if (loadError) {
      loadError.hidden = true;
      loadError.textContent = "";
    }
    setCardEditorSaveEnabled(true);
    return true;
  } catch (error) {
    if (loadError) {
      loadError.hidden = false;
      loadError.innerHTML = `无法加载角色卡：${esc(error.message || "请重试")} <button class="btn btn-sm btn-ghost" type="button" id="card-load-retry">重试</button>`;
      $("#card-load-retry")?.addEventListener("click", () => loadCardIntoEditor(cardId));
    }
    return false;
  }
}

async function renderCardEditor(cardId = null) {
  const isEditing = Number.isFinite(Number(cardId)) && Number(cardId) > 0;
  cardEditorState = { cardId: isEditing ? Number(cardId) : null, initialState: {}, loaded: !isEditing };
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">${isEditing ? "编辑角色卡" : "创建角色卡"}</h1><p class="page-subtitle">角色卡独立于剧本维护，可被多个剧本复用。</p></div>
        <div class="detail-actions"><input id="card-file" class="input card-file-input" type="file" accept=".json,application/json"><button class="btn btn-ghost" type="button" id="card-editor-back">${icon("arrow-left")} 返回角色卡库</button></div>
      </div>
      <p id="card-load-error" class="notice" hidden></p>
      <p id="card-reference-warning" class="notice" hidden></p>
      <form id="card-form" class="form-stack">
        <section class="panel"><div class="panel-header"><h2>角色信息</h2></div><div class="panel-body form-stack">
          <div class="form-grid">
            <label class="field"><span class="field-label">角色名</span><input id="card-name" class="input" required placeholder="角色名"></label>
            <label class="field"><span class="field-label">性格细节</span><input id="card-personality" class="input" placeholder="例如：警惕但守信"></label>
            <label class="field span-2"><span class="field-label">人设</span><textarea id="card-persona" class="textarea compact" placeholder="身份、经历与行为动机"></textarea></label>
            <label class="field span-2"><span class="field-label">语气与口头禅</span><textarea id="card-speaking" class="textarea compact" placeholder="语气、常用词与说话节奏"></textarea></label>
          </div>
          <div class="section"><h3 class="section-title">固定指令</h3><div id="directive-rows" class="dynamic-list"></div><button type="button" class="btn btn-sm btn-ghost" id="add-directive">${icon("plus")} 添加指令</button></div>
          <div class="section"><h3 class="section-title">剧情角色属性（AI 角色）</h3><div id="character-attribute-rows" class="dynamic-list"></div><button type="button" class="btn btn-sm btn-ghost" id="add-character-attribute">${icon("plus")} 添加角色属性</button></div>
          <div class="section"><h3 class="section-title">文字关系</h3><div id="relation-rows" class="dynamic-list"></div><button type="button" class="btn btn-sm btn-ghost" id="add-relation">${icon("plus")} 添加关系</button></div>
        </div></section>
        <div class="settings-actions"><button id="card-save-btn" type="submit" class="btn btn-primary"${isEditing ? " disabled" : ""}>${icon("check")} 保存角色卡</button></div>
      </form>
    </div>`;
  bindCardEditorEvents();
  if (!isEditing) {
    addDynamicRow("#directive-rows", { mode: "single", placeholder: "保持人设" });
    addCharacterAttributeRow("心情", 50);
    addCharacterAttributeRow("好感度", 0);
    addDynamicRow("#relation-rows", { mode: "pair", placeholders: ["关系对象", "关系说明"] });
    return;
  }
  if (!await loadCardIntoEditor(cardId)) return;
  try {
    const works = await listAllWorks();
    const references = referencedWorksForCard(cardId, works);
    if (references.length) {
      const warning = $("#card-reference-warning");
      const referenceNames = referencedWorkNamesHtml(references);
      warning.hidden = false;
      warning.innerHTML = `此角色卡已被 ${references.length} 个剧本引用，保存后会影响这些剧本之后新开的会话；已经开始的旧会话不会改变。<br>引用剧本：${referenceNames}`;
    }
  } catch (error) {
    toast(error.message || "角色卡引用信息加载失败", "error");
  }
}

async function renderCreator(workId = null) {
  const isEditing = Number.isFinite(Number(workId)) && Number(workId) > 0;
  creatorEditState = null;
  creatorEditWorkId = isEditing ? Number(workId) : null;
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">${isEditing ? "编辑作品" : "创作台"}</h1>
          <p class="page-subtitle">${isEditing ? "正在载入作品和世界书。" : "选择角色卡、配置世界书和作品开场。"}</p>
          ${isEditing ? '<p class="detail-meta" id="creator-load-status">正在读取编辑数据…</p>' : ""}
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost" id="back-btn">${icon("arrow-left")} 返回</button>
        </div>
      </div>
      <div class="creator-layout">
        <form id="creator-form" class="form-stack">
          <section class="panel">
            <div class="panel-header"><h2>作品信息</h2></div>
            <div class="panel-body form-stack">
              <div class="form-grid">
                <label class="field span-2"><span class="field-label">作品名</span><input id="work-title" class="input" required placeholder="例如：雾中王都"></label>
                <label class="field span-2"><span class="field-label">简介</span><textarea id="work-description" class="textarea compact" placeholder="一句话介绍这个作品"></textarea></label>
                <label class="field span-2"><span class="field-label">开场剧情</span><textarea id="work-opening" class="textarea" placeholder="玩家进入世界后看到的开场文字"></textarea></label>
                <div class="field span-2"><span class="field-label">回复模板</span><label class="entry-toggle"><input type="radio" id="disable-reply-template" name="active-reply-template" class="reply-template-active" value="" checked> 不启用模板</label><div id="reply-template-rows" class="reply-template-list" data-active-field="active_reply_template_id"></div><button type="button" class="btn btn-sm btn-ghost" id="add-reply-template">${icon("plus")} 添加模板</button></div>
                <div class="field span-2"><span class="field-label">开局引导字段</span><div id="onboarding-field-rows" class="form-stack"></div><button type="button" class="btn btn-sm btn-ghost" id="add-onboarding-field">${icon("plus")} 添加字段</button></div>
                <div class="field span-2">
                  <span class="field-label">角色卡（按顺序生效）</span>
                  <div id="work-card-rows" class="work-card-list"><p class="detail-meta work-card-empty">当前剧本暂未引用角色卡；不使用角色卡也可以保存。</p></div>
                  <div class="work-card-add-row"><select id="work-card-add" class="select"><option value="">正在加载角色卡…</option></select><button type="button" class="btn btn-sm btn-ghost" id="add-work-card">${icon("plus")} 添加角色卡</button></div>
                </div>
                <div class="field span-2">
                  <span class="field-label">玩家初始属性</span>
                  <div id="player-attribute-rows" class="dynamic-list"></div>
                  <button type="button" class="btn btn-sm btn-ghost" id="add-player-attribute">${icon("plus")} 添加属性</button>
                </div>
                <label class="field span-2"><span class="field-label">标签</span><input id="work-tags" class="input" placeholder="20+, 奇幻, 大世界（逗号分隔）"></label>
                <label class="field span-2"><span class="field-label">封面图片链接</span><input id="work-cover-url" class="input" placeholder="https://example.com/cover.jpg"></label>
                <label class="field span-2"><span class="field-label">或上传本地封面</span><input id="work-cover-file" class="input" type="file" accept="image/*"></label>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header"><h2>世界书</h2></div>
            <div class="panel-body form-stack">
              <div class="form-grid">
                <label class="field"><span class="field-label">世界书名</span><input id="wb-title" class="input" placeholder="例如：雾中王都设定"></label>
                <label class="field"><span class="field-label">说明</span><input id="wb-description" class="input" placeholder="世界书说明"></label>
              </div>
              <div class="section">
                <h3 class="section-title">世界书条目</h3>
                <div id="entry-rows" class="entry-list"></div>
                <button type="button" class="btn btn-sm btn-ghost" id="add-entry">${icon("plus")} 添加条目</button>
              </div>
            </div>
          </section>
          <div class="settings-actions">
            <button type="submit" class="btn btn-primary" id="creator-save-btn"${isEditing ? " disabled" : ""}>${icon("check")} ${isEditing ? "保存更新" : "保存作品"}</button>
            <button type="button" class="btn btn-ghost" id="preview-btn">${icon("eye")} 预览开场</button>
          </div>
        </form>
        <aside class="form-stack">
          <section class="panel">
            <div class="panel-header"><h2>创作提示</h2></div>
            <div class="panel-body section">
              <p class="detail-description">角色卡在角色卡库中独立创建和编辑；剧本只引用所选角色卡。开场决定玩家从哪醒来；世界书条目会在关键词出现时自动注入。</p>
              <div class="tag-list"><span class="tag">20+</span><span class="tag">高自由</span><span class="tag">文字</span></div>
              <a class="btn btn-sm btn-ghost" href="#/cards">前往角色卡库</a>
            </div>
          </section>
        </aside>
      </div>
    </div>`;
  addEntryCard();
  bindCreatorEvents();
  if (isEditing && MODE === "online") {
    setCreatorEditSaveEnabled(false);
    const [editDataResult, cardsResult] = await Promise.allSettled([
      loadCreatorEditData(workId),
      listAllCards(),
    ]);
    let editData = null;
    let workLoadError = null;
    let cardLoadError = null;

    if (editDataResult.status === "fulfilled") {
      editData = editDataResult.value;
      try {
        fillCreatorForm(editData);
      } catch (error) {
        workLoadError = error;
      }
    } else {
      workLoadError = editDataResult.reason;
    }

    if (cardsResult.status === "fulfilled" && editData) {
      const cards = cardsResult.value;
      if (areWorkCardIdsAvailable(editData.work, cards)) {
        populateWorkCardRows(cards, workCardIds(editData.work));
      } else {
        cardLoadError = new Error("该剧本引用的角色卡不存在或无法加载。");
      }
    } else if (cardsResult.status === "rejected") {
      cardLoadError = cardsResult.reason;
    }

    const status = $("#creator-load-status");
    if (!workLoadError && !cardLoadError && editData) {
      creatorEditState = {
        workId: editData.work.id,
        worldbookId: editData.worldbook.id || editData.work.worldbook_id,
        entryIds: new Set(editData.entries.map((entry) => Number(entry.id)).filter(Number.isFinite)),
      };
      setCreatorEditSaveEnabled(true);
      if (status) status.textContent = "编辑数据已载入。";
      return;
    }

    const errors = [];
    if (workLoadError) errors.push(`无法加载剧本编辑数据：${workLoadError.message || "发生未知错误"}`);
    if (cardLoadError) errors.push(`无法加载角色卡列表：${cardLoadError.message || "发生未知错误"}`);
    const message = errors.join("；") || "无法完成编辑数据初始化。";
    if (status) status.textContent = `${message} 保存已禁用。`;
    toast(message, "error");
    return;
  }
  try {
    const cards = await listAllCards();
    populateWorkCardRows(cards);
    if (isEditing) {
      const editData = await loadCreatorEditData(workId);
      fillCreatorForm(editData);
      populateWorkCardRows(cards, workCardIds(editData.work));
      creatorEditState = {
        workId: editData.work.id,
        worldbookId: editData.worldbook.id || editData.work.worldbook_id,
        entryIds: new Set(editData.entries.map((entry) => Number(entry.id)).filter(Number.isFinite)),
      };
      const status = $("#creator-load-status");
      if (status) status.textContent = "编辑数据已载入。";
    }
  } catch (error) {
    const message = error.message || "无法读取作品的编辑数据。";
    const status = $("#creator-load-status");
    if (status) status.textContent = `无法载入编辑数据：${message} 你仍可保留当前表单内容。`;
    toast(message, "error");
  }
}

async function renderSettings() {
  let cfg = {
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
  if (MODE !== "offline") {
    try {
      cfg = await api("/api/config");
    } catch {}
  } else {
    try {
      cfg = JSON.parse(localStorage.getItem(MOCK_SETTINGS_KEY) || "null") || cfg;
    } catch {}
  }
  const temperature = Number(cfg.generation?.temperature ?? 0.8);
  const contextWindowTokens = Number(cfg.generation?.context_window_tokens ?? 32768);
  const compressionTriggerRatio = Number(cfg.generation?.compression_trigger_ratio ?? 0.75);
  const compressionKeepRecentMessages = Number(cfg.generation?.compression_keep_recent_messages ?? 8);
  const compressionSummaryMaxTokens = Number(cfg.generation?.compression_summary_max_tokens ?? 1200);
  const reasoningEffort = ["off", "high", "max"].includes(cfg.generation?.reasoning_effort)
    ? cfg.generation.reasoning_effort
    : "off";
  const reasoningEnabled = reasoningEffort !== "off";
  const apiKeyDraft = localStorage.getItem(API_KEY_DRAFT_KEY) || "";
  appEl.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">设置</h1>
          <p class="page-subtitle">配置 DeepSeek 连接与生成参数，全部保存在本机。</p>
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost" id="test-btn">${icon("refresh")} 测试连接</button>
        </div>
      </div>
      <div class="settings-layout panel">
        <div class="panel-body form-stack">
          <div class="form-grid">
            <label class="field span-2"><span class="field-label">API Base URL</span><input id="cfg-base-url" class="input" value="${esc(cfg.deepseek?.base_url || "https://api.deepseek.com")}"></label>
            <label class="field"><span class="field-label">模型</span><div class="range-row"><select id="cfg-model" class="select"><option value="${esc(cfg.deepseek?.model || "deepseek-chat")}">${esc(cfg.deepseek?.model || "deepseek-chat")}</option></select><button class="btn btn-sm btn-ghost" id="fetch-models-btn" type="button">${icon("refresh")} 获取模型</button></div></label>
            <label class="field"><span class="field-label">API Key${cfg.deepseek?.api_key_set ? "（已配置）" : ""}</span><input id="cfg-key" class="input" type="password" value="${esc(apiKeyDraft)}" placeholder="${cfg.deepseek?.api_key_set ? "已保存，输入新值可覆盖" : "sk-..."}" autocomplete="off"></label>
            <label class="field span-2"><span class="field-label" id="cfg-temperature-label">温度 ${temperature.toFixed(2)}${reasoningEnabled ? "（推理中不可用）" : ""}</span><div class="range-row"><input id="cfg-temperature" class="input" type="range" min="0" max="1.5" step="0.05" value="${temperature}"${reasoningEnabled ? " disabled" : ""}><span class="range-value">${temperature.toFixed(2)}</span></div><span class="detail-meta" id="cfg-temperature-note">${reasoningEnabled ? "推理模式已启用：DeepSeek 不使用温度参数。" : "控制回复随机性：数值低更稳定，数值高更发散。"}</span></label>
            <label class="field span-2"><span class="field-label">推理强度</span><select id="cfg-reasoning-effort" class="select"><option value="off"${reasoningEffort === "off" ? " selected" : ""}>关闭：普通生成，更快，温度可调</option><option value="high"${reasoningEffort === "high" ? " selected" : ""}>高：先推理再回复，适合复杂剧情</option><option value="max"${reasoningEffort === "max" ? " selected" : ""}>最大：更深入推理，较慢且消耗更多</option></select><span class="detail-meta">推理内容不会展示；开启后温度会自动禁用。</span></label>
            <label class="field span-2"><span class="field-label">最大回复长度</span><input id="cfg-max-tokens" class="input" type="number" min="256" max="8192" step="256" value="${Number(cfg.generation?.max_tokens ?? 2048)}"></label>
            <label class="field"><span class="field-label">上下文窗口</span><input id="cfg-context-window" class="input" type="number" min="2048" max="131072" step="1" value="${contextWindowTokens}"></label>
            <label class="field"><span class="field-label">压缩触发比例</span><input id="cfg-compression-ratio" class="input" type="number" min="0.50" max="0.95" step="0.01" value="${compressionTriggerRatio.toFixed(2)}"></label>
            <label class="field"><span class="field-label">压缩保留最近消息</span><input id="cfg-compression-keep-recent" class="input" type="number" min="2" max="32" step="1" value="${compressionKeepRecentMessages}"></label>
            <label class="field"><span class="field-label">压缩摘要长度</span><input id="cfg-compression-summary-tokens" class="input" type="number" min="256" max="4096" step="1" value="${compressionSummaryMaxTokens}"></label>
          </div>
          <div class="settings-actions">
            <button class="btn btn-primary" id="save-settings-btn">${icon("save")} 保存设置</button>
            <span class="detail-meta">当前模式：${MODE === "online" ? "DeepSeek 在线" : MODE === "mock" ? "Mock 模式（未配置 Key）" : "离线演示"}</span>
          </div>
        </div>
      </div>
    </div>`;
  bindSettingsEvents();
}

function bindSettingsEvents() {
  const range = $("#cfg-temperature");
  const rangeValue = $(".range-value");
  const reasoningSelect = $("#cfg-reasoning-effort");
  const temperatureLabel = $("#cfg-temperature-label");
  const temperatureNote = $("#cfg-temperature-note");
  const apiKeyInput = $("#cfg-key");
  const readBoundedNumber = (selector, fallback, minimum, maximum, decimals = 0) => {
    const raw = $(selector)?.value;
    if (raw === undefined || String(raw).trim() === "") return fallback;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return fallback;
    const bounded = Math.max(minimum, Math.min(maximum, numeric));
    return decimals ? Number(bounded.toFixed(decimals)) : Math.round(bounded);
  };
  const previewCurrentConnection = async () => {
    const apiKey = apiKeyInput?.value.trim() || "";
    if (!apiKey) throw new Error("请先输入 API Key");
    localStorage.setItem(API_KEY_DRAFT_KEY, apiKey);
    return api("/api/models/preview", { method: "POST", body: {
      base_url: $("#cfg-base-url")?.value.trim() || "https://api.deepseek.com",
      api_key: apiKey,
      timeout_seconds: 60,
    } });
  };
  apiKeyInput?.addEventListener("input", () => {
    const apiKey = apiKeyInput.value.trim();
    localStorage.setItem(API_KEY_DRAFT_KEY, apiKey);
  });
  const syncGenerationControls = () => {
    const reasoningEnabled = reasoningSelect?.value !== "off";
    if (range) range.disabled = reasoningEnabled;
    if (temperatureLabel) {
      temperatureLabel.textContent = `温度 ${Number(range?.value ?? 0.8).toFixed(2)}${reasoningEnabled ? "（推理中不可用）" : ""}`;
    }
    if (temperatureNote) {
      temperatureNote.textContent = reasoningEnabled
        ? "推理模式已启用：DeepSeek 不使用温度参数。"
        : "控制回复随机性：数值低更稳定，数值高更发散。";
    }
  };
  if (range && rangeValue) {
    range.addEventListener("input", () => {
      rangeValue.textContent = Number(range.value).toFixed(2);
      syncGenerationControls();
    });
  }
  reasoningSelect?.addEventListener("change", syncGenerationControls);
  $("#fetch-models-btn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (MODE === "offline") {
      toast("离线演示模式无法获取模型列表", "info");
      return;
    }
    const modelSelect = $("#cfg-model");
    const currentModel = modelSelect?.value.trim();
    button.disabled = true;
    button.innerHTML = `${icon("refresh")} 获取中...`;
    try {
      const data = await previewCurrentConnection();
      const models = toItems(data)
        .map((item) => typeof item === "string" ? item : item?.id || item?.name || item?.model)
        .filter(Boolean);
      if (currentModel && !models.includes(currentModel)) models.unshift(currentModel);
      if (modelSelect) {
        modelSelect.innerHTML = "";
        [...new Set(models)].forEach((model) => {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = model;
          option.selected = model === currentModel;
          modelSelect.appendChild(option);
        });
      }
      toast(`已获取 ${new Set(models).size} 个模型`, "success");
    } catch (error) {
      toast(error.message || "获取模型列表失败", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon("refresh")} 获取模型`;
    }
  });
  $("#save-settings-btn")?.addEventListener("click", async () => {
    const apiKey = $("#cfg-key")?.value.trim() || "";
    const body = {
      deepseek: {
        base_url: $("#cfg-base-url")?.value.trim() || "https://api.deepseek.com",
        model: $("#cfg-model")?.value.trim() || "deepseek-chat",
        timeout_seconds: 60,
      },
      generation: {
        temperature: Number(range?.value ?? 0.8),
        max_tokens: Number($("#cfg-max-tokens")?.value || 2048),
        reasoning_effort: $("#cfg-reasoning-effort")?.value || "off",
        context_window_tokens: readBoundedNumber("#cfg-context-window", 32768, 2048, 131072),
        compression_trigger_ratio: readBoundedNumber("#cfg-compression-ratio", 0.75, 0.50, 0.95, 2),
        compression_keep_recent_messages: readBoundedNumber("#cfg-compression-keep-recent", 8, 2, 32),
        compression_summary_max_tokens: readBoundedNumber("#cfg-compression-summary-tokens", 1200, 256, 4096),
      },
    };
    if (apiKey) {
      localStorage.setItem(API_KEY_DRAFT_KEY, apiKey);
      body.deepseek.api_key = apiKey;
    }
    try {
      if (MODE === "offline") {
        localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(body));
        toast("离线设置已保存", "success");
      } else {
        await api("/api/config", { method: "PUT", body });
        toast("设置已保存", "success");
        await detectMode();
        renderSettings();
      }
    } catch (error) {
      toast(error.message || "保存失败", "error");
    }
  });
  $("#test-btn")?.addEventListener("click", async () => {
    toast("正在检查连接...", "info");
    if (MODE === "offline") return toast("无法连接本地后端", "error");
    try {
      const data = await previewCurrentConnection();
      toast(`DeepSeek 连接正常，发现 ${toItems(data).length} 个模型`, "success");
    } catch (error) {
      toast(error.message || "连接测试失败", "error");
    }
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = saved === "light" || (!saved && prefersLight) ? "light" : "dark";
  updateThemeIcon();
  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon();
  });
}

function updateThemeIcon() {
  if (!themeToggle) return;
  const isLight = document.documentElement.dataset.theme === "light";
  themeToggle.innerHTML = icon(isLight ? "moon" : "sun", isLight ? "切换暗色模式" : "切换明亮模式");
  themeToggle.setAttribute("aria-label", isLight ? "切换暗色模式" : "切换明亮模式");
}

function showAgeGate() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop age-gate">
      <div class="modal">
        <h2>内容确认</h2>
        <p>本软件用于个人文字冒险创作与游玩。</p>
        <div class="gate-rule">包含 20+ 成人向文字内容。仅限已满 20 岁的成年人使用。</div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="gate-exit">退出</button>
          <button class="btn btn-primary" id="gate-confirm">我已年满 20 岁，确认进入</button>
        </div>
      </div>
    </div>`;
  $("#gate-confirm")?.addEventListener("click", () => {
    localStorage.setItem(AGE_KEY, "1");
    modalRoot.innerHTML = "";
    startApp();
  });
  $("#gate-exit")?.addEventListener("click", () => {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h2>已退出</h2>
          <p>确认年龄后才能使用本软件。</p>
          <div class="modal-actions"><button class="btn btn-primary" data-close>关闭</button></div>
        </div>
      </div>`;
    modalRoot.querySelector("[data-close]")?.addEventListener("click", () => {
      modalRoot.innerHTML = "";
    });
  });
}

async function startApp() {
  loadMockData();
  await detectMode();
  window.addEventListener("hashchange", handleHashChange);
  window.addEventListener("beforeunload", handleBeforeUnload);
  await route();
}

function init() {
  initTheme();
  mountIcons(document);
  if (localStorage.getItem(AGE_KEY) !== "1") {
    showAgeGate();
    return;
  }
  startApp();
}

init();
