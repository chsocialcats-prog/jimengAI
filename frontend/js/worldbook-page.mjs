import { esc } from "./core/format.mjs";
import { icon } from "./icons.js";
import { projectOwnership } from "./domain/ownership.mjs";

export function ownershipMeta(worldbook = {}) {
  const ownership = projectOwnership(worldbook);
  return { ownerLabel: ownership.ownerLabel, canEdit: ownership.canEdit, readOnly: ownership.isReadOnly };
}

export function renderReadOnlyStatus(adapter) {
  return adapter?.isReadOnly ? "离线只读演示：创建、编辑、删除和开始冒险已禁用。" : "";
}

function itemsOf(data) { return Array.isArray(data) ? data : data?.items || []; }

function ownerHtml(resource) {
  const meta = ownershipMeta(resource);
  return `<p class="resource-card-meta">${esc(meta.ownerLabel)}${meta.canEdit ? ` · <span class="tag">我的</span>` : ` · <span class="tag">只读</span>`}</p>`;
}

export async function renderWorldbooksPage(appEl, { apiClient, adapter, auth, navigate, unavailable = false } = {}) {
  let books = [];
  if (adapter?.isReadOnly) books = adapter.listWorldbooks();
  else if (!unavailable) books = itemsOf(await apiClient.get("/api/worldbooks?page=1&page_size=100"));
  const canCreate = !adapter?.isReadOnly && !unavailable && auth?.getSnapshot?.().status === "authenticated";
  appEl.innerHTML = `<div class="page worldbooks-page"><div class="page-head"><div><p class="story-kicker">WORLD BUILDING</p><h1 class="page-title" tabindex="-1">世界书</h1><p class="page-subtitle">公开浏览世界设定；只有创建者可以修改。</p></div><button id="worldbook-create" class="btn btn-primary" type="button"${adapter?.isReadOnly || unavailable ? " disabled" : ""}>${icon("plus")} ${canCreate ? "新建世界书" : "登录后新建"}</button></div>${renderReadOnlyStatus(adapter) ? `<p class="notice">${renderReadOnlyStatus(adapter)}</p>` : ""}<div id="worldbook-grid" class="resource-grid">${books.length ? books.map((book) => `<article class="resource-card" data-worldbook-id="${esc(book.id)}"><div class="resource-card-body"><div class="resource-card-heading"><h2>${esc(book.title || book.name || "未命名世界书")}</h2></div>${ownerHtml(book)}<p class="resource-card-description">${esc(book.description || "暂无描述")}</p></div><div class="resource-card-actions"><button class="btn btn-ghost" data-worldbook-open type="button">查看详情</button>${projectOwnership(book).canEdit ? `<button class="btn btn-ghost" data-worldbook-edit type="button">编辑</button>` : ""}</div></article>`).join("") : `<div class="empty-state">暂无世界书</div>`}</div></div>`;
  appEl.querySelector("#worldbook-create")?.addEventListener("click", () => {
    if (!canCreate) {
      auth?.rememberReturnHash?.(globalThis.location?.hash || "#/worldbooks");
      navigate("#/login");
      return;
    }
    navigate("#/worldbook/new");
  });
  appEl.querySelector("#worldbook-grid")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-worldbook-id]");
    if (!card) return;
    navigate(`${event.target.closest("[data-worldbook-edit]") ? "#/worldbook/" : "#/worldbook/"}${encodeURIComponent(card.dataset.worldbookId)}${event.target.closest("[data-worldbook-edit]") ? "/edit" : ""}`);
  });
  return books;
}

