// AI 对话冒险平台前端主程序
import { icon, mountIcons } from "./icons.js";
import { esc, formatTime } from "./core/format.mjs";
import {
  cardPersonalitySummary,
  normalizeRoleCards,
  orderedWorkCards,
  roleCardSummaryHtml,
  workCardIds,
} from "./domain/role-cards.mjs";
import {
  addAttributeRow,
  addDynamicRow,
  collectAttributeRows,
  configureCreatorPage,
  renderCreator,
} from "./creator-page.mjs";
import {
  activeAdventureHash,
  configureAdventurePage,
  dispose as disposeAdventurePage,
  hasUnsavedProgress,
  renderAdventure,
  renderOnboarding,
  saveBeforeLeave,
} from "./adventure-page.mjs";
import {
  MODE,
  createCard,
  createConversation,
  deleteCard,
  deleteConversation,
  deleteWork,
  detectMode as detectDataMode,
  getApiKeyDraft,
  getCard,
  getWork,
  getWorldbook,
  getWorldbookEntries,
  initializeData,
  listAllCards,
  listAllWorks,
  listCards,
  listConversations,
  listWorks,
  loadSettings,
  previewModels,
  saveSettings,
  seedDemo as seedDemoData,
  setApiKeyDraft,
  sortWorks,
  toItems,
  updateCard,
  updateConversation,
} from "./data.mjs";

const appEl = document.getElementById("app");
const modeBadge = document.getElementById("mode-badge");
const themeToggle = document.getElementById("theme-toggle");
const toastRoot = document.getElementById("toast-root");
const modalRoot = document.getElementById("modal-root");

const AGE_KEY = "adventure_age_confirmed";
const THEME_KEY = "adventure_theme";
let bypassAdventureLeavePrompt = false;
let libraryFilter = { q: "", tag: "", sort: "recommend" };
let cardEditorState = { cardId: null, initialState: {} };
let cardLibraryQuery = "";
let cardLibraryRenderToken = 0;

const $ = (selector, root = document) => root.querySelector(selector);

modalRoot?.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close]");
  if (!closeButton || !modalRoot.contains(closeButton)) return;
  event.preventDefault();
  event.stopPropagation();
  modalRoot.innerHTML = "";
});

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

configureCreatorPage({ appEl, navigate, toast, openModal });
configureAdventurePage({ appEl, modalRoot, navigate, toast, openModal });

function updateModeBadge() {
  const text = MODE === "online" ? "DeepSeek 在线" : MODE === "mock" ? "Mock 模式" : "离线演示";
  modeBadge.textContent = text;
  modeBadge.classList.toggle("online", MODE === "online");
  modeBadge.classList.toggle("mock", MODE !== "online");
}

