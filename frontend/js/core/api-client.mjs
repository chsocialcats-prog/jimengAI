const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const CSRF_ENDPOINT = "/api/auth/csrf";
export const RETURN_HASH_STORAGE_KEY = "neko.return_hash";

const SAFE_ROUTE_PREFIXES = new Set([
  "",
  "adventure",
  "card",
  "cards",
  "creator",
  "library",
  "login",
  "register",
  "settings",
  "work",
  "works",
  "worldbook",
  "worldbooks",
]);

export class ApiClientError extends Error {
  constructor(message, { code = "api_error", status = 0, details = null, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isStorageLike(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function";
}

function readHash(locationLike) {
  return typeof locationLike?.hash === "string" ? locationLike.hash : "";
}

export function isSafeReturnHash(hash) {
  if (typeof hash !== "string" || hash.length > 2048 || !hash.startsWith("#/")) return false;
  if (hash.includes("//") || hash.includes("\\") || /[\r\n]/.test(hash)) return false;
  if (/%(?:0d|0a)/i.test(hash)) return false;

  let decoded;
  try {
    decoded = decodeURIComponent(hash);
  } catch {
    return false;
  }
  if (/[\r\n]/.test(decoded) || decoded.includes("//") || decoded.includes("://") || decoded.includes("\\")) return false;
  if (/(?:javascript|data|vbscript)\s*:/i.test(decoded)) return false;

  const route = decoded.slice(2).split(/[/?#]/, 1)[0];
  return SAFE_ROUTE_PREFIXES.has(route);
}

function cloneHeaders(headers = {}) {
  const result = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { result[key] = value; });
    return result;
  }
  for (const [key, value] of Object.entries(headers)) result[key] = value;
  return result;
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) || response?.headers?.[name] || "";
}

async function readBody(response) {
  if (response && typeof response.text === "function") {
    const text = await response.text();
    if (!text) return null;
    const contentType = responseHeader(response, "content-type").toLowerCase();
    if (contentType.includes("json") || /^[\[{]/.test(text.trim())) {
      try {
        return JSON.parse(text);
      } catch {
        if (contentType.includes("json")) {
          throw new ApiClientError("服务返回了无效 JSON", { code: "invalid_json", status: response.status });
        }
      }
    }
    return text;
  }
  if (response && typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return response ?? null;
}

function errorPayload(body) {
  if (body && typeof body === "object") {
    if (body.error && typeof body.error === "object") return body.error;
    if (body.detail && typeof body.detail === "object") return body.detail;
  }
  return null;
}

function stableErrorForResponse(body, status) {
  const payload = errorPayload(body);
  if (payload?.code) {
    return new ApiClientError(
      typeof payload.message === "string" ? payload.message : "请求失败",
      { code: String(payload.code), status, details: payload.details ?? null },
    );
  }
  if (typeof body === "string") {
    return new ApiClientError("服务返回了非 JSON 错误", { code: "non_json_error", status });
  }
  return new ApiClientError(`请求失败（HTTP ${status}）`, { code: "http_error", status });
}

function isInstanceOfGlobal(value, name) {
  const Constructor = globalThis[name];
  return typeof Constructor === "function" && value instanceof Constructor;
}

function makeRequestBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === "string" ||
    isInstanceOfGlobal(body, "FormData") ||
    isInstanceOfGlobal(body, "Blob") ||
    isInstanceOfGlobal(body, "URLSearchParams") ||
    isInstanceOfGlobal(body, "ArrayBuffer")
  ) return body;
  headers["Content-Type"] ||= "application/json";
  return JSON.stringify(body);
}

function isAuthEndpoint(path) {
  return typeof path === "string" && path.startsWith("/api/auth/");
}

export function createApiClient({
  fetchImpl = globalThis.fetch,
  baseUrl = "",
  sessionStorage = globalThis.sessionStorage,
  location = globalThis.location,
  onAuthRequired = () => {},
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  let csrfToken = null;

  const rememberReturnHash = () => {
    const hash = readHash(location);
    if (!isSafeReturnHash(hash) || !isStorageLike(sessionStorage)) return null;
    try {
      sessionStorage.setItem(RETURN_HASH_STORAGE_KEY, hash);
      return hash;
    } catch {
      return null;
    }
  };

  const request = async (path, { method = "GET", body, headers = {}, retryAfterCsrf = true } = {}) => {
    const upperMethod = method.toUpperCase();
    const unsafe = UNSAFE_METHODS.has(upperMethod);
    if (unsafe && !csrfToken) await requestCsrf();

    const requestHeaders = cloneHeaders(headers);
    requestHeaders.Accept ||= "application/json";
    if (unsafe) requestHeaders["X-CSRF-Token"] = csrfToken;
    const serializedBody = makeRequestBody(body, requestHeaders);

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: upperMethod,
        credentials: "same-origin",
        headers: requestHeaders,
        body: serializedBody,
      });
    } catch (cause) {
      throw new ApiClientError("无法连接到服务", { code: "network_error", cause });
    }

    let parsedBody;
    try {
      parsedBody = await readBody(response);
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError("无法读取服务响应", { code: "response_error", status: response.status, cause: error });
    }

    if (response.ok) return parsedBody;

    const error = stableErrorForResponse(parsedBody, response.status);
    if (error.code === "csrf_failed" && unsafe && retryAfterCsrf) {
      csrfToken = null;
      await requestCsrf();
      return request(path, { method: upperMethod, body, headers, retryAfterCsrf: false });
    }

    if (response.status === 401 && error.code === "authentication_required") {
      const returnHash = rememberReturnHash();
      try {
        onAuthRequired(returnHash);
      } catch {
        // Navigation callbacks must not replace the API error.
      }
    }
    throw error;
  };

  async function requestCsrf() {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${CSRF_ENDPOINT}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
    } catch (cause) {
      throw new ApiClientError("无法获取安全令牌", { code: "network_error", cause });
    }
    const body = await readBody(response);
    if (!response.ok) throw stableErrorForResponse(body, response.status);
    if (!body || typeof body.csrf_token !== "string" || !body.csrf_token) {
      throw new ApiClientError("服务未返回有效安全令牌", { code: "csrf_unavailable", status: response.status });
    }
    csrfToken = body.csrf_token;
    return csrfToken;
  }

