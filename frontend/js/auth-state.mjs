import {
  RETURN_HASH_STORAGE_KEY,
  isSafeReturnHash,
} from "./core/api-client.mjs";

const INITIAL_SNAPSHOT = Object.freeze({
  status: "anonymous",
  user: null,
  legacyClaimPending: false,
});

function copySnapshot(snapshot) {
  return {
    status: snapshot.status,
    user: snapshot.user ? { ...snapshot.user } : null,
    legacyClaimPending: snapshot.legacyClaimPending === true,
  };
}

function publicUser(response, fallback = null) {
  if (response && typeof response === "object" && response.user && typeof response.user === "object") {
    return { ...response.user };
  }
  return fallback ? { ...fallback } : null;
}

export function createAuthState({
  apiClient,
  sessionStorage = globalThis.sessionStorage,
  initialSnapshot = INITIAL_SNAPSHOT,
  onLogout = () => {},
} = {}) {
  if (!apiClient) throw new TypeError("apiClient is required");
  let snapshot = {
    status: ["anonymous", "authenticated", "unavailable"].includes(initialSnapshot?.status)
      ? initialSnapshot.status
      : "anonymous",
    user: initialSnapshot?.user ? { ...initialSnapshot.user } : null,
    legacyClaimPending: initialSnapshot?.legacyClaimPending === true,
  };
  const listeners = new Set();

  function emit() {
    const next = copySnapshot(snapshot);
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // A view subscriber must not prevent other subscribers from updating.
      }
    }
  }

  function setSnapshot(next) {
    snapshot = {
      status: next.status,
      user: next.user ? { ...next.user } : null,
      legacyClaimPending: next.legacyClaimPending === true,
    };
    emit();
    return copySnapshot(snapshot);
  }

  function applyAuthenticated(response, { pending = false } = {}) {
    return setSnapshot({
      status: "authenticated",
      user: publicUser(response, snapshot.user),
      legacyClaimPending: pending,
    });
  }

  async function bootstrap() {
    try {
      const response = await apiClient.get("/api/auth/me");
      if (response?.authenticated === true && response.user) {
        return applyAuthenticated(response, { pending: response.legacy_claim_pending === true });
      }
      return setSnapshot({ status: "anonymous", user: null, legacyClaimPending: response?.legacy_claim_pending === true });
    } catch {
      return setSnapshot({ status: "unavailable", user: null, legacyClaimPending: false });
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    listeners.add(listener);
    listener(copySnapshot(snapshot));
    return () => listeners.delete(listener);
  }

  async function login(credentials) {
    const response = await apiClient.post("/api/auth/login", credentials);
    return applyAuthenticated(response, { pending: false });
  }

  async function register(credentials) {
    const response = await apiClient.post("/api/auth/register", credentials);
    return applyAuthenticated(response, { pending: false });
  }

  async function logout() {
    await apiClient.post("/api/auth/logout");
    apiClient.clearCsrfToken?.();
    const result = setSnapshot({ status: "anonymous", user: null, legacyClaimPending: false });
    try {
      await onLogout();
    } catch {
      // Cleanup hooks are best effort; the auth state is already anonymous.
    }
    return result;
  }

  async function changePassword(payload) {
    const response = await apiClient.put("/api/auth/password", payload);
    apiClient.clearCsrfToken?.();
    return applyAuthenticated(response, { pending: snapshot.legacyClaimPending });
  }

  function rememberReturnHash(hash) {
    if (!isSafeReturnHash(hash) || !sessionStorage?.setItem) return false;
    try {
      sessionStorage.setItem(RETURN_HASH_STORAGE_KEY, hash);
      return true;
    } catch {
      return false;
    }
  }

  function consumeReturnHash() {
    if (!sessionStorage?.getItem) return null;
    try {
      const hash = sessionStorage.getItem(RETURN_HASH_STORAGE_KEY);
      sessionStorage.removeItem?.(RETURN_HASH_STORAGE_KEY);
      return isSafeReturnHash(hash) ? hash : null;
    } catch {
      return null;
    }
  }

  return {
    bootstrap,
    getSnapshot: () => copySnapshot(snapshot),
    subscribe,
    login,
    register,
    logout,
    changePassword,
    rememberReturnHash,
    consumeReturnHash,
  };
}
