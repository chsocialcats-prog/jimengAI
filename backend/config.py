# -*- coding: utf-8 -*-
"""Local config loading, normalization, and persistence helpers."""

import copy
import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULT_CONFIG = {
    "app": {
        "host": "127.0.0.1",
        "port": 8000,
        "open_browser": True,
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "api_key": "",
        "timeout_seconds": 60,
    },
    "generation": {
        "temperature": 0.8,
        "max_tokens": 2048,
        "reasoning_effort": "off",
        "context_window_tokens": 32768,
        "compression_trigger_ratio": 0.75,
        "compression_keep_recent_messages": 8,
        "compression_summary_max_tokens": 1200,
    },
}


def _deep_merge(base, override):
    """Recursively merge config dictionaries while preserving defaults."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def normalize_generation_config(generation):
    """Normalize context-compression generation settings to approved bounds."""
    normalized = copy.deepcopy(generation) if isinstance(generation, dict) else {}
    defaults = DEFAULT_CONFIG["generation"]
    rules = {
        "context_window_tokens": (2048, 131072, int),
        "compression_trigger_ratio": (0.50, 0.95, (int, float)),
        "compression_keep_recent_messages": (2, 32, int),
        "compression_summary_max_tokens": (256, 4096, int),
    }

    for key, (minimum, maximum, expected_type) in rules.items():
        value = normalized.get(key, defaults[key])
        if isinstance(value, bool) or not isinstance(value, expected_type) or not (minimum <= value <= maximum):
            normalized[key] = defaults[key]
        elif isinstance(defaults[key], float):
            normalized[key] = float(value)
        else:
            normalized[key] = int(value)

    return normalized


def load_config():
    """Read config.json, creating it first from defaults when needed."""
    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG)

    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as file:
            user_config = json.load(file)
    except (json.JSONDecodeError, OSError) as exc:
        raise RuntimeError(f"配置文件读取失败：{CONFIG_PATH}，原因：{exc}") from exc

    config = _deep_merge(DEFAULT_CONFIG, user_config)
    config["generation"] = normalize_generation_config(config.get("generation"))
    config["deepseek"]["api_key"] = os.environ.get(
        "DEEPSEEK_API_KEY",
        config["deepseek"].get("api_key", ""),
    )
    config["deepseek"]["base_url"] = os.environ.get(
        "DEEPSEEK_BASE_URL",
        config["deepseek"].get(
            "base_url",
            DEFAULT_CONFIG["deepseek"]["base_url"],
        ),
    )
    config["deepseek"]["model"] = os.environ.get(
        "DEEPSEEK_MODEL",
        config["deepseek"].get(
            "model",
            DEFAULT_CONFIG["deepseek"]["model"],
        ),
    )
    return config


def save_config(config):
    """Write config back to the local config file."""
    with CONFIG_PATH.open("w", encoding="utf-8") as file:
        json.dump(config, file, ensure_ascii=False, indent=2)
        file.write("\n")


def public_config(config=None):
    """Return config without the raw API key for API/frontend usage."""
    result = _deep_merge(DEFAULT_CONFIG, config if config is not None else load_config())
    result["generation"] = normalize_generation_config(result.get("generation"))
    result["deepseek"]["api_key_set"] = bool(result["deepseek"].get("api_key", ""))
    result["deepseek"].pop("api_key", None)
    return result


def update_config(partial):
    """Merge a partial update into current config and persist it."""
    config = load_config()
    merged = _deep_merge(config, partial)
    merged["generation"] = normalize_generation_config(merged.get("generation"))
    save_config(merged)
    return public_config(merged)


def has_api_key():
    """Check whether a DeepSeek API key is currently configured."""
    return bool(load_config()["deepseek"].get("api_key", ""))
