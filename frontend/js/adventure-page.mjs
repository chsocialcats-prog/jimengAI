import { icon } from "./icons.js";
import { clamp, esc, formatTime, nowISO } from "./core/format.mjs";
import {
  REPLY_LENGTH_PRESETS,
  loadReplyLength,
  saveReplyLength,
} from "./chat/reply-length.mjs";
import {
  cardSummaryText,
  normalizeRoleCards,
  resolveSessionCards,
} from "./domain/role-cards.mjs";
import {
  MODE,
  addCorrection,
  createSnapshot,
  deleteConversation,
  deleteSnapshot,
  getConversation,
  getMessages,
  getSnapshots,
  getState,
  getWork,
  getWorldbook,
  restoreSnapshot,
  stopConversation,
  streamChat,
  submitOnboarding,
} from "./data.mjs";

let appEl = null;
let modalRoot = null;
let navigate = null;
let toast = null;
let openModal = null;
let session = null;
let appClickHandler = null;

const $ = (selector, root = document) => root.querySelector(selector);

export function configureAdventurePage(deps) {
  ({ appEl, modalRoot, navigate, toast, openModal } = deps);
}

export function activeAdventureHash() {
  return session?.conv ? `#/adventure/${session.conv.id}` : "";
}

export function hasUnsavedProgress() {
  return Boolean(session?.conv && (session.streaming || session.hasUnsavedProgress));
}

export async function saveBeforeLeave(name = "离开前存档") {
  const activeSession = session;
  if (!activeSession?.conv) return;
  await createSnapshot(activeSession.conv.id, name);
  if (session === activeSession) activeSession.hasUnsavedProgress = false;
}

export function dispose() {
  if (appEl && appClickHandler) appEl.removeEventListener("click", appClickHandler);
  appClickHandler = null;
  session = null;
}

export function stateChangeLineHtml(line) {
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

export function messageTextHtml(content) {
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

export function replyCharacterCount(content) {
  return Array.from(String(content || ""))
    .filter((char) => !/\s/u.test(char))
    .length;
}

export function messageMetaHtml(message) {
  if (message?.role !== "assistant" && message?.role !== "ai") return "";
  if (!message?.created_at || !String(message.content || "").trim()) return "";
  return `<div class="message-meta"><span>${esc(formatTime(message.created_at))}</span><span>${replyCharacterCount(message.content)} 字</span></div>`;
}

export function extractOptions(text) {
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
    if (match) addInline(match[1]);
  }
  return [...new Set(options.map((item) => item.trim()).filter(Boolean))].slice(0, 4);
}

export function extractImplicitOptions(text) {
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

export function messageOptionsHtml(aiText, explicitOptions = []) {
  const options = explicitOptions.length ? explicitOptions : extractOptions(aiText);
  if (!options.length) return "";
  return `<div class="message-options"><span class="options-label">可选行动</span><div class="option-grid">${options.map((option, index) => `<button class="option-button message-option" data-option="${index}" data-option-value="${esc(option)}">${esc(option)}</button>`).join("")}</div></div>`;
}

function messageHtml(message) {
  const role = message.role === "user" ? "user" : message.role === "system" ? "system" : "ai";
  const label = role === "user" ? "你" : role === "system" ? "系统" : "AI";
  const options = role === "ai" ? messageOptionsHtml(message.content, message.metadata?.options || []) : "";
  const meta = role === "ai" ? messageMetaHtml(message) : "";
  return `<div class="message ${role}" data-message-id="${esc(message.id || "")}"><span class="message-label">${label}</span><span class="message-text">${messageTextHtml(message.content)}</span>${options}${meta}</div>`;
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
  const replyLengthSelect = $("#reply-length-select");
  if (replyLengthSelect) replyLengthSelect.disabled = streaming;
  const headerMeta = $(".conversation-header-title span");
  if (headerMeta) headerMeta.textContent = streaming ? "AI 正在书写..." : `${session.messages.length} 条消息 · 自动存档已开启`;
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
          if (session === activeSession && activeSession.streaming) headerMeta.textContent = "AI 正在书写...";
        }, 800);
      }
    },
    onError: (message) => toast(message || "AI 回复失败", "error"),
    onDone: (data) => {
      streamOptions = Array.isArray(data?.options) ? data.options.filter(Boolean).slice(0, 4) : [];
    },
    onFinish: async () => {
      if (session !== activeSession) return;
      let assistantMessage = null;
      if (acc.trim()) {
        assistantMessage = {
          id: `local-${Date.now()}-${Math.random()}`,
          role: "assistant",
          content: acc,
          metadata: { options: streamOptions },
          created_at: nowISO(),
        };
        session.messages.push(assistantMessage);
        messageText.innerHTML = messageTextHtml(assistantMessage.content);
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
      if (assistantMessage && message) message.insertAdjacentHTML("beforeend", messageMetaHtml(assistantMessage));
      setStreamingUi(false);
      scrollMessages();
    },
  }, activeSession.replyLength ? { reply_length: activeSession.replyLength } : {});
}

