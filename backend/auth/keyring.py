"""Fernet master-key loading, rotation, and CSRF-key derivation."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .errors import SecretDecryptionError, SecretKeyUnavailable

_CSRF_INFO = b"neko-auth/csrf-signing-key/v1"


class AuthKeyring:
    def __init__(self, keys: list[bytes]):
        try:
            self._fernets = [Fernet(key) for key in keys]
        except (TypeError, ValueError) as exc:
            raise SecretKeyUnavailable() from exc
        if not self._fernets:
            raise SecretKeyUnavailable()
        self._keys = tuple(keys)
        self._multi = MultiFernet(self._fernets)

    @classmethod
    def load(cls, key_path: Path | None = None) -> "AuthKeyring":
        configured = os.environ.get("NEKO_AUTH_KEYS")
        if configured is not None:
            try:
                keys = [part.strip().encode("ascii") for part in configured.split(",") if part.strip()]
            except UnicodeEncodeError as exc:
                raise SecretKeyUnavailable() from exc
            if not keys:
                raise SecretKeyUnavailable()
            return cls(keys)
        if key_path is None:
            from backend.config import AUTH_KEY_PATH
            key_path = AUTH_KEY_PATH
        path = Path(key_path)
        if not path.exists():
            cls._initialize_local_file(path)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("version") != 1 or not isinstance(payload.get("keys"), list):
                raise ValueError("invalid key file")
            keys = [value.encode("ascii") for value in payload["keys"] if isinstance(value, str)]
            if len(keys) != len(payload["keys"]) or not keys:
                raise ValueError("invalid key list")
            return cls(keys)
        except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
            raise SecretKeyUnavailable() from exc

    @staticmethod
    def _initialize_local_file(path: Path) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps({"version": 1, "keys": [Fernet.generate_key().decode("ascii")]}, separators=(",", ":"))
            descriptor, temporary_name = tempfile.mkstemp(prefix=".auth_keys-", suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as file:
                    file.write(payload)
                    file.flush()
                    os.fsync(file.fileno())
                os.chmod(temporary_name, 0o600)
                try:
                    os.link(temporary_name, path)
                except FileExistsError:
                    return
            finally:
                if os.path.exists(temporary_name):
                    os.unlink(temporary_name)
        except OSError as exc:
            raise SecretKeyUnavailable() from exc

    def encrypt(self, plaintext: str) -> str:
        if not isinstance(plaintext, str):
            raise TypeError("plaintext must be text")
        return self._fernets[0].encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._multi.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeError, ValueError) as exc:
            raise SecretDecryptionError() from exc

    def rotate(self, ciphertext: str) -> str:
        try:
            return self._multi.rotate(ciphertext.encode("ascii")).decode("ascii")
        except (InvalidToken, UnicodeError, ValueError) as exc:
            raise SecretDecryptionError() from exc

    def csrf_signing_keys(self) -> tuple[bytes, ...]:
        return tuple(
            HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_CSRF_INFO).derive(key)
            for key in self._keys
        )