export async function renderWorldbookDetail(appEl, { apiClient, adapter, worldbookId, navigate, unavailable = false, edit = false } = {}) {
  let book;
  if (adapter?.isReadOnly) book = adapter.listWorldbooks().find((item) => String(item.id) === String(worldbookId));
  else if (!unavailable) book = await apiClient.get(`/api/worldbooks/${encodeURIComponent(worldbookId)}`);
  if (!book) throw new Error("世界书不存在");
  const entries = adapter?.isReadOnly ? book.entries || [] : itemsOf(await apiClient.get(`/api/worldbooks/${encodeURIComponent(worldbookId)}/entries?page=1&page_size=100`));
  const canEdit = projectOwnership(book).canEdit && !adapter?.isReadOnly && !unavailable;
  appEl.innerHTML = `<div class="page worldbook-detail-page"><div class="page-head"><div><p class="story-kicker">WORLD BOOK</p><h1 class="page-title" tabindex="-1">${esc(book.title || book.name)}</h1>${ownerHtml(book)}</div><div class="detail-actions"><button class="btn btn-ghost" id="worldbook-back" type="button">返回世界书</button>${canEdit ? `<button class="btn btn-primary" id="worldbook-edit" type="button">${icon("edit")} 编辑</button>` : ""}</div></div>${!canEdit ? `<p class="notice">${esc(projectOwnership(book).readOnlyReason || "当前为只读内容")}</p>` : ""}<section class="panel"><div class="panel-body section"><p class="detail-description">${esc(book.description || "暂无描述")}</p><div class="entry-list">${entries.length ? entries.map((entry) => `<article class="entry-card"><div class="entry-card-header"><strong>${esc(entry.title || "条目")}</strong><span class="tag">${esc((entry.keywords || []).join("、"))}</span></div><p>${esc(entry.content || "")}</p></article>`).join("") : "<p>暂无条目</p>"}</div></div></section></div>`;
  appEl.querySelector("#worldbook-back")?.addEventListener("click", () => navigate("#/worldbooks"));
  appEl.querySelector("#worldbook-edit")?.addEventListener("click", () => navigate(`#/worldbook/${encodeURIComponent(worldbookId)}/edit`));
  return { book, entries };
}

function entryDraftHtml(entry = {}) {
  const keywords = Array.isArray(entry.keywords) ? entry.keywords.join("、") : (entry.keywords || "");
  return `<article class="entry-card worldbook-entry-draft" data-entry-id="${entry.id ? esc(entry.id) : ""}">
    <div class="entry-card-header"><strong>${entry.id ? "已有条目" : "新条目"}</strong><button class="btn btn-sm btn-ghost" type="button" data-entry-remove>移除</button></div>
    <label class="field"><span class="field-label">标题</span><input class="input" data-entry-title value="${esc(entry.title || "")}" required></label>
    <label class="field"><span class="field-label">关键词（用顿号分隔）</span><input class="input" data-entry-keywords value="${esc(keywords)}"></label>
    <label class="field"><span class="field-label">内容</span><textarea class="textarea" data-entry-content rows="4" required>${esc(entry.content || "")}</textarea></label>
    <label class="field"><span class="field-label">优先级</span><input class="input" data-entry-priority type="number" value="${Number(entry.priority || 0)}"></label>
  </article>`;
}

