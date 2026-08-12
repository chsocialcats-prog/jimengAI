import { icon } from "./icons.js";
import { esc } from "./core/format.mjs";
import {
  MODE,
  getWork,
  getWorldbook,
  getWorldbookEntries,
  listAllCards,
  listWorks,
  saveWorkBundle,
  updateWorkBundle,
} from "./data.mjs";
import { cardPersonalitySummary, workCardIds } from "./domain/role-cards.mjs";

let appEl = null;
let navigate = null;
let toast = null;
let creatorEditState = null;
let creatorEditWorkId = null;
let workCardOptions = [];

export function configureCreatorPage(deps) {
  ({ appEl, navigate, toast } = deps);
}

const $ = (selector, root = document) => root.querySelector(selector);

export function addDynamicRow(containerSelector, options = {}) {
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

export function addAttributeRow(selector, name = "", value = "") {
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

export function collectAttributeRows(selector) {
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
  let worldbook = work.worldbook || null;
  let entries = work.worldbook?.entries || [];
  if (MODE !== "offline" && work.worldbook_id) {
    [worldbook, entries] = await Promise.all([
      getWorldbook(work.worldbook_id),
      getWorldbookEntries(work.worldbook_id),
    ]);
    if (!worldbook) throw new Error("该作品关联的世界书不存在或已被删除。");
  }
  if (!worldbook) {
    worldbook = { id: null, title: `${work.title || "未命名剧本"} 的世界`, description: "", entries: [] };
    entries = [];
  }
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
  const sharedWorldbookWorks = editState.worldbookId == null
    ? []
    : otherWorks.filter((item) => Number(item.worldbook_id) === Number(editState.worldbookId));
  const impact = sharedWorldbookWorks.length
    ? `另有 ${sharedWorldbookWorks.length} 个作品会同步使用这本世界书。`
    : "没有其他作品共用这本世界书。";
  return window.confirm(`即将更新世界书和作品。${impact}\n\n是否继续保存？`);
}

async function saveCreatorEdit({ worldbook, work }) {
  const editState = creatorEditState;
  if (!editState) throw new Error("编辑数据尚未加载完成。");
  if (!await confirmCreatorEditSave(editState)) return false;

  await updateWorkBundle(editState.workId, editState.worldbookId, { work, worldbook });
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
    const saved = await saveWorkBundle({ work, worldbook });
    toast("作品已保存", "success");
    navigate(`#/work/${saved.work.id}`);
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

export async function renderCreator(workId = null) {
  if (!appEl || !navigate || !toast) throw new Error("创作台依赖尚未配置。");
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
        worldbookId: editData.worldbook.id ?? editData.work.worldbook_id ?? null,
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
        worldbookId: editData.worldbook.id ?? editData.work.worldbook_id ?? null,
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
