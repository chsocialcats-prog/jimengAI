import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiClientError,
  createApiClient,
  isSafeReturnHash,
} from "./js/core/api-client.mjs";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("API 客户端为每个请求使用同源 Cookie 凭据", async () => {
  const requests = [];
  const client = createApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ ok: true });
    },
  });

  await client.get("/api/library");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.credentials, "same-origin");
});

test("第一次安全写请求先在内存中获取 CSRF 并自动附加请求头", async () => {
  const requests = [];
  const client = createApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url === "/api/auth/csrf") return jsonResponse({ csrf_token: "csrf-one" });
      return jsonResponse({ saved: true });
    },
  });

  await client.post("/api/cards", { title: "卡片" });

  assert.deepEqual(requests.map(({ url }) => url), ["/api/auth/csrf", "/api/cards"]);
  assert.equal(requests[1].init.headers["X-CSRF-Token"], "csrf-one");
  assert.equal(requests[1].init.credentials, "same-origin");
  assert.equal(requests[1].init.headers["Content-Type"], "application/json");
  assert.equal(requests[1].init.body, JSON.stringify({ title: "卡片" }));
});

test("只有 csrf_failed 会刷新令牌并重试一次原请求", async () => {
  const requests = [];
  let writeAttempts = 0;
  const client = createApiClient({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url === "/api/auth/csrf") {
        return jsonResponse({ csrf_token: requests.length === 1 ? "stale" : "fresh" });
      }
      writeAttempts += 1;
      if (writeAttempts === 1) {
        return jsonResponse({ error: { code: "csrf_failed", message: "过期" } }, { status: 403 });
      }
      return jsonResponse({ ok: true });
    },
  });

  const result = await client.put("/api/cards/1", { title: "新标题" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/auth/csrf",
    "/api/cards/1",
    "/api/auth/csrf",
    "/api/cards/1",
  ]);
  assert.equal(requests[3].init.headers["X-CSRF-Token"], "fresh");
});

test("网络失败、401 和普通 403 都不会自动重放", async () => {
  for (const scenario of ["network", "unauthorized", "forbidden"]) {
    const requests = [];
    const client = createApiClient({
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        if (url === "/api/auth/csrf") return jsonResponse({ csrf_token: "csrf" });
        if (scenario === "network") throw new TypeError("offline");
        if (scenario === "unauthorized") {
          return jsonResponse({ error: { code: "authentication_required", message: "请登录" } }, { status: 401 });
        }
        return jsonResponse({ error: { code: "forbidden", message: "禁止" } }, { status: 403 });
      },
    });

    await assert.rejects(() => client.post("/api/cards", { title: "x" }), ApiClientError);
    assert.equal(requests.filter(({ url }) => url === "/api/cards").length, 1, scenario);
  }
});

test("401 调用认证回调并只保存 allowlist 内的当前 Hash", async () => {
  const storage = new Map();
  const callbacks = [];
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const client = createApiClient({
    location: { hash: "#/works/42?tab=detail" },
    sessionStorage,
    onAuthRequired: (returnHash) => callbacks.push(returnHash),
    fetchImpl: async (url) => {
      if (url === "/api/auth/csrf") return jsonResponse({ csrf_token: "csrf" });
      return jsonResponse({ error: { code: "authentication_required", message: "请登录" } }, { status: 401 });
    },
  });

  await assert.rejects(() => client.post("/api/cards", { title: "x" }), (error) => {
    assert.equal(error.code, "authentication_required");
    return true;
  });

  assert.deepEqual(callbacks, ["#/works/42?tab=detail"]);
  assert.equal(storage.get("neko.return_hash"), "#/works/42?tab=detail");
});

test("非 authentication_required 的 401 不触发登录回调", async () => {
  let callbackCount = 0;
  const client = createApiClient({
    location: { hash: "#/works/42" },
    onAuthRequired: () => { callbackCount += 1; },
    fetchImpl: async () => jsonResponse({ error: { code: "invalid_credentials", message: "凭据错误" } }, { status: 401 }),
  });

  await assert.rejects(() => client.get("/api/protected"), ApiClientError);
  assert.equal(callbackCount, 0);
});

test("return Hash 拒绝外部协议、协议相对地址、换行和未知管理路由", () => {
  for (const hash of [
    "//evil.example",
    "#/https://evil.example",
    "#/%2F%2Fevil.example",
    "#/works/42?next=javascript:alert(1)",
    "#/works/%0aevil",
    "#/admin/users",
    "#/unknown-area",
  ]) {
    assert.equal(isSafeReturnHash(hash), false, hash);
  }
  assert.equal(isSafeReturnHash("#/works/42?tab=detail"), true);
  assert.equal(isSafeReturnHash("#/library"), true);
});

test("CSRF 令牌不写入浏览器存储", async () => {
  const storageCalls = [];
  const client = createApiClient({
    sessionStorage: {
      getItem: () => null,
      setItem: (...args) => storageCalls.push(args),
    },
    fetchImpl: async (url) => {
      if (url === "/api/auth/csrf") return jsonResponse({ csrf_token: "memory-only" });
      return jsonResponse({ ok: true });
    },
  });

  await client.post("/api/cards", { title: "x" });

  assert.deepEqual(storageCalls, []);
  assert.equal(client.getCsrfToken(), "memory-only");
});

test("非 JSON 错误被转换为稳定客户端错误而不暴露 HTML", async () => {
  const client = createApiClient({
    fetchImpl: async () => new Response("<html>secret upstream page</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    }),
  });

  await assert.rejects(() => client.get("/api/models"), (error) => {
    assert(error instanceof ApiClientError);
    assert.equal(error.code, "non_json_error");
    assert.equal(error.message.includes("secret upstream"), false);
    assert.equal(error.message.includes("<html>"), false);
    return true;
  });
});
