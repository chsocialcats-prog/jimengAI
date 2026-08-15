# -*- coding: utf-8 -*-
"""DeepSeek OpenAI 兼容流式客户端与无 Key 时的本地模拟客户端。"""

import json
import http.client
import socket
import urllib.error
import urllib.request

from .request_policy import AIRequestPolicyError


class DeepSeekError(Exception):
    """DeepSeek 请求失败时抛出的中文错误。"""


def discover_models(config, request_policy=None):
    """Fetch and normalize the models advertised by an OpenAI-compatible API."""
    deepseek = config.get("deepseek", {}) if isinstance(config, dict) else {}
    api_key = deepseek.get("api_key", "") if isinstance(config, dict) else config.api_key
    if not api_key:
        raise DeepSeekError("DeepSeek API Key 未配置")

    base_url = str(deepseek.get("base_url", "") if isinstance(config, dict) else config.base_url).rstrip("/")
    approved_url = None
    if request_policy is not None:
        approved_url = request_policy.validate_base_url(base_url)
        base_url = approved_url.base_url
    request = urllib.request.Request(
        f"{base_url}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    try:
        timeout = float(
            deepseek.get("timeout_seconds", 60)
            if isinstance(config, dict)
            else config.timeout_seconds
        )
        if request_policy is None:
            response_context = urllib.request.urlopen(request, timeout=timeout)
        else:
            response_context = _open_policy_request(
                request, request_policy, approved_url, timeout
            )
        with response_context as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise DeepSeekError(
                f"API Key 无效或没有读取模型列表的权限（HTTP {exc.code}）"
            ) from exc
        if exc.code == 404:
            raise DeepSeekError("模型列表地址不存在，请检查 API Base URL（HTTP 404）") from exc
        raise DeepSeekError(f"获取模型列表失败（HTTP {exc.code}）") from exc
    except (urllib.error.URLError, TimeoutError, OSError,
            UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeepSeekError("无法获取 DeepSeek 模型列表") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise DeepSeekError("DeepSeek 模型列表响应无效")

    items = []
    for model in data:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str):
            continue
        model_id = model["id"].strip()
        if not model_id:
            continue
        owned_by = model.get("owned_by")
        items.append({
            "id": model_id,
            "owned_by": owned_by if isinstance(owned_by, str) else None,
        })
    return {"items": sorted(items, key=lambda item: item["id"])}


def estimate_tokens(text):
    """按中英文混合粗略估算 Token 数，用于 API 未返回 usage 时兜底。"""
    if not text:
        return 0
    cjk_count = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    other_count = len(text) - cjk_count
    return max(1, round(cjk_count * 1.2 + other_count / 4))


def estimate_messages_tokens(messages):
    """估算一组消息的 Prompt Token 数。"""
    return sum(estimate_tokens(message.get("content", "")) + 4 for message in messages)


def _extract_error_message(body):
    """从 DeepSeek 错误响应中提取可读信息。"""
    try:
        payload = json.loads(body)
        error = payload.get("error")
        if isinstance(error, dict):
            return error.get("message") or str(error)
        return str(error or payload)[:300]
    except (json.JSONDecodeError, AttributeError):
        return (body or "")[:300]


class DeepSeekClient:
    """使用标准库调用 DeepSeek 官方 OpenAI 兼容接口。"""

    def __init__(self, config, request_policy=None):
        if isinstance(config, dict):
            deepseek = config["deepseek"]
            generation = config["generation"]
            self.provider_id = deepseek.get("provider_id", "deepseek")
            self.base_url = deepseek["base_url"].rstrip("/")
            self.model = deepseek["model"]
            self.api_key = deepseek.get("api_key", "")
            self.timeout_seconds = float(deepseek.get("timeout_seconds", 60))
        else:
            self.provider_id = getattr(config, "provider_id", "deepseek")
            self.base_url = config.base_url.rstrip("/")
            self.model = config.model
            self.api_key = config.api_key
            self.timeout_seconds = float(config.timeout_seconds)
            generation = config.generation
        self.request_policy = request_policy
        self.approved_url = None
        if request_policy is not None:
            self.approved_url = request_policy.validate_base_url(self.base_url)
            self.base_url = self.approved_url.base_url
        self.temperature = float(generation.get("temperature", 0.8))
        self.max_tokens = int(generation.get("max_tokens", 2048))
        self.reasoning_effort = generation.get("reasoning_effort", "off")

    def stream_chat(self, messages, max_tokens=None):
        """流式请求 chat completions，逐个产出 delta 和 usage 事件。

        yield 事件格式：
        {"type": "delta", "content": "文本"}
        {"type": "usage", "usage": {"prompt_tokens": ...}}
        {"type": "finish", "finish_reason": "stop"}
        """
        try:
            yield from self._stream_once(
                messages, include_usage=True, max_tokens=max_tokens
            )
            return
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code == 400:
                try:
                    yield from self._stream_once(
                        messages, include_usage=False, max_tokens=max_tokens
                    )
                    return
                except urllib.error.HTTPError as retry_exc:
                    retry_body = retry_exc.read().decode(
                        "utf-8", errors="replace"
                    )
                    raise DeepSeekError(
                        f"DeepSeek 请求失败（HTTP {retry_exc.code}）："
                        f"{_extract_error_message(retry_body)}"
                    ) from retry_exc
            raise DeepSeekError(
                f"DeepSeek 请求失败（HTTP {exc.code}）："
                f"{_extract_error_message(body)}"
            ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise DeepSeekError(f"DeepSeek 网络请求失败：{exc}") from exc

    def _stream_once(self, messages, include_usage, max_tokens=None):
        """发送一次流式请求并解析 SSE 数据。"""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": (
                self.max_tokens if max_tokens is None else int(max_tokens)
            ),
        }
        # `thinking` is DeepSeek's extension to the OpenAI wire format. Other
        # OpenAI-compatible brands commonly reject unknown request fields, so
        # use their portable temperature path unless a provider gets a dedicated
        # adapter in the future.
        if self.provider_id == "deepseek" and self.reasoning_effort in ("high", "max"):
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = self.reasoning_effort
        else:
            payload["temperature"] = self.temperature
        if include_usage:
            payload["stream_options"] = {"include_usage": True}

        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        if self.request_policy is None:
            response_context = urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            )
        else:
            response_context = _open_policy_request(
                request,
                self.request_policy,
                self.approved_url,
                self.timeout_seconds,
            )
        with response_context as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if chunk.get("usage"):
                    yield {"type": "usage", "usage": chunk["usage"]}
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if delta.get("content"):
                    yield {"type": "delta", "content": delta["content"]}
                if choices[0].get("finish_reason"):
                    yield {
                        "type": "finish",
                        "finish_reason": choices[0]["finish_reason"],
                    }


