"""Built-in OpenAI-compatible model-provider presets.

The application sends chat-completions requests, so this catalog deliberately
contains only services that expose an OpenAI-compatible endpoint. Providers
with a different native protocol can still be added once a compatible gateway
is available through the custom-provider flow.
"""

from __future__ import annotations

import copy
from urllib.parse import urlsplit


OPENAI_COMPLETIONS_PROTOCOL = "openai-completions"


BUILTIN_PROVIDERS = (
    {
        "provider_id": "deepseek",
        "display_name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    {
        "provider_id": "openai",
        "display_name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    {
        "provider_id": "kimi",
        "display_name": "Kimi",
        "base_url": "https://api.moonshot.cn/v1",
        "model": "kimi-k2.5",
    },
    {
        "provider_id": "xiaomi",
        "display_name": "小米 MiMo",
        "base_url": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2-flash",
    },
    {
        "provider_id": "qwen",
        "display_name": "通义千问",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
    {
        "provider_id": "glm",
        "display_name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4.7",
    },
    {
        "provider_id": "minimax",
        "display_name": "MiniMax",
        "base_url": "https://api.minimaxi.com/v1",
        "model": "MiniMax-M2.5",
    },
    {
        "provider_id": "siliconflow",
        "display_name": "硅基流动",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V3.2",
    },
    {
        "provider_id": "volcengine",
        "display_name": "火山方舟",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-1-6-251015",
    },
    {
        "provider_id": "openrouter",
        "display_name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openai/gpt-4o-mini",
    },
    {
        "provider_id": "groq",
        "display_name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    {
        "provider_id": "xai",
        "display_name": "xAI",
        "base_url": "https://api.x.ai/v1",
        "model": "grok-3-mini",
    },
    {
        "provider_id": "mistral",
        "display_name": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "model": "mistral-small-latest",
    },
    {
        "provider_id": "together",
        "display_name": "Together AI",
        "base_url": "https://api.together.xyz/v1",
        "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    {
        "provider_id": "fireworks",
        "display_name": "Fireworks AI",
        "base_url": "https://api.fireworks.ai/inference/v1",
        "model": "accounts/fireworks/models/llama-v3p3-70b-instruct",
    },
    {
        "provider_id": "gemini",
        "display_name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.5-flash",
    },
)


def provider_catalog() -> list[dict]:
    """Return frontend-safe copies of the bundled provider defaults."""
    return [
        {
            **copy.deepcopy(item),
            "protocol": OPENAI_COMPLETIONS_PROTOCOL,
            "is_custom": False,
        }
        for item in BUILTIN_PROVIDERS
    ]


def provider_preset(provider_id: str) -> dict | None:
    """Return one bundled provider preset, if its stable route exists."""
    for item in provider_catalog():
        if item["provider_id"] == provider_id:
            return item
    return None


def builtin_provider_origins() -> tuple[str, ...]:
    """Return the exact public origins used by bundled provider presets."""
    origins: list[str] = []
    for provider in BUILTIN_PROVIDERS:
        parsed = urlsplit(provider["base_url"])
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in origins:
            origins.append(origin)
    return tuple(origins)
