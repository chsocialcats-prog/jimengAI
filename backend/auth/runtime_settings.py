"""Environment-only runtime security configuration."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from backend.services.provider_catalog import builtin_provider_origins

from .origin import normalize_origin


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    if value.strip().lower() in {"1", "true", "yes", "on"}:
        return True
    if value.strip().lower() in {"0", "false", "no", "off"}:
        return False
    raise ValueError("invalid boolean runtime setting")


@dataclass(frozen=True)
class RuntimeSettings:
    cookie_secure: bool
    public_origin: str | None
    trusted_proxy_cidrs: tuple[str, ...]
    ai_allowed_origins: tuple[str, ...]
    ai_https_only: bool

    @classmethod
    def from_environ(cls, environ=None) -> "RuntimeSettings":
        values = os.environ if environ is None else environ
        secure = _bool(values.get("NEKO_COOKIE_SECURE"), False)
        public_origin = values.get("NEKO_PUBLIC_ORIGIN") or None
        if public_origin and not normalize_origin(public_origin):
            raise ValueError("invalid public origin")
        cidrs = tuple(item.strip() for item in values.get("NEKO_TRUSTED_PROXY_CIDRS", "").split(",") if item.strip())
        for cidr in cidrs:
            ipaddress.ip_network(cidr)
        https_only = _bool(values.get("NEKO_AI_HTTPS_ONLY"), False)
        configured_origins = values.get("NEKO_AI_ALLOWED_ORIGINS")
        origins = (
            tuple(item.strip() for item in configured_origins.split(",") if item.strip())
            if configured_origins
            else builtin_provider_origins()
        )
        normalized = tuple(normalize_origin(item) for item in origins)
        if not normalized or any(item is None for item in normalized) or (https_only and any(not item.startswith("https://") for item in normalized)):
            raise ValueError("invalid AI allowed origins")
        return cls(secure, normalize_origin(public_origin) if public_origin else None, cidrs, normalized, https_only)

    def is_trusted_proxy(self, source_ip: str) -> bool:
        try:
            address = ipaddress.ip_address(source_ip)
            return any(address in ipaddress.ip_network(cidr) for cidr in self.trusted_proxy_cidrs)
        except ValueError:
            return False
