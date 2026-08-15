# -*- coding: utf-8 -*-
"""Authenticated, per-user AI settings endpoints."""

import os

from fastapi import APIRouter, Depends, HTTPException, Request

from ..ai.deepseek_client import DeepSeekError, discover_models
from ..ai.request_policy import AIRequestPolicy, AIRequestPolicyError
from ..api_models.settings import (
    ModelDiscoveryPreview,
    ProviderSettingsCreate,
    ProviderSettingsUpdate,
    UserAISettingsUpdate,
)
from ..auth.dependencies import require_user
from ..auth.errors import SecretKeyUnavailable
from ..config import load_config
from ..database import connect
from ..repository.user_ai_settings import UserAISettingsRepository
from ..services.user_ai_settings import UserAISettingsService


def _private_allowlist(name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.environ.get(name, "").split(",") if item.strip())


def _request_policy(runtime, *, resolver=None) -> AIRequestPolicy:
    return AIRequestPolicy(
        allowed_origins=runtime.ai_allowed_origins,
        https_only=runtime.ai_https_only,
        resolver=resolver,
        allowed_private_networks=_private_allowlist("NEKO_AI_ALLOWED_PRIVATE_NETWORKS"),
        allowed_private_origins=_private_allowlist("NEKO_AI_ALLOWED_PRIVATE_ORIGINS"),
    )

router = APIRouter(prefix="/api", tags=["配置"])


def _service(request: Request) -> UserAISettingsService:
    service = getattr(request.app.state, "user_ai_settings_service", None)
    if service is not None:
        return service
    runtime = request.app.state.runtime_settings
    policy = _request_policy(runtime)
    return UserAISettingsService(
        UserAISettingsRepository(connect),
        request.app.state.auth_service.keyring,
        app_config={"app": load_config()["app"]},
        request_policy=policy,
    )


def _raise_settings_error(exc: Exception):
    if isinstance(exc, AIRequestPolicyError):
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message}) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(exc)}) from exc
    if isinstance(exc, SecretKeyUnavailable):
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message}) from exc
    raise exc


@router.get("/config", summary="读取个人 AI 设置")
def read_config(request: Request, user=Depends(require_user)):
    return _service(request).public_for_user(user.id)


@router.get("/providers/catalog", summary="读取可添加的模型提供方")
def read_provider_catalog(request: Request, user=Depends(require_user)):
    return {"items": _service(request).provider_catalog()}


@router.get("/providers", summary="读取当前账户的模型提供方")
def read_providers(request: Request, user=Depends(require_user)):
    return {"items": _service(request).list_providers_for_user(user.id)}


@router.post("/providers", summary="添加模型提供方")
def create_provider(payload: ProviderSettingsCreate, request: Request, user=Depends(require_user)):
    try:
        return _service(request).create_provider(
            user.id, payload.model_dump(exclude_none=True)
        )
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)


@router.put("/providers/{provider_id}", summary="更新模型提供方")
def update_provider(
    provider_id: str,
    payload: ProviderSettingsUpdate,
    request: Request,
    user=Depends(require_user),
):
    try:
        return _service(request).update_provider(
            user.id, provider_id, payload.model_dump(exclude_unset=True, exclude_none=True)
        )
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)


@router.post("/providers/{provider_id}/activate", summary="启用模型提供方")
def activate_provider(provider_id: str, request: Request, user=Depends(require_user)):
    try:
        return _service(request).activate_provider(user.id, provider_id)
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)


@router.delete("/providers/{provider_id}", summary="删除模型提供方")
def delete_provider(provider_id: str, request: Request, user=Depends(require_user)):
    try:
        _service(request).delete_provider(user.id, provider_id)
        return None
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)


@router.get("/models", summary="读取可用模型")
def read_models(request: Request, user=Depends(require_user)):
    service = _service(request)
    config = service.resolve_for_user(user.id)
    if config.api_key_unreadable:
        raise HTTPException(status_code=503, detail={"code": "api_key_unreadable", "message": "已保存的 API Key 无法读取"})
    try:
        return discover_models(config, service.request_policy)
    except AIRequestPolicyError as exc:
        _raise_settings_error(exc)
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail={"code": "api_error", "message": str(exc)}) from exc


@router.post("/models/preview", summary="测试未保存的模型连接")
def preview_models(payload: ModelDiscoveryPreview, request: Request, user=Depends(require_user)):
    service = _service(request)
    try:
        return discover_models(
            service.preview_config(user.id, payload.model_dump(exclude_none=True)),
            service.request_policy,
        )
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail={"code": "api_error", "message": str(exc)}) from exc


@router.put("/config", summary="保存个人 AI 设置")
def write_config(payload: UserAISettingsUpdate, request: Request, user=Depends(require_user)):
    try:
        return _service(request).update_for_user(
            user.id,
            payload.model_dump(exclude_unset=True, exclude_none=True),
        )
    except (AIRequestPolicyError, ValueError, SecretKeyUnavailable) as exc:
        _raise_settings_error(exc)
