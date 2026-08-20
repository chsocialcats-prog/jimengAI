"""Account API routes."""

from fastapi import APIRouter, HTTPException, Request, Response

from ..api_models.auth import CredentialsRequest, PasswordChangeRequest, ProfileUpdateRequest
from ..auth.account_migration import MigrationPending
from ..auth.cookies import CSRF_COOKIE_NAME, apply_auth_cookies, clear_auth_cookies, set_no_store
from ..auth.csrf import issue_csrf_token
from ..auth.dependencies import optional_auth, require_auth
from ..auth.errors import AuthValidationError, SecretKeyUnavailable
from ..auth.origin import OriginPolicy
from ..auth.service import InvalidCredentials, UsernameTaken

router = APIRouter(prefix="/api/auth", tags=["认证"])


def _public_user(user):
    return {
        "id": user.id,
        "username": user.username,
        "created_at": user.created_at,
        "avatar_url": user.avatar_url,
        "role": user.role,
    }


def _csrf(request, session_id=None):
    keyring = request.app.state.auth_service.keyring
    if keyring is None:
        raise SecretKeyUnavailable()
    return issue_csrf_token(keyring.csrf_signing_keys(), session_id=session_id)


def _apply_login(response, request, issued):
    token = _csrf(request, issued.session_id)
    apply_auth_cookies(response, issued, token, secure=request.app.state.runtime_settings.cookie_secure)
    return token


def _client_ip(request):
    source = request.client.host if request.client else "unknown"
    return OriginPolicy.client_ip(source, dict(request.headers), request.app.state.runtime_settings.trusted_proxy_cidrs)


@router.get("/csrf")
def csrf(request: Request, response: Response):
    auth = optional_auth(request)
    try:
        token = _csrf(request, auth.session_id if auth else None)
    except SecretKeyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    response.set_cookie(CSRF_COOKIE_NAME, token, httponly=False, samesite="lax", secure=request.app.state.runtime_settings.cookie_secure, path="/")
    set_no_store(response)
    return {"csrf_token": token}


@router.get("/me")
def me(request: Request):
    auth = optional_auth(request)
    pending = request.app.state.auth_service.migration_state() == "unclaimed"
    return {"authenticated": auth is not None, "user": _public_user(auth.user) if auth else None, "legacy_claim_pending": pending}


@router.post("/register", status_code=201)
def register(payload: CredentialsRequest, request: Request, response: Response):
    try:
        result, limit = request.app.state.auth_service.register(payload.username, payload.password, _client_ip(request))
        if limit is not None:
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "请求过于频繁"}, headers={"Retry-After": str(limit.retry_after)})
        claim, issued = result
    except UsernameTaken as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message}) from exc
    except MigrationPending as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message}) from exc
    except SecretKeyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    _apply_login(response, request, issued)
    return {"authenticated": True, "user": _public_user(claim.user), "legacy_data_claimed": claim.legacy_data_claimed}


@router.post("/login")
def login(payload: CredentialsRequest, request: Request, response: Response):
    try:
        result, limit = request.app.state.auth_service.login(payload.username, payload.password, _client_ip(request))
        if limit is not None:
            raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "请求过于频繁"}, headers={"Retry-After": str(limit.retry_after)})
        user, issued = result
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail={"code": exc.code, "message": exc.message}) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message}) from exc
    except SecretKeyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    _apply_login(response, request, issued)
    return {"authenticated": True, "user": _public_user(user)}


@router.put("/password")
def password(payload: PasswordChangeRequest, request: Request, response: Response):
    auth = require_auth(request)
    try:
        issued = request.app.state.auth_service.change_password(auth, payload.current_password, payload.new_password)
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail={"code": exc.code, "message": exc.message}) from exc
    except AuthValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message}) from exc
    except SecretKeyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    token = _apply_login(response, request, issued)
    return {"authenticated": True, "user": _public_user(auth.user), "csrf_token": token}


@router.put("/profile")
def update_profile(payload: ProfileUpdateRequest, request: Request):
    auth = require_auth(request)
    user = request.app.state.auth_service.update_avatar(auth, payload.avatar_url)
    return {"authenticated": True, "user": _public_user(user)}


@router.post("/logout", status_code=204)
def logout(request: Request):
    request.app.state.auth_service.logout(request.cookies.get("neko_session"))
    response = Response(status_code=204)
    clear_auth_cookies(response, secure=request.app.state.runtime_settings.cookie_secure)
    return response