  async function openEventStream(path, { method = "POST", body, headers = {}, retryAfterCsrf = true } = {}) {
    const upperMethod = method.toUpperCase();
    const unsafe = UNSAFE_METHODS.has(upperMethod);
    if (unsafe && !csrfToken) await requestCsrf();
    const requestHeaders = cloneHeaders(headers);
    requestHeaders.Accept ||= "text/event-stream";
    if (unsafe) requestHeaders["X-CSRF-Token"] = csrfToken;
    const serializedBody = makeRequestBody(body, requestHeaders);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: upperMethod,
        credentials: "same-origin",
        headers: requestHeaders,
        body: serializedBody,
      });
    } catch (cause) {
      throw new ApiClientError("无法连接到服务", { code: "network_error", cause });
    }
    if (response.ok && response.body) return response;
    let parsedBody = null;
    try { parsedBody = await readBody(response); } catch (cause) {
      throw new ApiClientError("无法读取服务响应", { code: "response_error", status: response.status, cause });
    }
    const error = stableErrorForResponse(parsedBody, response.status);
    if (error.code === "csrf_failed" && unsafe && retryAfterCsrf) {
      csrfToken = null;
      await requestCsrf();
      return openEventStream(path, { method: upperMethod, body, headers, retryAfterCsrf: false });
    }
    if (response.status === 401 && error.code === "authentication_required") {
      const returnHash = rememberReturnHash();
      try { onAuthRequired(returnHash); } catch {}
    }
    throw error;
  }

  return {
    request,
    get: (path, options = {}) => request(path, { ...options, method: "GET" }),
    post: (path, body, options = {}) => request(path, { ...options, method: "POST", body }),
    put: (path, body, options = {}) => request(path, { ...options, method: "PUT", body }),
    patch: (path, body, options = {}) => request(path, { ...options, method: "PATCH", body }),
    delete: (path, options = {}) => request(path, { ...options, method: "DELETE" }),
    getCsrfToken: () => csrfToken,
    clearCsrfToken: () => { csrfToken = null; },
    refreshCsrfToken: requestCsrf,
    openEventStream,
  };
}