function stateSidebarHtml(state = {}) {
  const attrs = Object.entries(state.attributes || {}).map(([name, value]) => {
    const n = clamp(value, 0, 100);
    return `<div class="stat-item"><div class="stat-item-label"><span>${esc(name)}</span><strong>${esc(value)}</strong></div><div class="stat-bar"><i style="width:${n}%"></i></div></div>`;
  }).join("");
  const items = (state.items || []).length
    ? state.items.map((item) => `<div class="state-row"><strong>${esc(item)}</strong><span>物品</span></div>`).join("")
    : `<div class="state-row"><strong>空</strong><span>背包</span></div>`;
  const quests = (state.quests || []).length
    ? state.quests.map((quest) => `<div class="state-row"><strong>${esc(quest.title || "")}</strong><span class="tag">${esc(quest.status || "进行中")}</span></div>`).join("")
    : `<div class="state-row"><strong>暂无任务</strong><span>任务</span></div>`;
  const relations = Object.entries(state.relations || {}).map(([name, desc]) => `<div class="state-row"><strong>${esc(name)}</strong><span>${esc(desc)}</span></div>`).join("");
  const characters = Object.entries(state.characters || {}).map(([name, character]) => {
    const attributes = Object.entries(character?.attributes || {}).map(([attribute, value]) => `<div class="stat-item"><div class="stat-item-label"><span>${esc(attribute)}</span><strong>${esc(value)}</strong></div><div class="stat-bar"><i style="width:${clamp(value, 0, 100)}%"></i></div></div>`).join("");
    const flags = (character?.flags || []).map((flag) => `<span class="tag">${esc(flag)}</span>`).join("");
    return `<article class="character-state-card"><h4>${esc(name)}</h4><div class="stat-grid">${attributes || `<div class="state-row"><strong>暂无数值</strong><span>—</span></div>`}</div>${flags ? `<div class="tag-list">${flags}</div>` : ""}</article>`;
  }).join("");
  const logs = (state.logs || []).slice(0, 8).map((log) => `<div class="state-row"><strong>${esc(log.message || log.type || "")}</strong><span>${formatTime(log.time || log.created_at)}</span></div>`).join("") || `<div class="state-row"><strong>暂无日志</strong><span>记录</span></div>`;
  return `<section class="stat-block"><h3 class="stat-block-title">属性</h3><div class="stat-grid">${attrs || `<div class="state-row"><strong>暂无属性</strong><span>—</span></div>`}</div></section>
    <section class="stat-block"><h3 class="stat-block-title">金钱</h3><div class="state-list"><div class="state-row"><strong>${esc(state.money ?? 0)}</strong><span>金币</span></div></div></section>
    <section class="stat-block"><h3 class="stat-block-title">背包</h3><div class="state-list">${items}</div></section>
    <section class="stat-block"><h3 class="stat-block-title">任务</h3><div class="state-list">${quests}</div></section>
    ${characters ? `<section class="stat-block"><h3 class="stat-block-title">剧情角色</h3><div class="character-state-list">${characters}</div></section>` : ""}
    ${relations ? `<section class="stat-block"><h3 class="stat-block-title">关系</h3><div class="state-list">${relations}</div></section>` : ""}
    <section class="stat-block"><h3 class="stat-block-title">日志</h3><div class="state-list">${logs}</div></section>`;
}