class MockDeepSeekClient:
    """未配置 API Key 时使用的本地模拟流式回复。"""

    def __init__(self, config):
        self.config = config
        self.model = config["deepseek"].get("model", "deepseek-chat")

    def stream_chat(self, messages, max_tokens=None):
        """按本地规则生成模拟回复，并支持结构化状态变化。"""
        content = self._build_reply(messages)
        chunk_size = 10
        for index in range(0, len(content), chunk_size):
            yield {"type": "delta", "content": content[index:index + chunk_size]}
        yield {"type": "finish", "finish_reason": "stop"}

    def _build_reply(self, messages):
        """根据最近一条用户消息生成模拟剧情。"""
        last_user = ""
        for message in reversed(messages):
            if message.get("role") == "user":
                last_user = message.get("content", "")
                break

        reply = "（本地模拟回复）"
        state_delta = {}

        if any(keyword in last_user for keyword in ("钥匙", "推门", "打开门")):
            reply += "你小心地推开门，旧钥匙正躺在门槛旁的石缝里。"
            state_delta["items"] = {"add": ["旧钥匙"]}
            state_delta["logs"] = ["捡到旧钥匙"]
        elif "攻击" in last_user:
            reply += "你挥出武器，对手侧身避开，剑刃擦过墙上的旧痕迹。"
        elif "潜行" in last_user:
            reply += "你贴着墙根放轻脚步，阴影盖住了你的身形。"
        elif any(keyword in last_user for keyword in ("搜索", "翻找")):
            reply += "你翻过角落的杂物，找到几枚落灰的银币。"
            state_delta["money"] = "+10"
            state_delta["logs"] = ["发现银币"]
        else:
            reply += "夜色笼罩着街道，远处的灯火忽明忽暗，你决定继续向前。"

        if "金币" in last_user or "钱" in last_user:
            state_delta["money"] = "+10"
        if "受伤" in last_user:
            state_delta["flags"] = {"add": ["轻伤"]}
        if "任务" in last_user or "委托" in last_user:
            state_delta["quests"] = {
                "add": [{"title": "调查旧宅", "status": "进行中"}]
            }
        if "攻击" in last_user:
            reply += (
                "\n<judge>"
                '{"dice":"1d20","target":12,"attribute":"武力",'
                '"reason":"攻击判定"}'
                "</judge>"
            )
        if state_delta:
            reply += (
                "\n<state_delta>"
                + json.dumps(state_delta, ensure_ascii=False)
                + "</state_delta>"
            )
        return reply


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward bearer credentials across an HTTP redirect."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(request.full_url, code, msg, headers, fp)


class _PolicyConnectionMixin:
    def __init__(self, *args, request_policy, approved_url, **kwargs):
        super().__init__(*args, **kwargs)
        self._request_policy = request_policy
        self._approved_url = approved_url
        self._create_connection = self._create_approved_connection

    def _create_approved_connection(self, address, timeout, source_address=None):
        approved_address = self._request_policy.resolve_connection_address(
            self._approved_url
        )
        return socket.create_connection(
            (approved_address, address[1]), timeout, source_address
        )


def _connection_type(base_class, request_policy, approved_url):
    class PolicyConnection(_PolicyConnectionMixin, base_class):
        def __init__(self, *args, **kwargs):
            super().__init__(
                *args,
                request_policy=request_policy,
                approved_url=approved_url,
                **kwargs,
            )

    return PolicyConnection


class _PolicyHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, request_policy, approved_url):
        super().__init__()
        self._connection_type = _connection_type(
            http.client.HTTPConnection, request_policy, approved_url
        )

    def http_open(self, request):
        return self.do_open(self._connection_type, request)


class _PolicyHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, request_policy, approved_url):
        super().__init__()
        self._connection_type = _connection_type(
            http.client.HTTPSConnection, request_policy, approved_url
        )

    def https_open(self, request):
        return self.do_open(self._connection_type, request, context=self._context)


def _open_policy_request(request, request_policy, approved_url, timeout):
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirect(),
        _PolicyHTTPHandler(request_policy, approved_url),
        _PolicyHTTPSHandler(request_policy, approved_url),
    )
    return opener.open(request, timeout=timeout)


def create_client(config, request_policy=None):
    """按配置自动选择真实客户端或本地模拟客户端。"""
    api_key = config["deepseek"].get("api_key") if isinstance(config, dict) else config.api_key
    if api_key:
        return DeepSeekClient(config, request_policy)
    return MockDeepSeekClient(config)
