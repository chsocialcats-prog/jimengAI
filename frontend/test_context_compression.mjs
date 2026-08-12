import assert from "node:assert/strict";
import test from "node:test";
import { readSource, sourceSection } from "./test_helpers.mjs";

const source = readSource("./js/main.js");
const adventureSource = readSource("./js/adventure-page.mjs");
const dataSource = readSource("./js/data.mjs");

const sendMessageSource = sourceSection(
  adventureSource,
  "async function sendMessage",
  "function stateSidebarHtml"
);
const bindSettingsSource = sourceSection(
  source,
  "function bindSettingsEvents",
  "function initTheme"
);
const renderSettingsSource = sourceSection(
  source,
  "async function renderSettings",
  "function bindSettingsEvents"
);

test("stream chat dispatches automatic context compression events", () => {
  assert.match(dataSource, /eventName === "context"/);
  assert.match(dataSource, /handlers\.onContext\?\.\(data\)/);
  assert.match(adventureSource, /正在整理上下文/);
  assert.match(adventureSource, /上下文已自动压缩/);

  const sendMessage = sendMessageSource;
  assert.match(sendMessage, /onContext: \(data\) =>/);
  assert.match(sendMessage, /data\?\.status === "compressing"/);
  assert.match(sendMessage, /data\?\.status === "compressed" \|\| data\?\.status === "fallback"/);
  assert.match(sendMessage, /setTimeout\(\(\) => \{[\s\S]*AI 正在书写\.\.\./);
  assert.match(sendMessage, /setStreamingUi\(false\)/);
});

test("settings page exposes and saves context compression controls", () => {
  const settings = renderSettingsSource;
  assert.match(dataSource, /context_window_tokens: 32768/);
  assert.match(dataSource, /compression_trigger_ratio: 0\.75/);
  assert.match(dataSource, /compression_keep_recent_messages: 8/);
  assert.match(dataSource, /compression_summary_max_tokens: 1200/);
  assert.match(settings, /const contextWindowTokens = Number\(cfg\.generation\?\.context_window_tokens \?\? 32768\)/);
  assert.match(settings, /const compressionTriggerRatio = Number\(cfg\.generation\?\.compression_trigger_ratio \?\? 0\.75\)/);
  assert.match(settings, /const compressionKeepRecentMessages = Number\(cfg\.generation\?\.compression_keep_recent_messages \?\? 8\)/);
  assert.match(settings, /const compressionSummaryMaxTokens = Number\(cfg\.generation\?\.compression_summary_max_tokens \?\? 1200\)/);
  assert.match(settings, /id="cfg-context-window"[^>]+min="2048"[^>]+max="131072"[^>]+step="1"[^>]+value="\$\{contextWindowTokens\}"/);
  assert.match(settings, /id="cfg-compression-ratio"[^>]+min="0\.50"[^>]+max="0\.95"[^>]+step="0\.01"[^>]+value="\$\{compressionTriggerRatio\.toFixed\(2\)\}"/);
  assert.match(settings, /id="cfg-compression-keep-recent"[^>]+min="2"[^>]+max="32"[^>]+step="1"[^>]+value="\$\{compressionKeepRecentMessages\}"/);
  assert.match(settings, /id="cfg-compression-summary-tokens"[^>]+min="256"[^>]+max="4096"[^>]+step="1"[^>]+value="\$\{compressionSummaryMaxTokens\}"/);

  const saveSettings = sourceSection(source, '$("#save-settings-btn")', '$("#test-btn")');
  assert.match(saveSettings, /generation:\s*\{[\s\S]*context_window_tokens: readBoundedNumber\("#cfg-context-window", 32768, 2048, 131072\)/);
  assert.match(saveSettings, /compression_trigger_ratio: readBoundedNumber\("#cfg-compression-ratio", 0\.75, 0\.50, 0\.95, 2\)/);
  assert.match(saveSettings, /compression_keep_recent_messages: readBoundedNumber\("#cfg-compression-keep-recent", 8, 2, 32\)/);
  assert.match(saveSettings, /compression_summary_max_tokens: readBoundedNumber\("#cfg-compression-summary-tokens", 1200, 256, 4096\)/);
  assert.match(saveSettings, /await saveSettings\(body\)/);
  assert.match(dataSource, /if \(MODE === "offline"\)[\s\S]*localStorage\.setItem\(MOCK_SETTINGS_KEY, JSON\.stringify\(settings\)\)/);
  assert.match(dataSource, /request\("\/api\/config", \{ method: "PUT", body: settings \}\)/);
  assert.match(saveSettings, /if \(apiKey\) \{[\s\S]*body\.deepseek\.api_key = apiKey;/);
});

test("sendMessage maps context statuses and restores the normal header", async () => {
  const timeline = [];
  const header = {};
  let headerValue = "";
  Object.defineProperty(header, "textContent", {
    get: () => headerValue,
    set: (value) => {
      headerValue = value;
      timeline.push(`header:${value}`);
    },
  });
  const sessionState = {
    conv: { id: 17 },
    messages: [],
    state: {},
    snapshots: [],
    sidebarTab: "state",
    streaming: false,
    hasUnsavedProgress: false,
  };
  const messageNode = {
    classList: { remove: () => {} },
    insertAdjacentHTML: () => {},
  };
  const messageText = {
    textContent: "",
    innerHTML: "",
    closest: () => messageNode,
  };
  const scheduled = [];
  let streamHandlers = null;
  const streamChat = async (_conversationId, _content, handlers) => {
    streamHandlers = handlers;
    handlers.onContext({ status: "compressing" });
    assert.equal(headerValue, "正在整理上下文");
    handlers.onContext({ status: "compressed" });
    assert.equal(headerValue, "上下文已自动压缩");
    const headerBeforeIgnored = headerValue;
    handlers.onContext({ status: "ignored" });
    assert.equal(headerValue, headerBeforeIgnored);
    handlers.onContext({ status: "fallback" });
    assert.equal(headerValue, "上下文已自动压缩");
    handlers.onDelta("reply");
  };
  const runtime = new Function(
    "streamChat",
    "$",
    "appendLocalMessage",
    "setStreamingUi",
    "createStreamingMessage",
    "scrollMessages",
    "renderSidebar",
    "getState",
    "getSnapshots",
    "messageOptionsHtml",
    "bindMessageOptionEvents",
    "messageTextHtml",
    "messageMetaHtml",
    "nowISO",
    "toast",
    "setTimeout",
    `${"let session = null;"}\n${sendMessageSource}\nreturn { sendMessage, setSession(value) { session = value; } };`
  )(
    streamChat,
    (selector) => selector === ".conversation-header-title span" ? header : null,
    () => {
      sessionState.messages.push({ role: "user", content: "hello" });
    },
    (streaming) => {
      timeline.push(`ui:${streaming}`);
      sessionState.streaming = streaming;
      header.textContent = streaming ? "streaming" : "normal";
    },
    () => messageText,
    () => {},
    () => {},
    async () => sessionState.state,
    async () => sessionState.snapshots,
    () => "",
    () => {},
    () => "reply",
    () => "",
    () => "2026-08-10 00:00:00",
    () => {},
    (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }
  );

  runtime.setSession(sessionState);
  await runtime.sendMessage("hello");

  const compressingIndex = timeline.indexOf("header:正在整理上下文");
  const compressedIndex = timeline.indexOf("header:上下文已自动压缩");
  assert.ok(compressingIndex >= 0);
  assert.ok(compressedIndex > compressingIndex);
  assert.ok(scheduled.length >= 1);
  assert.ok(scheduled.every(({ delay }) => delay > 0));
  scheduled.forEach(({ callback }) => callback());
  assert.equal(headerValue, "AI 正在书写...");
  await streamHandlers.onFinish();
  const finishIndex = timeline.lastIndexOf("ui:false");
  assert.deepEqual(timeline.filter((item) => item.startsWith("ui:")), ["ui:true", "ui:false"]);
  assert.ok(finishIndex > compressedIndex);
  assert.equal(headerValue, "normal");
});

test("renderSettings applies compression defaults to a partial saved config", async () => {
  const values = new Map([
    ["mock-settings", JSON.stringify({ generation: { temperature: 0.8 } })],
  ]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  let html = "";
  let bindCount = 0;
  const appEl = {};
  Object.defineProperty(appEl, "innerHTML", {
    get: () => html,
    set: (value) => { html = value; },
  });
  const renderSettings = new Function(
    "$",
    "MODE",
    "loadSettings",
    "getApiKeyDraft",
    "appEl",
    "icon",
    "esc",
    "bindSettingsEvents",
    `${renderSettingsSource}\nreturn renderSettings;`
  )(
    () => null,
    "offline",
    async () => JSON.parse(storage.getItem("mock-settings")),
    () => "",
    appEl,
    () => "",
    (value) => String(value ?? ""),
    () => { bindCount += 1; }
  );

  await renderSettings();
  assert.equal(bindCount, 1);
  assert.match(html, /id="cfg-context-window"[^>]+value="32768"/);
  assert.match(html, /id="cfg-compression-ratio"[^>]+value="0\.75"/);
  assert.match(html, /id="cfg-compression-keep-recent"[^>]+value="8"/);
  assert.match(html, /id="cfg-compression-summary-tokens"[^>]+value="1200"/);
});

test("settings save handler builds online and offline generation payloads", async () => {
  const makeControl = (value = "") => {
    const handlers = new Map();
    return {
      value,
      disabled: false,
      textContent: "",
      innerHTML: "",
      addEventListener(event, handler) {
        handlers.set(event, handler);
      },
      handlers,
    };
  };
  const makeStorage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      values,
    };
  };
  const configureControls = (apiKey) => {
    const controls = new Map([
      ["cfg-key", makeControl(apiKey)],
      ["cfg-base-url", makeControl("https://api.example.test")],
      ["cfg-model", makeControl("test-model")],
      ["cfg-temperature", makeControl("0.8")],
      ["cfg-max-tokens", makeControl("2048")],
      ["cfg-reasoning-effort", makeControl("off")],
      ["cfg-context-window", makeControl("8192")],
      ["cfg-compression-ratio", makeControl("0.75")],
      ["cfg-compression-keep-recent", makeControl("6")],
      ["cfg-compression-summary-tokens", makeControl("512")],
      ["save-settings-btn", makeControl()],
    ]);
    return { controls, query: (selector) => selector.startsWith("#") ? controls.get(selector.slice(1)) : makeControl() };
  };
  const bind = (mode, apiKey, storage, apiCalls) => {
    const { controls, query } = configureControls(apiKey);
    const saveSettings = async (body) => {
      if (mode === "offline") storage.setItem("mock-settings", JSON.stringify(body));
      else apiCalls.push({ path: "/api/config", options: { method: "PUT", body } });
      return body;
    };
    const bindSettings = new Function(
      "$",
      "MODE",
      "setApiKeyDraft",
      "previewModels",
      "saveSettings",
      "toast",
      "icon",
      "toItems",
      "detectDataMode",
      "updateModeBadge",
      "renderSettings",
      `${bindSettingsSource}\nreturn bindSettingsEvents;`
    )(
      query,
      mode,
      (value) => storage.setItem("api-key-draft", value),
      async () => [],
      saveSettings,
      () => {},
      () => "",
      () => [],
      async () => {},
      () => {},
      async () => {}
    );
    bindSettings();
    return { controls, save: controls.get("save-settings-btn").handlers.get("click") };
  };

  const offlineStorage = makeStorage();
  const offlineCalls = [];
  const offline = bind("offline", "", offlineStorage, offlineCalls);
  await offline.save();
  const offlineBody = JSON.parse(offlineStorage.getItem("mock-settings"));
  assert.deepEqual(
    {
      context_window_tokens: offlineBody.generation.context_window_tokens,
      compression_trigger_ratio: offlineBody.generation.compression_trigger_ratio,
      compression_keep_recent_messages: offlineBody.generation.compression_keep_recent_messages,
      compression_summary_max_tokens: offlineBody.generation.compression_summary_max_tokens,
    },
    {
      context_window_tokens: 8192,
      compression_trigger_ratio: 0.75,
      compression_keep_recent_messages: 6,
      compression_summary_max_tokens: 512,
    }
  );
  assert.equal("api_key" in offlineBody.deepseek, false);
  assert.equal(offlineCalls.length, 0);

  offline.controls.get("cfg-context-window").value = "999999";
  offline.controls.get("cfg-compression-ratio").value = "0.1";
  offline.controls.get("cfg-compression-keep-recent").value = "999";
  offline.controls.get("cfg-compression-summary-tokens").value = "1";
  await offline.save();
  const clampedBody = JSON.parse(offlineStorage.getItem("mock-settings"));
  assert.equal(clampedBody.generation.context_window_tokens, 131072);
  assert.equal(clampedBody.generation.compression_trigger_ratio, 0.5);
  assert.equal(clampedBody.generation.compression_keep_recent_messages, 32);
  assert.equal(clampedBody.generation.compression_summary_max_tokens, 256);

  const onlineStorage = makeStorage();
  const onlineCalls = [];
  const online = bind("online", "sk-test", onlineStorage, onlineCalls);
  await online.save();
  assert.equal(onlineCalls.length, 1);
  assert.equal(onlineCalls[0].path, "/api/config");
  assert.equal(onlineCalls[0].options.method, "PUT");
  assert.equal(onlineCalls[0].options.body.deepseek.api_key, "sk-test");
  assert.equal(onlineCalls[0].options.body.generation.context_window_tokens, 8192);
  assert.equal(onlineCalls[0].options.body.generation.compression_trigger_ratio, 0.75);
  assert.equal(onlineCalls[0].options.body.generation.compression_keep_recent_messages, 6);
  assert.equal(onlineCalls[0].options.body.generation.compression_summary_max_tokens, 512);
});
