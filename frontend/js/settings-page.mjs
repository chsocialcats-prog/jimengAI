import { esc } from "./core/format.mjs";
import { icon } from "./icons.js";

const DEFAULT_CONFIG = {
  app: {},
  deepseek: { base_url: "https://api.deepseek.com", model: "deepseek-chat", timeout_seconds: 60 },
  generation: { temperature: 0.8, max_tokens: 2048, reasoning_effort: "off", context_window_tokens: 32768, compression_trigger_ratio: 0.75, compression_keep_recent_messages: 8, compression_summary_max_tokens: 1200 },
  api_key_set: false,
  api_key_unreadable: false,
};

export function normalizeSettingsSection(section) {
  return section === "profile" ? "profile" : "api";
}

export function avatarInitial(username) {
  return Array.from(String(username ?? "").trim())[0] || "用";
}

export function formatCreatedAt(value, locale = undefined) {
  if (value === null || value === undefined || String(value).trim() === "") return "未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function buildProfileViewModel(snapshotOrUser = {}) {
  const user = snapshotOrUser?.user && typeof snapshotOrUser.user === "object"
    ? snapshotOrUser.user
    : snapshotOrUser;
  const username = String(user?.username ?? "").trim() || "未命名账号";
  return {
    username,
    avatarInitial: avatarInitial(username),
    createdAt: formatCreatedAt(user?.created_at),
  };
}

export function buildSettingsViewModel(config = {}) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...config,
    deepseek: { ...DEFAULT_CONFIG.deepseek, ...(config.deepseek || {}) },
    generation: { ...DEFAULT_CONFIG.generation, ...(config.generation || {}) },
  };
  merged.api_key_set = Boolean(config.api_key_set ?? merged.deepseek.api_key_set);
  merged.api_key_unreadable = Boolean(config.api_key_unreadable ?? merged.deepseek.api_key_unreadable);
  return {
    config: merged,
    apiKeyInputValue: "",
    apiKeyStatus: merged.api_key_unreadable ? "已配置但当前不可读取" : merged.api_key_set ? "已配置（不可读取）" : "未配置，将使用 Mock 回复",
  };
}

function bounded(value, fallback, min, max, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const boundedValue = Math.max(min, Math.min(max, number));
  return integer ? Math.round(boundedValue) : boundedValue;
}