function snapshotSidebarHtml(snapshots = []) {
  const cards = snapshots.map((snapshot) => `<div class="snapshot-card"><div class="snapshot-card-header"><strong>${esc(snapshot.name || "未命名存档")}</strong><button class="icon-btn btn-sm" data-snapshot-restore="${Number(snapshot.id)}" title="读档">${icon("refresh")}</button><button class="icon-btn btn-sm" data-snapshot-delete="${Number(snapshot.id)}" title="删除存档">${icon("trash")}</button></div><div class="snapshot-card-meta">${formatTime(snapshot.created_at)} · ${esc(snapshot.note || "")}</div></div>`).join("");
  return `<button class="btn btn-primary" id="save-snapshot-btn" style="width:100%">${icon("save")} 创建存档</button><div class="snapshot-list">${cards || `<div class="state-row"><strong>暂无存档</strong><span>记录</span></div>`}</div>`;
}

function renderSidebar(tab) {
  if (!session) return;
  session.sidebarTab = tab || "state";
  document.querySelectorAll("[data-sidebar-tab]").forEach((btn) => btn.classList.toggle("active", btn.dataset.sidebarTab === session.sidebarTab));
  const body = $("#sidebar-body");
  if (!body) return;
  body.innerHTML = session.sidebarTab === "state" ? stateSidebarHtml(session.state) : snapshotSidebarHtml(session.snapshots);
  bindSidebarBodyEvents();
}

function bindSidebarBodyEvents() {
  $("#save-snapshot-btn")?.addEventListener("click", openSaveModal);
  document.querySelectorAll("[data-snapshot-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const snapshotId = Number(btn.dataset.snapshotRestore);
      try {
        const restored = await restoreSnapshot(session.conv.id, snapshotId);
        session.state = restored.state || {};
        if (restored.conversation) session.conv = restored.conversation;
        session.messages = Array.isArray(restored.messages) ? restored.messages : await getMessages(session.conv.id);
        session.snapshots = await getSnapshots(session.conv.id);
        session.hasUnsavedProgress = false;
        renderMessages();
        renderSidebar(session.sidebarTab);
        toast("已读档", "success");
      } catch (error) {
        toast(error.message || "读档失败", "error");
      }
    });
  });
  document.querySelectorAll("[data-snapshot-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await deleteSnapshot(session.conv.id, Number(btn.dataset.snapshotDelete));
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
  openModal(`<h2>保存进度</h2><p>给这个存档起个名字，之后可以在右侧存档列表恢复。</p><label class="field"><span class="field-label">存档名称</span><input class="input" data-value value="第 ${count} 章"></label><div class="modal-actions"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-confirm>保存</button></div>`, {
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

export async function renderOnboarding(conversationId) {
  const conversation = await getConversation(conversationId);
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
    event.preventDefault();
    const answers = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await submitOnboarding(conversationId, answers);
      navigate(`#/adventure/${conversationId}`);
    } catch (error) {
      toast(error.message || "开局设定保存失败", "error");
    }
  });
}

