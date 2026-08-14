"""Per-account AI configuration resolution and secret handling."""

from __future__ import annotations

import copy
from dataclasses import dataclass

from backend.auth.errors import SecretDecryptionError, SecretKeyUnavailable
from backend.config import DEFAULT_CONFIG, normalize_generation_config


@dataclass(frozen=True)
class EffectiveAIConfig:
    base_url: str
    model: str
    api_key: str
    generation: dict
    timeout_seconds: float
    ai_enabled: bool
    api_key_unreadable: bool = False


class UserAISettingsService:
    def __init__(self, repository, keyring, *, app_config=None, request_policy=None):
        self.repository = repository
        self.keyring = keyring
        self.app_config = copy.deepcopy(app_config or {"app": DEFAULT_CONFIG["app"]})
        self.request_policy = request_policy

    def public_for_user(self, user_id: int) -> dict:
        row = self.repository.get(user_id) or {}
        deepseek, generation = self._configs(row)
        ciphertext = row.get("api_key_ciphertext", "")
        unreadable = bool(ciphertext and self._decrypt_for_user(user_id, ciphertext) is None)
        return {
            "app": copy.deepcopy(self.app_config.get("app", DEFAULT_CONFIG["app"])),
            "deepseek": deepseek,
            "generation": generation,
            "api_key_set": bool(ciphertext),
            "api_key_unreadable": unreadable,
        }

    def resolve_for_user(self, user_id: int) -> EffectiveAIConfig:
        row = self.repository.get(user_id) or {}
        deepseek, generation = self._configs(row)
        ciphertext = row.get("api_key_ciphertext", "")
        api_key = self._decrypt_for_user(user_id, ciphertext) if ciphertext else ""
        unreadable = bool(ciphertext and api_key is None)
        api_key = api_key or ""
        return EffectiveAIConfig(
            base_url=deepseek["base_url"],
            model=deepseek["model"],
            api_key=api_key,
            generation=generation,
            timeout_seconds=float(deepseek["timeout_seconds"]),
            ai_enabled=bool(api_key) and not unreadable,
            api_key_unreadable=unreadable,
        )

    def update_for_user(self, user_id: int, payload: dict) -> dict:
        if "app" in payload:
            raise ValueError("app settings are read-only")
        row = self.repository.get(user_id) or {}
        deepseek, generation = self._configs(row)
        supplied_deepseek = payload.get("deepseek") or {}
        if not isinstance(supplied_deepseek, dict):
            raise ValueError("invalid deepseek settings")
        has_new_key = "api_key" in supplied_deepseek and supplied_deepseek.get("api_key") not in (None, "")
        clear_key = supplied_deepseek.get("clear_api_key") is True
        if has_new_key and clear_key:
            raise ValueError("api_key and clear_api_key cannot be combined")
        for field in ("base_url", "model", "timeout_seconds"):
            if field in supplied_deepseek:
                deepseek[field] = supplied_deepseek[field]
        if self.request_policy is not None:
            deepseek["base_url"] = self.request_policy.validate_base_url(deepseek["base_url"]).base_url
        if not isinstance(deepseek["model"], str) or not deepseek["model"].strip():
            raise ValueError("model is required")
        if not isinstance(deepseek["timeout_seconds"], (int, float)) or isinstance(deepseek["timeout_seconds"], bool) or not 1 <= float(deepseek["timeout_seconds"]) <= 300:
            raise ValueError("timeout_seconds is invalid")
        supplied_generation = payload.get("generation")
        if supplied_generation is not None:
            if not isinstance(supplied_generation, dict):
                raise ValueError("invalid generation settings")
            generation.update(supplied_generation)
        generation = normalize_generation_config(generation)
        ciphertext = row.get("api_key_ciphertext", "")
        if has_new_key:
            if self.keyring is None:
                raise SecretKeyUnavailable()
            ciphertext = self.keyring.encrypt(supplied_deepseek["api_key"])
        elif clear_key:
            ciphertext = ""
        self.repository.save(user_id, deepseek_config=deepseek, generation_config=generation, api_key_ciphertext=ciphertext)
        return self.public_for_user(user_id)

    def preview_config(self, user_id: int, payload: dict) -> EffectiveAIConfig:
        saved = self.resolve_for_user(user_id)
        deepseek = {"base_url": saved.base_url, "model": saved.model, "timeout_seconds": saved.timeout_seconds}
        for field in ("base_url", "model", "timeout_seconds"):
            if field in payload and payload[field] is not None:
                deepseek[field] = payload[field]
        if self.request_policy is not None:
            deepseek["base_url"] = self.request_policy.validate_base_url(deepseek["base_url"]).base_url
        api_key = payload.get("api_key") if payload.get("api_key") not in (None, "") else saved.api_key
        return EffectiveAIConfig(deepseek["base_url"], deepseek["model"], api_key or "", saved.generation, float(deepseek["timeout_seconds"]), bool(api_key), saved.api_key_unreadable and not api_key)

    def _configs(self, row: dict) -> tuple[dict, dict]:
        deepseek = copy.deepcopy(DEFAULT_CONFIG["deepseek"])
        deepseek.pop("api_key", None)
        stored = row.get("deepseek_config") if row else {}
        if isinstance(stored, dict):
            deepseek.update({key: value for key, value in stored.items() if key in {"base_url", "model", "timeout_seconds"}})
        generation = copy.deepcopy(DEFAULT_CONFIG["generation"])
        if isinstance(row.get("generation_config") if row else None, dict):
            generation.update(row["generation_config"])
        return deepseek, normalize_generation_config(generation)

    def _decrypt_for_user(self, user_id: int, ciphertext: str) -> str | None:
        if self.keyring is None:
            return None
        try:
            value = self.keyring.decrypt(ciphertext)
            rotated = self.keyring.rotate(ciphertext)
            if rotated != ciphertext:
                self.repository.replace_ciphertext(user_id, rotated)
            return value
        except (SecretDecryptionError, SecretKeyUnavailable):
            return None
