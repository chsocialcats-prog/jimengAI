"""Read legacy config-file values without applying environment overlays."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from backend.config import read_raw_legacy_config

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LegacyConfig:
    deepseek: dict
    generation: dict
    api_key: str
    api_key_source: str | None
    config_file_has_plaintext_key: bool


def load_legacy_config(*, config_path: Path, environ) -> LegacyConfig:
    raw = read_raw_legacy_config(config_path=config_path)
    deepseek = raw.get("deepseek") if isinstance(raw.get("deepseek"), dict) else {}
    generation = raw.get("generation") if isinstance(raw.get("generation"), dict) else {}
    file_key = deepseek.get("api_key")
    if isinstance(file_key, str) and file_key:
        return LegacyConfig(dict(deepseek), dict(generation), file_key, "config_file", True)
    environment_key = environ.get("DEEPSEEK_API_KEY") if environ is not None else None
    if isinstance(environment_key, str) and environment_key:
        return LegacyConfig(dict(deepseek), dict(generation), environment_key, "environment", False)
    return LegacyConfig(dict(deepseek), dict(generation), "", None, False)


def warn_if_environment_legacy_key(*, config_path: Path, environ=None) -> bool:
    """Warn without exposing the value when only the old environment key remains."""
    values = os.environ if environ is None else environ
    raw = read_raw_legacy_config(config_path=config_path)
    deepseek = raw.get("deepseek") if isinstance(raw.get("deepseek"), dict) else {}
    file_key = deepseek.get("api_key")
    environment_key = values.get("DEEPSEEK_API_KEY")
    if not file_key and isinstance(environment_key, str) and environment_key:
        logger.warning("检测到旧的 DEEPSEEK_API_KEY 环境变量；完成迁移后请移除该变量。")
        return True
    return False
