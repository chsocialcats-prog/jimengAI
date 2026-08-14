import { esc } from "./core/format.mjs";

export function isRateLimitError(error) {
  if (error?.code !== "rate_limited") return 0;
  return Number(error.details?.retry_after || error.details?.retryAfter || error.retry_after || 0) || 0;
}

export function authPageModel(mode = "login", snapshot = {}) {
  const register = mode === "register";
  return {
    mode: register ? "register" : "login",
    title: register ? "注册 NEKO" : "登录 NEKO",
    submitLabel: register ? "创建账号" : "登录",
    alternateHash: register ? "#/login" : "#/register",
    alternateLabel: register ? "已有账号？去登录" : "还没有账号？去注册",
    notice: register && snapshot.legacyClaimPending
      ? "当前仍有待接管的本机数据；首个注册账号会接管本机已有作品、会话和 AI 配置。"
      : "用户名 3–32 个字符，密码至少 10 个字符。首版不提供找回密码功能。",
  };
}

function errorMessage(error) {
  if (error?.code === "invalid_credentials") return "用户名或密码错误";
  if (error?.code === "username_taken") return "这个用户名已经被占用";
  if (error?.code === "validation_error") return error.message || "请检查输入内容";
  if (error?.code === "rate_limited") return "尝试次数过多，请稍后再试";
  return error?.message || "暂时无法完成请求，请稍后重试";
}

export function renderAuthPage(appEl, { mode = "login", snapshot = {}, auth, navigate, focus = true } = {}) {
  const model = authPageModel(mode, snapshot);
  appEl.innerHTML = `
    <div class="page auth-page">
      <section class="auth-card panel" aria-labelledby="auth-page-title">
        <div class="panel-body form-stack">
          <p class="story-kicker">ACCOUNT ACCESS</p>
          <h1 class="page-title" id="auth-page-title">${esc(model.title)}</h1>
          <p class="page-subtitle">${esc(model.notice)}</p>
          <p class="notice auth-claim-notice" hidden></p>
          <form id="auth-form" class="form-stack" novalidate>
            <label class="field"><span class="field-label">用户名</span><input id="auth-username" class="input" name="username" autocomplete="username" required minlength="3" maxlength="32"></label>
            <label class="field"><span class="field-label">密码</span><input id="auth-password" class="input" name="password" type="password" autocomplete="${model.mode === "register" ? "new-password" : "current-password"}" required minlength="10" maxlength="128"></label>
            <p id="auth-error" class="form-error" role="alert" aria-live="polite"></p>
            <button id="auth-submit" class="btn btn-primary" type="submit">${esc(model.submitLabel)}</button>
          </form>
          <div class="auth-page-links"><a href="${model.alternateHash}">${esc(model.alternateLabel)}</a><a href="#/">返回作品库</a></div>
        </div>
      </section>
    </div>`;
  const form = appEl.querySelector("#auth-form");
  const submit = appEl.querySelector("#auth-submit");
  const errorEl = appEl.querySelector("#auth-error");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = model.mode === "register" ? "创建中…" : "登录中…";
    errorEl.textContent = "";
    try {
      const credentials = {
        username: form.elements.username.value.trim(),
        password: form.elements.password.value,
      };
      if (model.mode === "register") await auth.register(credentials);
      else await auth.login(credentials);
      const returnHash = auth.consumeReturnHash?.();
      navigate(returnHash || "#/");
    } catch (error) {
      const retryAfter = isRateLimitError(error);
      errorEl.textContent = retryAfter ? `${errorMessage(error)}（约 ${retryAfter} 秒）` : errorMessage(error);
    } finally {
      submit.disabled = false;
      submit.textContent = model.submitLabel;
    }
  });
  if (focus) appEl.querySelector("h1")?.focus?.();
  return model;
}