export async function renderAdventure(conversationId) {
  const conv = await getConversation(conversationId);
  const work = conv.work_id ? await getWork(conv.work_id) : null;
  const cards = resolveSessionCards(conv, work);
  const worldbook = work?.worldbook || await getWorldbook(work?.worldbook_id ?? conv.worldbook_id);
  const messages = await getMessages(conversationId);
  const state = await getState(conversationId);
  const snapshots = await getSnapshots(conversationId);
  const replyLength = MODE === "online" ? loadReplyLength(conv.id) : null;
  session = { conv, work, cards, card: cards[0] || null, messages, state, snapshots, replyLength, streaming: false, hasUnsavedProgress: false, sidebarTab: "state" };
  appEl.innerHTML = `<div class="page"><div class="page-head"><div><h1 class="page-title">${esc(conv.title || "冒险")}</h1><p class="page-subtitle">${esc(work ? work.title : "")} · ${esc(cardSummaryText(cards))}</p></div><div class="detail-actions adventure-actions"><button class="btn btn-ghost btn-sm" id="back-btn">${icon("arrow-left")} 返回</button><button class="btn btn-ghost btn-sm adventure-utility-btn" id="sidebar-toggle"><span class="button-emoji" aria-hidden="true">🧭</span><span>状态</span></button><button class="btn btn-ghost btn-sm adventure-utility-btn" id="onboarding-review-btn"><span class="button-emoji" aria-hidden="true">✨</span><span>编辑开局设定</span></button><button class="btn btn-ghost btn-sm" id="delete-btn">${icon("trash")} 删除</button></div></div>
    <div class="adventure-shell"><div class="conversation-pane"><div class="conversation-header"><div class="conversation-header-title"><strong>${esc(conv.title)}</strong><span></span></div><div class="session-card-summary">${esc(cardSummaryText(cards))}</div><button class="btn btn-sm btn-danger" id="stop-btn" style="display:none">${icon("stop")} 停止</button></div><div id="message-list" class="message-list"></div><div id="options-area" class="options-area"></div><div class="composer"><div class="quick-commands"><button class="quick-command" data-command="/状态">/状态</button><button class="quick-command" data-command="/背包">/背包</button><button class="quick-command" data-command="/存档">/存档</button><button class="quick-command" data-command="/帮助">/帮助</button><button class="quick-command" data-correction="persona">修正人设</button><button class="quick-command" data-correction="memory">修正记忆</button></div><div class="composer-row">${MODE === "online" ? `<label class="reply-length-control" for="reply-length-select"><span>回复长度</span><select id="reply-length-select" aria-label="回复长度">${Object.entries(REPLY_LENGTH_PRESETS).map(([key, preset]) => `<option value="${key}"${key === session.replyLength ? " selected" : ""}>${esc(preset.label)} · ${esc(preset.hint)}</option>`).join("")}</select></label>` : ""}<textarea id="composer-input" class="textarea compact" placeholder="输入你的行动..."></textarea><button class="btn btn-primary" id="send-btn">${icon("send")} 发送</button></div></div></div><aside class="status-sidebar" id="status-sidebar"><div class="sidebar-tabs"><button data-sidebar-tab="state" class="active">状态</button><button data-sidebar-tab="snapshots">存档</button></div><div id="sidebar-body" class="sidebar-body"></div></aside></div></div>`;
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
  const resolvedCards = normalizeRoleCards(cards);
  const cardDetails = resolvedCards.length ? resolvedCards.map((card) => `<h3>角色设定：${esc(card.name || "未命名角色")}</h3><p>${esc(card.persona || card.personality || "")}</p>`).join("") : "<h3>角色设定</h3><p>暂无角色</p>";
  const details = `<h2>${readOnly ? "本次会话设定" : "创建本次会话"}</h2><p>${esc(config.intro || "以下信息仅作用于当前聊天；可选填写，未填内容将沿用剧本默认设定。")}</p><h3>开场剧情</h3><p>${esc(work?.opening || "")}</p>${cardDetails}<h3>世界与记忆</h3><p>${esc(worldbook?.description || "")}</p>`;
  const visibleFields = readOnly ? [...fields, ...Object.keys(conversation.onboarding_answers || {}).filter((key) => !fields.some((field) => field.key === key)).map((key) => ({ key, label: key, type: "text" }))] : fields;
  const form = visibleFields.map((field) => {
    const value = conversation.onboarding_answers?.[field.key] || field.default || "";
    if (readOnly) return `<p><strong>${esc(field.label)}：</strong>${esc(value || "未填写")}</p>`;
    if (field.type === "select") return `<label class="field"><span class="field-label">${esc(field.label)}</span><select class="input" name="${esc(field.key)}">${(field.options || []).map((item) => `<option${item === value ? " selected" : ""}>${esc(item)}</option>`).join("")}</select></label>`;
    return `<label class="field"><span class="field-label">${esc(field.label)}</span><input class="input" name="${esc(field.key)}" value="${esc(value)}" placeholder="可留空" ${field.required ? "required" : ""}></label>`;
  }).join("");
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${details}<form id="adventure-onboarding-form">${form}${readOnly ? "" : '<div id="custom-settings"></div><button type="button" class="btn btn-ghost btn-sm" id="add-custom-setting">＋ 添加自定义设定</button>'}<div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>关闭</button>${readOnly ? "" : '<button class="btn btn-primary" type="submit">确认开始</button>'}</div></form></div></div>`;
  $("#add-custom-setting")?.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "form-grid";
    row.innerHTML = '<input class="input custom-setting-key" placeholder="设定名称"><input class="input custom-setting-value" placeholder="设定内容">';
    $("#custom-settings")?.appendChild(row);
  });
  $("#adventure-onboarding-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const answers = Object.fromEntries(new FormData(event.currentTarget).entries());
    document.querySelectorAll("#custom-settings .form-grid").forEach((row) => {
      const key = row.querySelector(".custom-setting-key")?.value.trim();
      const value = row.querySelector(".custom-setting-value")?.value.trim();
      if (key && value) answers[key] = value;
    });
    try {
      await submitOnboarding(conversation.id, answers);
      modalRoot.innerHTML = "";
      location.reload();
    } catch (error) {
      toast(error.message || "保存失败", "error");
    }
  });
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
  $(".adventure-shell")?.classList.toggle("sidebar-collapsed", hidden);
  button?.setAttribute("aria-expanded", String(!hidden));
}

function bindAdventureEvents() {
  $("#back-btn")?.addEventListener("click", () => navigate(session.conv.work_id ? `#/work/${session.conv.work_id}` : "#/"));
  $("#sidebar-toggle")?.addEventListener("click", toggleStatusSidebar);
  appClickHandler = (event) => {
    const sidebar = $("#status-sidebar");
    const toggle = $("#sidebar-toggle");
    if (sidebar?.classList.contains("open") && !sidebar.contains(event.target) && !toggle?.contains(event.target)) sidebar.classList.remove("open");
  };
  appEl.addEventListener("click", appClickHandler);
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
    try { await stopConversation(session.conv.id); } catch {}
  });
  document.querySelectorAll(".quick-command").forEach((btn) => btn.addEventListener("click", () => btn.dataset.correction ? openCorrectionModal(btn.dataset.correction) : sendMessage(btn.dataset.command)));
  const input = $("#composer-input");
  $("#send-btn")?.addEventListener("click", () => sendMessage(input?.value));
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input.value);
    }
  });
  const replyLengthSelect = $("#reply-length-select");
  replyLengthSelect?.addEventListener("change", () => {
    if (MODE !== "online" || !session) return;
    const value = saveReplyLength(session.conv.id, replyLengthSelect.value);
    session.replyLength = value;
    replyLengthSelect.value = value;
  });
  document.querySelectorAll("[data-sidebar-tab]").forEach((btn) => btn.addEventListener("click", () => renderSidebar(btn.dataset.sidebarTab)));
}