function navLink(section, activeSection, label) {
  const active = section === activeSection;
  return `<a class="settings-nav-link${active ? " active" : ""}" href="#/settings/${section}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
}

function settingsShell({ section, content, unavailable }) {
  const isProfile = section === "profile";
  return `
    <div class="page settings-page" data-settings-section="${section}">
      <div class="page-head"><div><p class="story-kicker">ACCOUNT SETTINGS</p><h1 class="page-title" tabindex="-1">账号设置</h1><p class="page-subtitle">${isProfile ? "查看账号资料并维护登录密码。" : "管理此账号使用的模型连接与生成参数，API Key 永不回填浏览器。"}</p></div></div>
      ${unavailable ? `<p class="notice" role="status">后端不可用：当前为离线只读演示，账号设置已禁用。</p>` : ""}
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="账号设置分区">
          ${navLink("api", section, "API 设置")}
          ${navLink("profile", section, "个人资料")}
        </nav>
        <div class="settings-content">${content}</div>
      </div>
    </div>`;
}

function apiSectionMarkup(view, { unavailable, loadError }) {
  const cfg = view.config;
  const g = cfg.generation;
  const disabled = unavailable ? " disabled" : "";
  return `
    ${loadError ? `<p class="form-error" role="alert" aria-live="polite">${esc(loadError.message || "无法读取设置")}</p>` : ""}
    <section class="panel settings-section" aria-labelledby="settings-connection-title"><div class="panel-header"><h2 id="settings-connection-title">DeepSeek 连接</h2></div><div class="panel-body form-stack">
      <label class="field"><span class="field-label">API Base URL</span><input id="settings-base-url" class="input" type="url" value="${esc(cfg.deepseek.base_url)}" autocomplete="url"${disabled}></label>
      <label class="field"><span class="field-label">模型</span><div class="range-row"><select id="settings-model" class="select"${disabled}><option>${esc(cfg.deepseek.model)}</option></select><button id="settings-models" class="btn btn-sm btn-ghost" type="button"${disabled}>${icon("refresh")} 获取模型</button></div></label>
      <label class="field"><span class="field-label">API Key</span><input id="settings-api-key" class="input" type="password" value="" placeholder="${esc(view.apiKeyStatus)}" autocomplete="off" aria-describedby="settings-key-status"${disabled}></label>
      <p class="detail-meta" id="settings-key-status">${esc(view.apiKeyStatus)}</p>
      <div class="settings-actions"><button id="settings-preview" class="btn btn-ghost" type="button"${disabled}>测试模型连接</button><button id="settings-clear-key" class="btn btn-danger" type="button"${!cfg.api_key_set || unavailable ? " disabled" : ""}>清除 API Key</button></div>
    </div></section>
    <section class="panel settings-section" aria-labelledby="settings-generation-title"><div class="panel-header"><h2 id="settings-generation-title">生成参数</h2></div><div class="panel-body form-stack">
      <label class="field"><span class="field-label">温度</span><input id="settings-temperature" class="input" type="number" min="0" max="1.5" step="0.05" value="${Number(g.temperature)}"${disabled}></label>
      <label class="field"><span class="field-label">最大回复长度</span><input id="settings-max-tokens" class="input" type="number" min="256" max="8192" value="${Number(g.max_tokens)}"${disabled}></label>
      <label class="field"><span class="field-label">推理强度</span><select id="settings-reasoning" class="select"${disabled}><option value="off"${g.reasoning_effort === "off" ? " selected" : ""}>关闭</option><option value="high"${g.reasoning_effort === "high" ? " selected" : ""}>高</option><option value="max"${g.reasoning_effort === "max" ? " selected" : ""}>最大</option></select></label>
      <label class="field"><span class="field-label">上下文窗口</span><input id="settings-context-window" class="input" type="number" min="2048" max="131072" value="${Number(g.context_window_tokens)}"${disabled}></label>
      <label class="field"><span class="field-label">压缩触发比例</span><input id="settings-compression-ratio" class="input" type="number" min="0.5" max="0.95" step="0.01" value="${Number(g.compression_trigger_ratio)}"${disabled}></label>
      <div class="settings-actions"><button id="settings-save" class="btn btn-primary" type="button"${disabled}>${icon("save")} 保存设置</button><span id="settings-feedback" class="detail-meta" role="status" aria-live="polite"></span></div>
    </div></section>`;
}

function profileSectionMarkup(profile, { unavailable }) {
  const disabled = unavailable ? " disabled" : "";
  return `
    <section class="panel settings-section settings-profile" aria-labelledby="settings-profile-title"><div class="panel-header"><h2 id="settings-profile-title">个人资料</h2></div><div class="panel-body form-stack">
      <div class="settings-profile-summary">
        <span class="settings-profile-avatar" aria-hidden="true">${esc(profile.avatarInitial)}</span>
        <div><strong>${esc(profile.username)}</strong><p class="detail-meta">账号创建于 ${esc(profile.createdAt)}</p></div>
      </div>
      <label class="field"><span class="field-label">用户名</span><input id="profile-username" class="input" value="${esc(profile.username)}" readonly aria-readonly="true"></label>
    </div></section>
    <section class="panel settings-section" aria-labelledby="password-title"><div class="panel-header"><h2 id="password-title">修改密码</h2></div><div class="panel-body form-stack">
      <p class="detail-meta">修改后，其他设备上的登录会话将失效。忘记密码时暂不支持自助恢复。</p>
      <label class="field"><span class="field-label">当前密码</span><input id="password-current" class="input" type="password" autocomplete="current-password"${disabled}></label>
      <label class="field"><span class="field-label">新密码</span><input id="password-new" class="input" type="password" minlength="10" autocomplete="new-password"${disabled}></label>
      <div class="settings-actions"><button id="password-save" class="btn btn-primary" type="button"${disabled}>更新密码</button><span id="password-feedback" class="detail-meta" role="status" aria-live="polite"></span></div>
    </div></section>`;
}

function bindApiSection(appEl, { apiClient, onSaved, view }) {
  const cfg = view.config;
  const g = cfg.generation;
  const feedback = appEl.querySelector("#settings-feedback");
  const requestPayload = () => ({
    deepseek: { base_url: appEl.querySelector("#settings-base-url").value.trim(), model: appEl.querySelector("#settings-model").value.trim(), timeout_seconds: 60 },
    generation: { temperature: bounded(appEl.querySelector("#settings-temperature").value, 0.8, 0, 1.5), max_tokens: bounded(appEl.querySelector("#settings-max-tokens").value, 2048, 256, 8192, true), reasoning_effort: appEl.querySelector("#settings-reasoning").value, context_window_tokens: bounded(appEl.querySelector("#settings-context-window").value, 32768, 2048, 131072, true), compression_trigger_ratio: bounded(appEl.querySelector("#settings-compression-ratio").value, 0.75, 0.5, 0.95), compression_keep_recent_messages: g.compression_keep_recent_messages, compression_summary_max_tokens: g.compression_summary_max_tokens },
  });

  appEl.querySelector("#settings-save")?.addEventListener("click", async () => {
    const button = appEl.querySelector("#settings-save");
    button.disabled = true;
    try {
      const body = requestPayload();
      const keyInput = appEl.querySelector("#settings-api-key");
      const key = keyInput.value.trim();
      if (key) body.deepseek.api_key = key;
      await apiClient.put("/api/config", body);
      keyInput.value = "";
      feedback.textContent = "设置已保存";
      onSaved?.();
    } catch (error) {
      feedback.textContent = error.message || "保存失败";
    } finally {
      button.disabled = false;
    }
  });

  appEl.querySelector("#settings-clear-key")?.addEventListener("click", async () => {
    if (!globalThis.confirm?.("确定清除当前账号的 API Key 吗？")) return;
    const button = appEl.querySelector("#settings-clear-key");
    button.disabled = true;
    try {
      await apiClient.put("/api/config", { deepseek: { clear_api_key: true } });
      feedback.textContent = "API Key 已清除";
      appEl.querySelector("#settings-key-status").textContent = "未配置，将使用 Mock 回复";
    } catch (error) {
      button.disabled = false;
      feedback.textContent = error.message || "清除失败";
    }
  });

  const preview = async (path) => {
    const key = appEl.querySelector("#settings-api-key").value.trim();
    try {
      const result = path === "/api/models"
        ? await apiClient.get(path)
        : await apiClient.post(path, { base_url: appEl.querySelector("#settings-base-url").value.trim(), model: appEl.querySelector("#settings-model").value.trim(), ...(key ? { api_key: key } : {}) });
      const models = (Array.isArray(result) ? result : result.items || result.data || [])
        .map((item) => typeof item === "string" ? item : item?.id || item?.name || item?.model)
        .filter(Boolean);
      const select = appEl.querySelector("#settings-model");
      if (models.length) select.innerHTML = [...new Set([select.value, ...models])].map((item) => `<option>${esc(item)}</option>`).join("");
      feedback.textContent = path === "/api/models/preview" ? `连接成功，发现 ${models.length} 个模型` : `已获取 ${models.length} 个模型`;
    } catch (error) {
      feedback.textContent = error.message || "模型请求失败";
    }
  };
  appEl.querySelector("#settings-models")?.addEventListener("click", () => preview("/api/models"));
  appEl.querySelector("#settings-preview")?.addEventListener("click", () => preview("/api/models/preview"));
}

function bindProfileSection(appEl, { auth }) {
  appEl.querySelector("#password-save")?.addEventListener("click", async () => {
    const button = appEl.querySelector("#password-save");
    const currentInput = appEl.querySelector("#password-current");
    const newInput = appEl.querySelector("#password-new");
    const feedback = appEl.querySelector("#password-feedback");
    button.disabled = true;
    feedback.classList.remove("form-error");
    try {
      await auth.changePassword({ current_password: currentInput.value, new_password: newInput.value });
      currentInput.value = "";
      newInput.value = "";
      feedback.textContent = "密码已更新";
    } catch (error) {
      feedback.classList.add("form-error");
      feedback.textContent = error.message || "修改密码失败";
    } finally {
      button.disabled = false;
    }
  });
}

export async function renderSettingsPage(appEl, {
  apiClient,
  auth,
  section = "api",
  snapshot = null,
  user = null,
  onSaved,
  unavailable = false,
} = {}) {
  const activeSection = normalizeSettingsSection(section);

  if (activeSection === "profile") {
    const authSnapshot = snapshot || auth?.getSnapshot?.() || null;
    const profile = buildProfileViewModel(user || authSnapshot || {});
    appEl.innerHTML = settingsShell({
      section: activeSection,
      unavailable,
      content: profileSectionMarkup(profile, { unavailable }),
    });
    if (!unavailable) bindProfileSection(appEl, { auth });
    return profile;
  }

  let view = buildSettingsViewModel();
  let loadError = null;
  if (!unavailable) {
    try {
      view = buildSettingsViewModel(await apiClient.get("/api/config"));
    } catch (error) {
      loadError = error;
    }
  }
  appEl.innerHTML = settingsShell({
    section: activeSection,
    unavailable,
    content: apiSectionMarkup(view, { unavailable, loadError }),
  });
  if (!unavailable) bindApiSection(appEl, { apiClient, onSaved, view });
  return view;
}
