# -*- coding: utf-8 -*-
"""本地配置读写接口。"""

from fastapi import APIRouter, HTTPException

from ..ai.deepseek_client import DeepSeekError, discover_models
from ..config import load_config, public_config, update_config
from ..schemas import ConfigUpdate, ModelDiscoveryPreview

router = APIRouter(prefix="/api", tags=["配置"])


@router.get("/config", summary="读取本地配置")
def read_config():
    """返回不含明文 API Key 的完整配置。"""
    return public_config()


@router.get("/models", summary="读取可用模型")
def read_models():
    """Return the models advertised by the configured DeepSeek endpoint."""
    try:
        return discover_models(load_config())
    except DeepSeekError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "api_error", "message": str(exc)},
        ) from exc


@router.post("/models/preview", summary="测试未保存的模型连接")
def preview_models(payload: ModelDiscoveryPreview):
    """使用当前请求中的连接参数获取模型，不修改 config.json。"""
    config = load_config()
    config["deepseek"].update(payload.model_dump())
    try:
        return discover_models(config)
    except DeepSeekError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "api_error", "message": str(exc)},
        ) from exc


@router.put("/config", summary="保存本地配置")
def write_config(payload: ConfigUpdate):
    """局部覆盖并写回 config.json，API Key 可为空字符串表示清除。"""
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    try:
        return update_config(data)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "config_error", "message": str(exc)},
        ) from exc
