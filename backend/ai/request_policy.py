"""Strict egress policy for user-selected OpenAI-compatible endpoints."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit


# Some managed Windows/network environments intercept public HTTPS destinations
# through the RFC 2544 benchmarking range. The origin has already passed the
# explicit provider allowlist before this exception is considered, so this does
# not make arbitrary private targets reachable through the model endpoint.
_MANAGED_EGRESS_NETWORK = ipaddress.ip_network("198.18.0.0/15")


class AIRequestPolicyError(ValueError):
    code = "ai_origin_not_allowed"
    message = "AI Base URL 不符合出站安全策略"


@dataclass(frozen=True)
class ApprovedAIURL:
    base_url: str
    origin: str


class AIRequestPolicy:
    def __init__(self, *, allowed_origins, https_only=False, resolver=None, allowed_private_networks=(), allowed_private_origins=()):
        self.allowed_origins = frozenset(self._origin(value) for value in allowed_origins)
        if None in self.allowed_origins or not self.allowed_origins:
            raise ValueError("invalid allowed AI origin")
        self.https_only = https_only
        self.resolver = resolver or self._resolve
        self.allowed_private_networks = tuple(ipaddress.ip_network(value) for value in allowed_private_networks)
        self.allowed_private_origins = frozenset(self._origin(value) for value in allowed_private_origins)

    def validate_base_url(self, value: str) -> ApprovedAIURL:
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError
            if self.https_only and parsed.scheme != "https":
                raise ValueError
            host = parsed.hostname.encode("idna").decode("ascii").lower()
            port = parsed.port
            default_port = 443 if parsed.scheme == "https" else 80
            authority = host if port in (None, default_port) else f"{host}:{port}"
            origin = self._origin(urlunsplit((parsed.scheme.lower(), authority, "", "", "")))
            if origin not in self.allowed_origins:
                raise ValueError
            for address in self.resolver(host, port or (443 if parsed.scheme == "https" else 80)):
                if not self._address_allowed(address, origin, host):
                    raise ValueError
            path = parsed.path.rstrip("/")
            return ApprovedAIURL(urlunsplit((parsed.scheme.lower(), authority, path, "", "")), origin)
        except (TypeError, ValueError, UnicodeError, socket.gaierror):
            raise AIRequestPolicyError() from None

    def allow_redirect(self, source: ApprovedAIURL, location: str) -> bool:
        return False

    def resolve_connection_address(self, target: ApprovedAIURL) -> str:
        """Resolve an approved origin immediately before its socket opens."""
        try:
            parsed = urlsplit(target.origin)
            host = parsed.hostname
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            if not host or self._origin(target.origin) != target.origin:
                raise ValueError
            addresses = tuple(self.resolver(host, port))
            if not addresses or any(
                not self._address_allowed(address, target.origin, host)
                for address in addresses
            ):
                raise ValueError
            return addresses[0]
        except (TypeError, ValueError, UnicodeError, socket.gaierror):
            raise AIRequestPolicyError() from None

    @staticmethod
    def _resolve(host, port):
        return sorted({item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})

    @staticmethod
    def _origin(value: str) -> str | None:
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
                return None
            host = parsed.hostname.encode("idna").decode("ascii").lower()
            port = parsed.port
            default = 443 if parsed.scheme == "https" else 80
            return f"{parsed.scheme.lower()}://{host}" if port in (None, default) else f"{parsed.scheme.lower()}://{host}:{port}"
        except (TypeError, ValueError, UnicodeError):
            return None

    def _address_allowed(self, value: str, origin: str, host: str) -> bool:
        address = ipaddress.ip_address(value)
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
            return False
        if address in _MANAGED_EGRESS_NETWORK:
            return origin in self.allowed_origins
        if address.is_private:
            if any(address in network for network in self.allowed_private_networks):
                return True
            try:
                return ipaddress.ip_address(host) == address and origin in self.allowed_private_origins
            except ValueError:
                return False
        return True