async function seedDemo() {
  try {
    await seedDemoData();
    toast(MODE === "offline" ? "已载入示例作品" : "已创建示例作品", "success");
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

function commitNavigation(hash) {
  if (location.hash === hash) return;
  bypassAdventureLeavePrompt = true;
  location.hash = hash;
}

function requestAdventureLeave(targetHash) {
  if (!hasUnsavedProgress() || targetHash === activeAdventureHash()) {
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
    saveAndLeaveButton.disabled = true;
    saveAndLeaveButton.textContent = "正在存档…";
    try {
      await saveBeforeLeave();
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
  if (hasUnsavedProgress() && targetHash !== activeAdventureHash()) {
    history.replaceState(null, "", activeAdventureHash());
    requestAdventureLeave(targetHash);
    return;
  }
  route();
}

function handleBeforeUnload(event) {
  if (!hasUnsavedProgress()) return;
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
  disposeAdventurePage();
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

function addCharacterAttributeRow(name = "", value = "") {
  addAttributeRow("#character-attribute-rows", name, value);
}

function defaultCharacterAttributes(card = {}) {
  const configured = card.character_attributes || {};
  if (Object.keys(configured).length) return configured;
  const relation = card.initial_state?.relations?.[card.name];
  return { 心情: 50, 好感度: Number(relation) || 0 };
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

function referencedWorksForCard(cardId, works) {
  return (works || []).filter((work) => workCardIds(work).includes(Number(cardId)));
}

function referencedWorkNames(references = []) {
  return references.map((work) => String(work?.title || `剧本 #${work?.id ?? "未知"}`));
}

function referencedWorkNamesHtml(references = []) {
  return referencedWorkNames(references).map(esc).join("、");
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

function roleCardJsonFormatHtml() {
  const example = `{
  "name": "角色名",
  "persona": "身份、经历、行为动机和核心人设",
  "personality": "谨慎、嘴硬、重情",
  "speaking_style": "语气、常用词与说话节奏",
  "relationships": { "玩家": "与玩家的关系描述" },
  "directives": ["始终保持角色人设", "不要替玩家做决定"],
  "initial_state": {
    "attributes": { "魅力": 60, "武力": 40 },
    "items": [],
    "relations": {},
    "money": 100,
    "quests": [],
    "flags": []
  },
  "character_attributes": { "心情": 50, "好感度": 0 },
  "source": "local"
}`;
  return `
    <h2>角色卡 JSON 格式</h2>
    <p>仅 <code>name</code> 为必填字段；其余字段可按需要省略。</p>
    <p><code>persona</code>、<code>personality</code>、<code>speaking_style</code> 用于描述角色；<code>relationships</code>、<code>directives</code>、<code>initial_state</code> 和 <code>character_attributes</code> 可补充关系、指令与初始状态，<code>source</code> 标记来源。</p>
    <p>导入时可直接使用角色对象，也接受 <code>{ "card": { ... } }</code> 包装。<code>id</code>、<code>created_at</code> 和 <code>updated_at</code> 是响应字段；<code>world</code> 与 <code>opening</code> 属于作品／世界书配置。</p>
    <pre class="json-format-example"><code>${esc(example)}</code></pre>
    <div class="modal-actions"><button class="btn btn-primary" type="button" data-close>关闭</button></div>
  `;
}

function bindCardEditorEvents() {
  $("#add-directive")?.addEventListener("click", () => addDynamicRow("#directive-rows", { mode: "single", placeholder: "保持人设" }));
  $("#add-character-attribute")?.addEventListener("click", () => addCharacterAttributeRow());
  $("#add-relation")?.addEventListener("click", () => addDynamicRow("#relation-rows", { mode: "pair", placeholders: ["关系对象", "关系说明"] }));
  $("#card-editor-back")?.addEventListener("click", () => navigate("#/cards"));
  $("#card-json-format-btn")?.addEventListener("click", () => openModal(roleCardJsonFormatHtml()));
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
        <div class="detail-actions"><input id="card-file" class="input card-file-input" type="file" accept=".json,application/json"><button class="btn btn-ghost" type="button" id="card-json-format-btn">${icon("info")} JSON 格式</button><button class="btn btn-ghost" type="button" id="card-editor-back">${icon("arrow-left")} 返回角色卡库</button></div>
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
  try {
    cfg = await loadSettings();
  } catch {}
  const temperature = Number(cfg.generation?.temperature ?? 0.8);
  const contextWindowTokens = Number(cfg.generation?.context_window_tokens ?? 32768);
  const compressionTriggerRatio = Number(cfg.generation?.compression_trigger_ratio ?? 0.75);
  const compressionKeepRecentMessages = Number(cfg.generation?.compression_keep_recent_messages ?? 8);
  const compressionSummaryMaxTokens = Number(cfg.generation?.compression_summary_max_tokens ?? 1200);
  const reasoningEffort = ["off", "high", "max"].includes(cfg.generation?.reasoning_effort)
    ? cfg.generation.reasoning_effort
    : "off";
  const reasoningEnabled = reasoningEffort !== "off";
  const apiKeyDraft = getApiKeyDraft();
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
    setApiKeyDraft(apiKey);
    return previewModels({
      base_url: $("#cfg-base-url")?.value.trim() || "https://api.deepseek.com",
      api_key: apiKey,
      timeout_seconds: 60,
    });
  };
  apiKeyInput?.addEventListener("input", () => {
    const apiKey = apiKeyInput.value.trim();
    setApiKeyDraft(apiKey);
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
      setApiKeyDraft(apiKey);
      body.deepseek.api_key = apiKey;
    }
    try {
      await saveSettings(body);
      toast(MODE === "offline" ? "离线设置已保存" : "设置已保存", "success");
      if (MODE !== "offline") {
        await detectDataMode();
        updateModeBadge();
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
  await initializeData();
  updateModeBadge();
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