export async function renderWorldbookEditor(appEl, { apiClient, adapter, auth, worldbookId, navigate, unavailable = false } = {}) {
  const isNew = String(worldbookId || "new") === "new";
  if (adapter?.isReadOnly || unavailable) {
    appEl.innerHTML = `<div class="page"><div class="empty-state"><h1 class="page-title">只读演示</h1><p>离线只读演示不能创建或编辑世界书。</p><button class="btn btn-primary" id="worldbook-editor-back" type="button">返回世界书</button></div></div>`;
    appEl.querySelector("#worldbook-editor-back")?.addEventListener("click", () => navigate("#/worldbooks"));
    return null;
  }
  if (auth?.getSnapshot?.().status !== "authenticated") {
    auth?.rememberReturnHash?.(globalThis.location?.hash || "#/worldbooks");
    navigate("#/login");
    return null;
  }

  let book = { title: "", description: "", entries: [] };
  if (!isNew) {
    book = await apiClient.get(`/api/worldbooks/${encodeURIComponent(worldbookId)}`);
    if (!projectOwnership(book).canEdit) {
      await renderWorldbookDetail(appEl, { apiClient, worldbookId, navigate });
      return null;
    }
    book.entries = itemsOf(await apiClient.get(`/api/worldbooks/${encodeURIComponent(worldbookId)}/entries?page=1&page_size=100`));
  }
  const encodedId = encodeURIComponent(worldbookId);
  appEl.innerHTML = `<div class="page worldbook-editor-page"><div class="page-head"><div><p class="story-kicker">WORLD BOOK EDITOR</p><h1 class="page-title" tabindex="-1">${isNew ? "新建世界书" : "编辑世界书"}</h1><p class="page-subtitle">世界书会公开展示；条目将用于后续新开的冒险。</p></div><button class="btn btn-ghost" id="worldbook-editor-back" type="button">返回世界书</button></div><form id="worldbook-editor-form" class="form-stack"><section class="panel"><div class="panel-body form-stack"><label class="field"><span class="field-label">标题</span><input id="worldbook-title" class="input" value="${esc(book.title || "")}" required></label><label class="field"><span class="field-label">描述</span><textarea id="worldbook-description" class="textarea" rows="4">${esc(book.description || "")}</textarea></label></div></section><section class="section"><div class="section-head"><div><h2 class="section-title">世界书条目</h2><p class="section-hint">关键词匹配到对话时，条目会进入剧情上下文。</p></div><button id="worldbook-entry-add" class="btn btn-ghost" type="button">${icon("plus")} 添加条目</button></div><div id="worldbook-entry-list" class="form-stack">${(book.entries || []).map(entryDraftHtml).join("")}</div></section><p id="worldbook-editor-feedback" class="form-error" role="alert" aria-live="polite"></p><div class="detail-actions"><button id="worldbook-editor-save" class="btn btn-primary" type="submit">${icon("save")} 保存世界书</button></div></form></div>`;

  const form = appEl.querySelector("#worldbook-editor-form");
  const entryList = appEl.querySelector("#worldbook-entry-list");
  const feedback = appEl.querySelector("#worldbook-editor-feedback");
  appEl.querySelector("#worldbook-editor-back")?.addEventListener("click", () => navigate("#/worldbooks"));
  appEl.querySelector("#worldbook-entry-add")?.addEventListener("click", () => {
    entryList.insertAdjacentHTML("beforeend", entryDraftHtml());
  });
  entryList?.addEventListener("click", (event) => {
    if (event.target.closest("[data-entry-remove]")) event.target.closest("[data-entry-id]")?.remove();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = appEl.querySelector("#worldbook-editor-save");
    const title = appEl.querySelector("#worldbook-title").value.trim();
    if (!title) {
      feedback.textContent = "请填写世界书标题";
      return;
    }
    const entries = [...entryList.querySelectorAll("[data-entry-id]")].map((element) => ({
      id: element.dataset.entryId ? Number(element.dataset.entryId) : null,
      title: element.querySelector("[data-entry-title]").value.trim(),
      keywords: element.querySelector("[data-entry-keywords]").value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      content: element.querySelector("[data-entry-content]").value.trim(),
      priority: Number(element.querySelector("[data-entry-priority]").value || 0),
      enabled: true,
    }));
    if (entries.some((entry) => !entry.title || !entry.content)) {
      feedback.textContent = "每个条目都需要标题和内容";
      return;
    }
    saveButton.disabled = true;
    feedback.textContent = "";
    try {
      const payload = { title, description: appEl.querySelector("#worldbook-description").value.trim() };
      const saved = isNew ? await apiClient.post("/api/worldbooks", payload) : await apiClient.put(`/api/worldbooks/${encodedId}`, payload);
      const savedId = isNew ? saved.id : worldbookId;
      const savedEntries = isNew ? [] : (book.entries || []);
      const retained = new Set();
      for (const entry of entries) {
        if (entry.id) {
          retained.add(entry.id);
          await apiClient.put(`/api/worldbooks/${encodeURIComponent(savedId)}/entries/${entry.id}`, entry);
        } else {
          await apiClient.post(`/api/worldbooks/${encodeURIComponent(savedId)}/entries`, entry);
        }
      }
      for (const oldEntry of savedEntries) {
        if (oldEntry.id && !retained.has(Number(oldEntry.id))) await apiClient.delete(`/api/worldbooks/${encodeURIComponent(savedId)}/entries/${oldEntry.id}`);
      }
      navigate(`#/worldbook/${encodeURIComponent(savedId)}`);
    } catch (error) {
      feedback.textContent = error.message || "保存世界书失败";
      saveButton.disabled = false;
    }
  });
  return book;
}
