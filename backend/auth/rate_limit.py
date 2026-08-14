"""Single-process sliding-window limits for auth endpoints."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from time import monotonic

from .passwords import normalize_username


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    retry_after: int = 0
    code: str | None = None


class AuthRateLimiter:
    def __init__(self, clock=monotonic):
        self.clock = clock
        self._login_username = defaultdict(deque)
        self._login_ip = defaultdict(deque)
        self._registrations = defaultdict(deque)

    @staticmethod
    def _record(bucket, now: float, limit: int, window: float) -> RateLimitResult:
        while bucket and bucket[0] <= now - window:
            bucket.popleft()
        if len(bucket) >= limit:
            return RateLimitResult(False, max(1, int(bucket[0] + window - now + 0.999)), "rate_limited")
        bucket.append(now)
        return RateLimitResult(True)

    def record_login_failure(self, ip: str, username: str) -> RateLimitResult:
        now = self.clock()
        try:
            _, key = normalize_username(username)
        except Exception:
            key = str(username).casefold()
        user_result = self._record(self._login_username[(ip, key)], now, 5, 900)
        ip_result = self._record(self._login_ip[ip], now, 30, 900)
        if not user_result.allowed or not ip_result.allowed:
            return RateLimitResult(False, max(user_result.retry_after, ip_result.retry_after), "rate_limited")
        return RateLimitResult(True)

    def record_login_success(self, ip: str, username: str) -> None:
        try:
            _, key = normalize_username(username)
        except Exception:
            key = str(username).casefold()
        self._login_username.pop((ip, key), None)

    def record_registration_attempt(self, ip: str) -> RateLimitResult:
        return self._record(self._registrations[ip], self.clock(), 5, 3600)
