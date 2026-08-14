import assert from "node:assert/strict";
import test from "node:test";

import {
  avatarInitial,
  buildProfileViewModel,
  formatCreatedAt,
  normalizeSettingsSection,
  renderSettingsPage,
} from "./js/settings-page.mjs";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  async dispatch(name) {
    return this.listeners.get(name)?.({ currentTarget: this });
  }
}

class FakeApp {
  constructor() {
    this.markup = "";
    this.nodes = new Map();
  }

  set innerHTML(markup) {
    this.markup = markup;
    this.nodes.clear();
    for (const match of markup.matchAll(/<[^>]+\sid="([^"]+)"[^>]*>/g)) {
      const value = /\svalue="([^"]*)"/.exec(match[0])?.[1] ?? "";
      this.nodes.set(match[1], new FakeElement(value));
    }
  }

  get innerHTML() {
    return this.markup;
  }

  querySelector(selector) {
    return selector.startsWith("#") ? this.nodes.get(selector.slice(1)) ?? null : null;
  }
}

test("设置分区规范化只接受 api 和 profile", () => {
  assert.equal(normalizeSettingsSection("api"), "api");
  assert.equal(normalizeSettingsSection("profile"), "profile");
  assert.equal(normalizeSettingsSection("unknown"), "api");
  assert.equal(normalizeSettingsSection(null), "api");
});

test("资料视图使用 Unicode 安全的首字符并容错创建时间", () => {
  assert.equal(avatarInitial("  张三"), "张");
  assert.equal(avatarInitial("👩‍🚀pilot"), "👩");
  assert.equal(avatarInitial(""), "用");
  assert.equal(formatCreatedAt("not-a-date", "zh-CN"), "时间未知");
  assert.equal(formatCreatedAt(null, "zh-CN"), "未提供");

  const profile = buildProfileViewModel({
    status: "authenticated",
    user: { username: " Alice ", created_at: "2025-01-02T03:04:00Z" },
  });
  assert.equal(profile.username, "Alice");
  assert.equal(profile.avatarInitial, "A");
  assert.match(profile.createdAt, /2025/);
});

test("个人资料分区不读取 AI 配置，并转义账号资料", async () => {
  const app = new FakeApp();
  const apiCalls = [];
  const auth = {
    getSnapshot: () => ({
      status: "authenticated",
      user: { username: '<img src=x onerror="boom">', created_at: "invalid" },
    }),
    async changePassword() {},
  };

  await renderSettingsPage(app, {
    section: "profile",
    apiClient: { async get(path) { apiCalls.push(path); throw new Error("不应调用"); } },
    auth,
  });

  assert.deepEqual(apiCalls, []);
  assert.match(app.innerHTML, /href="#\/settings\/profile" aria-current="page"/);
  assert.doesNotMatch(app.innerHTML, /href="#\/settings\/api" aria-current="page"/);
  assert.match(app.innerHTML, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.doesNotMatch(app.innerHTML, /<img src=x/);
  assert.match(app.innerHTML, /id="profile-username"[^>]+readonly/);
  assert.match(app.innerHTML, /id="password-feedback"[^>]+aria-live="polite"/);
});

test("API 分区单独读取配置并激活 API 导航", async () => {
  const app = new FakeApp();
  const apiCalls = [];
  const apiClient = {
    async get(path) {
      apiCalls.push(path);
      return { deepseek: { model: "deepseek-chat" }, api_key_set: true };
    },
    async put() {},
    async post() { return { items: [] }; },
  };

  await renderSettingsPage(app, { section: "api", apiClient, auth: {} });

  assert.deepEqual(apiCalls, ["/api/config"]);
  assert.match(app.innerHTML, /href="#\/settings\/api" aria-current="page"/);
  assert.doesNotMatch(app.innerHTML, /id="password-current"/);
  assert.match(app.innerHTML, /id="settings-api-key"[^>]+value=""/);
});

test("修改密码成功后清空两个密码输入并显示结果", async () => {
  const app = new FakeApp();
  const changes = [];
  const auth = {
    getSnapshot: () => ({ status: "authenticated", user: { username: "alice" } }),
    async changePassword(payload) { changes.push(payload); },
  };
  await renderSettingsPage(app, { section: "profile", apiClient: {}, auth });
  app.querySelector("#password-current").value = "old-password";
  app.querySelector("#password-new").value = "new-password-123";

  await app.querySelector("#password-save").dispatch("click");

  assert.deepEqual(changes, [{ current_password: "old-password", new_password: "new-password-123" }]);
  assert.equal(app.querySelector("#password-current").value, "");
  assert.equal(app.querySelector("#password-new").value, "");
  assert.equal(app.querySelector("#password-feedback").textContent, "密码已更新");
  assert.equal(app.querySelector("#password-save").disabled, false);
});