async function openCorrectionModal(kind) {
  const title = kind === "persona" ? "修正人设" : "修正记忆";
  const cards = Array.isArray(session.cards) ? session.cards : normalizeRoleCards(null, session.card);
  const worldbook = MODE === "offline" ? session.work?.worldbook : await getWorldbook(session.work?.worldbook_id);
  const defaultContent = kind === "persona"
    ? cards.flatMap((card) => [card?.name, card?.persona, card?.personality, card?.speaking_style, ...(card?.directives || [])]).filter(Boolean).join("\n")
    : [worldbook?.description, ...(worldbook?.entries || []).filter((entry) => /记忆|过去|回忆/.test(`${entry.title} ${entry.content}`)).map((entry) => entry.content)].filter(Boolean).join("\n");
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>${title}</h2><p>已自动带入剧本默认设定；可直接保存或编辑。仅影响当前对话之后的 AI 回复。</p><textarea id="correction-content" class="textarea" required>${esc(defaultContent)}</textarea><div class="modal-actions"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="save-correction">保存</button></div></div></div>`;
  modalRoot.querySelector("[data-close]")?.addEventListener("click", () => { modalRoot.innerHTML = ""; });
  $("#save-correction")?.addEventListener("click", async () => {
    const content = $("#correction-content")?.value.trim();
    if (!content) return toast("请填写修正内容", "error");
    try {
      session.conv = await addCorrection(session.conv.id, kind, content);
      session.hasUnsavedProgress = true;
      modalRoot.innerHTML = "";
      toast("修正已保存，将在下一次回复生效", "success");
    } catch (error) {
      toast(error.message || "保存失败", "error");
    }
  });
}
