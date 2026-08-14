"""Safe, stable errors for authentication primitives."""

from __future__ import annotations


class AuthError(Exception):
    code = "authentication_failed"
    message = "认证失败"

    def __str__(self) -> str:
        return self.message


class AuthValidationError(AuthError):
    code = "validation_error"
    message = "输入不符合要求"


class SecretKeyUnavailable(AuthError):
    code = "secret_key_unavailable"
    message = "加密主密钥不可用"


class SecretDecryptionError(AuthError):
    code = "api_key_unreadable"
    message = "加密内容无法读取"
