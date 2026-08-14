import assert from "node:assert/strict";
import test from "node:test";

import { authPageModel, isRateLimitError } from "./js/auth-page.mjs";

test("认证页面模型根据路由提供登录/注册标题和首个账号接管提示", () => {
  assert.equal(authPageModel("login", { status: "anonymous" }).title, "登录 NEKO");
  assert.equal(authPageModel("register", { status: "anonymous", legacyClaimPending: true }).title, "注册 NEKO");
  assert.match(authPageModel("register", { status: "anonymous", legacyClaimPending: true }).notice, /接管本机已有作品、会话和 AI 配置/);
});

test("认证页面识别限流错误并给出倒计时秒数", () => {
  assert.equal(isRateLimitError({ code: "rate_limited", details: { retry_after: 17 } }), 17);
  assert.equal(isRateLimitError({ code: "invalid_credentials" }), 0);
});
