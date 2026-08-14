import assert from "node:assert/strict";
import test from "node:test";

import { createAuthState } from "./js/auth-state.mjs";

function fakeApi(responses) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(["GET", path]);
      const response = responses[`GET ${path}`];
      if (response instanceof Error) throw response;
      return response;
    },
    async post(path, body) {
      calls.push(["POST", path, body]);
      const response = responses[`POST ${path}`];
      if (response instanceof Error) throw response;
      return response;
    },
    async put(path, body) {
      calls.push(["PUT", path, body]);
      const response = responses[`PUT ${path}`];
      if (response instanceof Error) throw response;
      return response;
    },
    clearCsrfToken() {
      calls.push(["CLEAR_CSRF"]);
    },
  };
}

test("bootstrap 从 /api/auth/me 区分 authenticated 和 legacyClaimPending", async () => {
  const api = fakeApi({
    "GET /api/auth/me": {
      authenticated: true,
      user: { id: 7, username: "Alice" },
      legacy_claim_pending: true,
    },
  });
  const auth = createAuthState({ apiClient: api });
  const snapshots = [];
  auth.subscribe((snapshot) => snapshots.push(snapshot));

  const snapshot = await auth.bootstrap();

  assert.equal(snapshot.status, "authenticated");
  assert.deepEqual(snapshot.user, { id: 7, username: "Alice" });
  assert.equal(snapshot.legacyClaimPending, true);
  assert.equal(api.calls[0][0], "GET");
  assert.equal(snapshots.at(-1).status, "authenticated");
});

test("认证接口不可用时进入 unavailable，且不猜测旧数据内容", async () => {
  const api = fakeApi({ "GET /api/auth/me": new Error("network") });
  const auth = createAuthState({ apiClient: api });

  const snapshot = await auth.bootstrap();

  assert.deepEqual(snapshot, {
    status: "unavailable",
    user: null,
    legacyClaimPending: false,
  });
  assert.equal("legacyData" in snapshot, false);
});

test("login、register 和改密更新认证状态并保留服务端提供的用户资料", async () => {
  const api = fakeApi({
    "POST /api/auth/login": { authenticated: true, user: { id: 1, username: "alice" } },
    "POST /api/auth/register": { authenticated: true, user: { id: 2, username: "bob" }, legacy_data_claimed: true },
    "PUT /api/auth/password": { authenticated: true, user: { id: 2, username: "bob" } },
  });
  const auth = createAuthState({ apiClient: api });

  await auth.login({ username: "alice", password: "password-1" });
  assert.equal(auth.getSnapshot().user.username, "alice");
  await auth.register({ username: "bob", password: "password-2" });
  assert.equal(auth.getSnapshot().user.username, "bob");
  await auth.changePassword({ current_password: "password-2", new_password: "password-3" });
  assert.equal(auth.getSnapshot().status, "authenticated");
  assert.deepEqual(api.calls.at(-1), ["CLEAR_CSRF"]);
});

test("logout 成功后清理内存 CSRF、用户状态和订阅者可见状态", async () => {
  const api = fakeApi({
    "POST /api/auth/logout": null,
  });
  const auth = createAuthState({
    apiClient: api,
    initialSnapshot: { status: "authenticated", user: { id: 1, username: "alice" }, legacyClaimPending: false },
  });
  const snapshots = [];
  auth.subscribe((snapshot) => snapshots.push(snapshot));

  await auth.logout();

  assert.deepEqual(auth.getSnapshot(), { status: "anonymous", user: null, legacyClaimPending: false });
  assert.deepEqual(api.calls.at(-2), ["POST", "/api/auth/logout", undefined]);
  assert.deepEqual(api.calls.at(-1), ["CLEAR_CSRF"]);
  assert.equal(snapshots.at(-1).status, "anonymous");
});

test("return Hash 只使用 sessionStorage 且拒绝不安全值", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const auth = createAuthState({ apiClient: fakeApi({}), sessionStorage: storage });

  assert.equal(auth.rememberReturnHash("#/works/9"), true);
  assert.equal(values.get("neko.return_hash"), "#/works/9");
  assert.equal(auth.rememberReturnHash("//evil.example"), false);
  assert.equal(auth.consumeReturnHash(), "#/works/9");
  assert.equal(auth.consumeReturnHash(), null);
});
