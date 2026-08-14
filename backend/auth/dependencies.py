"""FastAPI request authentication dependency boundary."""

from __future__ import annotations

from fastapi import HTTPException, Request


def optional_auth(request: Request):
    if hasattr(request.state, "auth"):
        return request.state.auth
    token = request.cookies.get("neko_session")
    auth = request.app.state.auth_service.authenticate(token) if token else None
    request.state.auth = auth
    request.state.invalid_session = bool(token and auth is None)
    return auth


def require_auth(request: Request):
    auth = optional_auth(request)
    if auth is None:
        raise HTTPException(status_code=401, detail={"code": "authentication_required", "message": "需要登录"})
    return auth


def optional_user(request: Request):
    auth = optional_auth(request)
    return auth.user if auth else None


def require_user(request: Request):
    return require_auth(request).user


def require_conversation_owner(conversation_id, auth, repository):
    """Injection boundary; Agent E supplies the scoped repository implementation."""
    return repository.require_conversation_owner(conversation_id, auth)
