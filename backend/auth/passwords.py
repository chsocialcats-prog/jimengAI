"""Password and username validation with Argon2id storage helpers."""

from __future__ import annotations

import unicodedata

from pwdlib import PasswordHash

from .errors import AuthValidationError

_PASSWORD_HASHER = PasswordHash.recommended()
_DUMMY_PASSWORD_HASH = _PASSWORD_HASHER.hash("neko-auth-dummy-password")
_RESERVED_USERNAMES = frozenset({"admin", "administrator", "api", "auth", "root", "system"})


def normalize_username(username: str) -> tuple[str, str]:
    """Return NFKC display text and a case-folded uniqueness key."""
    if not isinstance(username, str):
        raise AuthValidationError()
    display = unicodedata.normalize("NFKC", username.strip())
    if not 3 <= len(display) <= 32:
        raise AuthValidationError()
    if any(not (character.isalnum() or character in "_-") for character in display):
        raise AuthValidationError()
    key = display.casefold()
    if key in _RESERVED_USERNAMES:
        raise AuthValidationError()
    return display, key


def validate_password(password: str) -> str:
    """Accept exactly the documented 10--128 Unicode-character password range."""
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise AuthValidationError()
    return password


def hash_password(password: str) -> str:
    return _PASSWORD_HASHER.hash(validate_password(password))


def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(password_hash, str):
        return False
    try:
        return _PASSWORD_HASHER.verify(password, password_hash)
    except (ValueError, TypeError):
        return False


def verify_password_or_dummy(password: str, password_hash: str | None) -> bool:
    """Verify a fixed dummy digest when no account digest is available."""
    return verify_password(password, password_hash or _DUMMY_PASSWORD_HASH) if password_hash else (verify_password(password, _DUMMY_PASSWORD_HASH) and False)
