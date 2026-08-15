"""Per-account AI configuration resolution and secret handling."""

from __future__ import annotations

import copy
from dataclasses import dataclass

from backend.auth.errors import SecretDecryptionError, SecretKeyUnavailable
from backend.config import DEFAULT_CONFIG, normalize_generation_config
from backend.services.provider_catalog import (
    OPENAI_COMPLETIONS_PROTOCOL,
    provider_catalog,
    provider_preset,
)


@dataclass(frozen=True)
class EffectiveAIConfig:
    base_url: str
    model: str
    api_key: str
    generation: dict
    timeout_seconds: float
    ai_enabled: bool
    api_key_unreadable: bool = False
    provider_id: str = "deepseek"


class UserAISettingsService:
    def __init__(self, repository, keyring, *, app_config=None, request_policy=None):
        self.repository = repository
        self.keyring = keyring
        self.app_config = copy.deepcopy(app_config or {"app": DEFAULT_CONFIG["app"]})
        self.request_policy = request_policy

    def public_for_user(self, user_id: int) -> dict:
        row = self.repository.get(user_id) or {}
        deepseek, generation = self._configs(row)
        providers = self.list_providers_for_user(user_id, row=row)
        active = next((item for item in providers if item["is_active"]), providers[0])
        return {
            "app": copy.deepcopy(self.app_config.get("app", DEFAULT_CONFIG["app"])),
            # Kept for older frontend versions and the existing account API.
            "deepseek": {
                "base_url": active["base_url"],
                "model": active["model"],
                "timeout_seconds": active["timeout_seconds"],
            },
            "generation": generation,
            "api_key_set": active["api_key_set"],
            "api_key_unreadable": active["api_key_unreadable"],
            "providers": providers,
            "active_provider_id": active["provider_id"],
        }

    def resolve_for_user(self, user_id: int) -> EffectiveAIConfig:
        row = self.repository.get(user_id) or {}
        _, generation = self._configs(row)
        providers = self._provider_rows(user_id, row=row)
        active = next((item for item in providers if item["is_active"]), providers[0])
        ciphertext = active.get("api_key_ciphertext", "")
        api_key = self._decrypt_for_user(user_id, ciphertext, active["provider_id"]) if ciphertext else ""
        unreadable = bool(ciphertext and api_key is None)
        api_key = api_key or ""
        return EffectiveAIConfig(
            base_url=active["base_url"],
            model=active["model"],
            api_key=api_key,
            generation=generation,
            timeout_seconds=float(active["timeout_seconds"]),
            ai_enabled=bool(api_key) and not unreadable,
            api_key_unreadable=unreadable,
            provider_id=active["provider_id"],
        )

    def list_providers_for_user(self, user_id: int, *, row: dict | None = None) -> list[dict]:
        """Return redacted provider rows, including one virtual legacy DeepSeek row."""
        rows = self._provider_rows(user_id, row=row)
        public = []
        for item in rows:
            ciphertext = item.get("api_key_ciphertext", "")
            unreadable = bool(ciphertext and self._decrypt_for_user(user_id, ciphertext, item["provider_id"]) is None)
            public.append({
                "provider_id": item["provider_id"],
                "display_name": item["display_name"],
                "base_url": item["base_url"],
                "protocol": item["protocol"],
                "model": item["model"],
                "models": list(item.get("models", [])),
                "timeout_seconds": item["timeout_seconds"],
                "is_active": bool(item["is_active"]),
                "is_custom": provider_preset(item["provider_id"]) is None,
                "removable": item["provider_id"] != "deepseek",
                "api_key_set": bool(ciphertext),
                "api_key_unreadable": unreadable,
            })
        return public

    def provider_catalog(self) -> list[dict]:
        return provider_catalog()

    def create_provider(self, user_id: int, payload: dict) -> dict:
        provider_id = payload["provider_id"]
        existing = self._provider_rows(user_id)
        if any(item["provider_id"] == provider_id for item in existing):
            raise ValueError("该提供方已存在")
        self._materialize_legacy_provider(user_id)
        key = payload.get("api_key") or ""
        ciphertext = self._encrypt_key(key) if key else ""
        provider = {
            "provider_id": provider_id,
            "display_name": payload["display_name"],
            "base_url": self._validated_base_url(payload["base_url"]),
            "protocol": payload.get("protocol", OPENAI_COMPLETIONS_PROTOCOL),
            "model": payload["model"],
            "models": payload.get("models", []),
            "timeout_seconds": payload.get("timeout_seconds", 60),
            # A newly saved provider becomes the connection used for stories.
            "is_active": True,
            "api_key_ciphertext": ciphertext,
        }
        self.repository.save_provider(user_id, provider)
        return self._public_provider(user_id, provider)

    def update_provider(self, user_id: int, provider_id: str, payload: dict) -> dict:
        self._materialize_legacy_provider(user_id)
        providers = self.repository.list_providers(user_id)
        current = next((item for item in providers if item["provider_id"] == provider_id), None)
        if current is None:
            raise ValueError("提供方不存在")
        next_provider = dict(current)
        for field in ("display_name", "base_url", "protocol", "model", "models", "timeout_seconds"):
            if field in payload and payload[field] is not None:
                next_provider[field] = payload[field]
        next_provider["base_url"] = self._validated_base_url(next_provider["base_url"])
        if payload.get("api_key") not in (None, ""):
            next_provider["api_key_ciphertext"] = self._encrypt_key(payload["api_key"])
        elif payload.get("clear_api_key") is True:
            next_provider["api_key_ciphertext"] = ""
        if payload.get("activate") is not None:
            next_provider["is_active"] = bool(payload["activate"])
        self.repository.save_provider(user_id, next_provider)
        return self._public_provider(user_id, next_provider)

    def delete_provider(self, user_id: int, provider_id: str) -> None:
        if provider_id == "deepseek":
            raise ValueError("DeepSeek 为默认提供方，不能删除")
        self._materialize_legacy_provider(user_id)
        providers = self.repository.list_providers(user_id)
        current = next((item for item in providers if item["provider_id"] == provider_id), None)
        if current is None:
            raise ValueError("提供方不存在")
        was_active = bool(current["is_active"])
        self.repository.delete_provider(user_id, provider_id)
        if was_active:
            remaining = self.repository.list_providers(user_id)
            if remaining:
                fallback = dict(remaining[0])
                fallback["is_active"] = True
                self.repository.save_provider(user_id, fallback)

    def activate_provider(self, user_id: int, provider_id: str) -> dict:
        return self.update_provider(user_id, provider_id, {"activate": True})

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
        # Keep the legacy endpoint and any already-materialized DeepSeek row in
        # lockstep. Older clients can continue to edit `/api/config` safely.
        providers = self.repository.list_providers(user_id)
        legacy_provider = next((item for item in providers if item["provider_id"] == "deepseek"), None)
        if legacy_provider is not None:
            legacy_provider.update({
                "base_url": deepseek["base_url"],
                "model": deepseek["model"],
                "timeout_seconds": deepseek["timeout_seconds"],
                "api_key_ciphertext": ciphertext,
            })
            self.repository.save_provider(user_id, legacy_provider)
        return self.public_for_user(user_id)

    def preview_config(self, user_id: int, payload: dict) -> EffectiveAIConfig:
        provider_id = payload.get("provider_id")
        saved = self.resolve_provider_for_user(user_id, provider_id) if provider_id else self.resolve_for_user(user_id)
        deepseek = {"base_url": saved.base_url, "model": saved.model, "timeout_seconds": saved.timeout_seconds}
        for field in ("base_url", "model", "timeout_seconds"):
            if field in payload and payload[field] is not None:
                deepseek[field] = payload[field]
        if self.request_policy is not None:
            deepseek["base_url"] = self.request_policy.validate_base_url(deepseek["base_url"]).base_url
        api_key = payload.get("api_key") if payload.get("api_key") not in (None, "") else saved.api_key
        return EffectiveAIConfig(
            deepseek["base_url"], deepseek["model"], api_key or "", saved.generation,
            float(deepseek["timeout_seconds"]), bool(api_key),
            saved.api_key_unreadable and not api_key, saved.provider_id,
        )

    def resolve_provider_for_user(self, user_id: int, provider_id: str) -> EffectiveAIConfig:
        row = self.repository.get(user_id) or {}
        _, generation = self._configs(row)
        provider = next(
            (item for item in self._provider_rows(user_id, row=row) if item["provider_id"] == provider_id),
            None,
        )
        if provider is None:
            raise ValueError("提供方不存在")
        ciphertext = provider.get("api_key_ciphertext", "")
        api_key = self._decrypt_for_user(user_id, ciphertext, provider_id) if ciphertext else ""
        unreadable = bool(ciphertext and api_key is None)
        api_key = api_key or ""
        return EffectiveAIConfig(
            provider["base_url"], provider["model"], api_key, generation,
            float(provider["timeout_seconds"]), bool(api_key) and not unreadable, unreadable, provider_id,
        )

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

    def _provider_rows(self, user_id: int, *, row: dict | None = None) -> list[dict]:
        providers = self.repository.list_providers(user_id)
        if providers:
            return providers
        row = row if row is not None else self.repository.get(user_id) or {}
        deepseek, _ = self._configs(row)
        return [{
            "provider_id": "deepseek",
            "display_name": "DeepSeek",
            "base_url": deepseek["base_url"],
            "protocol": OPENAI_COMPLETIONS_PROTOCOL,
            "model": deepseek["model"],
            "models": [],
            "timeout_seconds": deepseek["timeout_seconds"],
            "is_active": True,
            "api_key_ciphertext": row.get("api_key_ciphertext", ""),
        }]

    def _materialize_legacy_provider(self, user_id: int) -> None:
        if self.repository.list_providers(user_id):
            return
        row = self.repository.get(user_id) or {}
        legacy = self._provider_rows(user_id, row=row)[0]
        self.repository.save_provider(user_id, legacy)

    def _public_provider(self, user_id: int, provider: dict) -> dict:
        ciphertext = provider.get("api_key_ciphertext", "")
        return {
            "provider_id": provider["provider_id"],
            "display_name": provider["display_name"],
            "base_url": provider["base_url"],
            "protocol": provider["protocol"],
            "model": provider["model"],
            "models": list(provider.get("models", [])),
            "timeout_seconds": provider["timeout_seconds"],
            "is_active": bool(provider["is_active"]),
            "is_custom": provider_preset(provider["provider_id"]) is None,
            "removable": provider["provider_id"] != "deepseek",
            "api_key_set": bool(ciphertext),
            "api_key_unreadable": bool(ciphertext and self._decrypt_for_user(user_id, ciphertext, provider["provider_id"]) is None),
        }

    def _encrypt_key(self, api_key: str) -> str:
        if self.keyring is None:
            raise SecretKeyUnavailable()
        return self.keyring.encrypt(api_key)

    def _validated_base_url(self, base_url: str) -> str:
        if self.request_policy is None:
            return base_url.rstrip("/")
        return self.request_policy.validate_base_url(base_url).base_url

    def _decrypt_for_user(self, user_id: int, ciphertext: str, provider_id: str | None = None) -> str | None:
        if self.keyring is None:
            return None
        try:
            value = self.keyring.decrypt(ciphertext)
            rotated = self.keyring.rotate(ciphertext)
            if rotated != ciphertext:
                if provider_id is None or provider_id == "deepseek" and not self.repository.list_providers(user_id):
                    self.repository.replace_ciphertext(user_id, rotated)
                else:
                    self.repository.replace_provider_ciphertext(user_id, provider_id, rotated)
            return value
        except (SecretDecryptionError, SecretKeyUnavailable):
            return None
