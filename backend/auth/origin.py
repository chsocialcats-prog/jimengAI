"""Exact same-origin checks and opt-in forwarded-client extraction."""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit


def normalize_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return None
        if parsed.path not in {"", "/"}:
            return None
        port = parsed.port
        default = 80 if parsed.scheme == "http" else 443
        host = parsed.hostname.lower()
        return f"{parsed.scheme}://{host}" if port in (None, default) else f"{parsed.scheme}://{host}:{port}"
    except (TypeError, ValueError):
        return None


class OriginPolicy:
    def __init__(self, public_origin: str | None):
        self.public_origin = normalize_origin(public_origin) if public_origin else None

    def is_allowed(self, *, method: str, origin: str | None, referer: str | None, sec_fetch_site: str | None) -> bool:
        if method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
            return True
        if sec_fetch_site and sec_fetch_site.lower() == "cross-site":
            return False
        supplied = normalize_origin(origin) if origin is not None else self._referer_origin(referer)
        return self.public_origin is not None and supplied == self.public_origin

    @staticmethod
    def _referer_origin(referer: str | None) -> str | None:
        if not referer:
            return None
        try:
            parsed = urlsplit(referer)
            if parsed.username or parsed.password or parsed.query or parsed.fragment:
                return None
            port = parsed.port
            default = 80 if parsed.scheme == "http" else 443
            host = parsed.hostname.lower() if parsed.hostname else None
            return f"{parsed.scheme}://{host}" if host and port in (None, default) else (f"{parsed.scheme}://{host}:{port}" if host else None)
        except ValueError:
            return None

    @staticmethod
    def client_ip(source_ip: str, headers: dict[str, str], trusted_proxy_cidrs=()) -> str:
        try:
            trusted = any(ipaddress.ip_address(source_ip) in ipaddress.ip_network(cidr) for cidr in trusted_proxy_cidrs)
        except ValueError:
            trusted = False
        if trusted:
            forwarded = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
            if forwarded:
                return forwarded.split(",", 1)[0].strip()
        return source_ip
