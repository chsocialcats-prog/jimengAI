import { icon } from "./icons.js";
import { esc } from "./core/format.mjs";

export const ACCOUNT_POPOVERS = Object.freeze({
  notifications: "account-notifications-popover",
  account: "account-menu-popover",
});

export function getAvatarInitial(username, fallback = "N") {
  return Array.from(String(username ?? "").trim())[0] || fallback;
}

export function buildAccountControlsModel(snapshot = {}) {
  if (snapshot.status === "authenticated" && snapshot.user) {
    const username = String(snapshot.user.username ?? "").trim() || "冒险者";
    return {
      status: "authenticated",
      username,
      avatarInitial: getAvatarInitial(snapshot.user.username),
    };
  }
  if (snapshot.status === "unavailable") return { status: "unavailable" };
  return { status: "anonymous" };
}

export function accountControlsMarkup(snapshot = {}) {
  const model = buildAccountControlsModel(snapshot);
  if (model.status === "anonymous") {
    return `
      <nav class="account-auth-links" data-account-state="anonymous" aria-label="账号">
        <a href="#/login">登录</a>
        <span class="account-auth-separator" aria-hidden="true">/</span>
        <a href="#/register">注册</a>
      </nav>
    `;
  }
  if (model.status === "unavailable") {
    return '<span class="account-unavailable" data-account-state="unavailable" role="status" title="认证服务暂时不可用">账号不可用</span>';
  }

  const username = esc(model.username);
  return `
    <div class="account-control-group" data-account-state="authenticated">
      <div class="account-control-anchor">
        <button class="icon-btn account-notification-trigger" type="button" data-account-trigger="notifications" aria-label="打开通知" aria-expanded="false" aria-controls="${ACCOUNT_POPOVERS.notifications}" aria-haspopup="dialog">
          ${icon("bell")}
        </button>
        <section class="account-popover account-notification-popover" id="${ACCOUNT_POPOVERS.notifications}" data-account-popover="notifications" role="dialog" aria-label="通知" hidden>
          <header class="account-popover-header"><h2>通知</h2></header>
          <div class="account-empty-state">
            ${icon("bell")}
            <p>暂无通知</p>
          </div>
        </section>
      </div>
      <div class="account-control-anchor">
        <button class="account-avatar-trigger" type="button" data-account-trigger="account" aria-label="打开 ${username} 的账号菜单" aria-expanded="false" aria-controls="${ACCOUNT_POPOVERS.account}" aria-haspopup="dialog">
          <span class="account-avatar-initial" aria-hidden="true">${esc(model.avatarInitial)}</span>
          <span class="account-avatar-chevron" aria-hidden="true">${icon("chevron-down")}</span>
        </button>
        <section class="account-popover account-menu-popover" id="${ACCOUNT_POPOVERS.account}" data-account-popover="account" role="dialog" aria-label="账号菜单" hidden>
          <header class="account-menu-identity">
            <span class="account-menu-avatar" aria-hidden="true">${esc(model.avatarInitial)}</span>
            <span><small>当前账号</small><strong>${username}</strong></span>
          </header>
          <nav class="account-menu-links" aria-label="账号设置">
            <a class="account-menu-item" href="#/settings/api">${icon("key")}<span>API 设置</span></a>
            <a class="account-menu-item" href="#/settings/profile">${icon("user")}<span>个人资料</span></a>
          </nav>
          <button class="account-menu-item account-logout" type="button" data-account-logout>${icon("log-out")}<span>退出登录</span></button>
        </section>
      </div>
    </div>
  `;
}

export function createAccountControls({
  root,
  auth,
  onLogoutError = () => {},
  documentRef = null,
} = {}) {
  if (!root) throw new TypeError("root is required");
  if (!auth) throw new TypeError("auth is required");

  const ownerDocument = documentRef || root.ownerDocument || globalThis.document;
  let activeTrigger = null;
  let unsubscribe = null;

  function closeAll({ restoreFocus = true } = {}) {
    let closed = false;
    root.querySelectorAll("[data-account-trigger]").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
    root.querySelectorAll("[data-account-popover]").forEach((popover) => {
      if (!popover.hidden) closed = true;
      popover.hidden = true;
      popover.classList.remove("is-open");
    });
    const triggerToRestore = activeTrigger;
    activeTrigger = null;
    if (closed && restoreFocus && typeof triggerToRestore?.focus === "function") {
      triggerToRestore.focus();
    }
    return closed;
  }

  function openPopover(trigger) {
    const name = trigger?.dataset?.accountTrigger;
    const popover = name ? root.querySelector(`[data-account-popover="${name}"]`) : null;
    if (!popover) return false;
    closeAll({ restoreFocus: false });
    popover.hidden = false;
    popover.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    activeTrigger = trigger;
    return true;
  }

  function togglePopover(trigger) {
    const expanded = trigger.getAttribute("aria-expanded") === "true";
    if (expanded) return closeAll();
    return openPopover(trigger);
  }

  function handleRouteChange() {
    closeAll({ restoreFocus: false });
  }

  async function handleLogout(button) {
    button.disabled = true;
    closeAll();
    try {
      await auth.logout();
    } catch (error) {
      button.disabled = false;
      onLogoutError(error);
    }
  }

  function onRootClick(event) {
    const target = event.target?.closest?.("[data-account-trigger], [data-account-logout], a[href^='#/']");
    if (!target || !root.contains(target)) return;
    if (target.matches("[data-account-trigger]")) {
      event.preventDefault();
      togglePopover(target);
      return;
    }
    if (target.matches("[data-account-logout]")) {
      event.preventDefault();
      void handleLogout(target);
      return;
    }
    closeAll({ restoreFocus: false });
  }

  function onDocumentPointerDown(event) {
    if (activeTrigger && !root.contains(event.target)) closeAll();
  }

  function onDocumentKeyDown(event) {
    if (event.key !== "Escape" || !activeTrigger) return;
    event.preventDefault();
    closeAll();
  }

  function render(snapshot = auth.getSnapshot?.() || {}) {
    closeAll({ restoreFocus: false });
    root.innerHTML = accountControlsMarkup(snapshot);
    return buildAccountControlsModel(snapshot);
  }

  function destroy() {
    closeAll({ restoreFocus: false });
    unsubscribe?.();
    root.removeEventListener("click", onRootClick);
    ownerDocument?.removeEventListener("pointerdown", onDocumentPointerDown, true);
    ownerDocument?.removeEventListener("keydown", onDocumentKeyDown);
  }

  root.addEventListener("click", onRootClick);
  ownerDocument?.addEventListener("pointerdown", onDocumentPointerDown, true);
  ownerDocument?.addEventListener("keydown", onDocumentKeyDown);
  unsubscribe = auth.subscribe?.(render) || null;
  if (!unsubscribe) render();

  return {
    render,
    closeAll,
    handleRouteChange,
    destroy,
  };
}
