"""Aliyun Model Studio web-image search for role-card artwork."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from .image_uploads import ImageUploadError, MAX_IMAGE_BYTES, image_extension


MAX_RESULTS = 10
MAX_RESPONSE_BYTES = 1_500_000
REQUEST_TIMEOUT_SECONDS = 40
_DEFAULT_REGION = "cn-beijing"
_DEFAULT_MODEL = "qwen3.7-plus"
_WORKSPACE_ID_PATTERN = re.compile(r"[A-Za-z0-9-]{1,128}")
_REGION_PATTERN = re.compile(r"[a-z0-9-]{2,64}")


class ImageSearchError(RuntimeError):
    """Raised when the Model Studio image search request cannot complete."""


class SearchImageFetchError(ValueError):
    """Kept for the legacy crop endpoint's validation contract."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _is_https_url(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 2_000:
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return bool(parsed.scheme == "https" and parsed.hostname and parsed.port is None)


def _search_text(value: str, limit: int) -> str:
    normalized = re.sub(r"[\x00-\x1f]+", " ", value)
    return " ".join(normalized.split())[:limit]


def build_character_query(name: str) -> str:
    """Use the role-card name as the complete public search query."""
    character_name = _search_text(name, 80)
    if not character_name:
        raise ValueError("角色名不能为空")
    return character_name


def _model_studio_config() -> tuple[str, str, str]:
    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    workspace_id = os.environ.get("DASHSCOPE_WORKSPACE_ID", "").strip()
    region = os.environ.get("DASHSCOPE_REGION", _DEFAULT_REGION).strip()
    model = os.environ.get("DASHSCOPE_IMAGE_SEARCH_MODEL", _DEFAULT_MODEL).strip()
    if not api_key or not workspace_id:
        raise ImageSearchError(
            "请先配置 DASHSCOPE_API_KEY 和 DASHSCOPE_WORKSPACE_ID，再使用在线配图"
        )
    if not _WORKSPACE_ID_PATTERN.fullmatch(workspace_id) or not _REGION_PATTERN.fullmatch(region):
        raise ImageSearchError("百炼工作空间或地域配置无效")
    if not model:
        raise ImageSearchError("请配置支持文搜图的百炼模型")
    base_url = f"https://{workspace_id}.{region}.maas.aliyuncs.com/compatible-mode/v1"
    return api_key, base_url, model


def _search_provider(query: str) -> dict[str, Any]:
    api_key, base_url, model = _model_studio_config()
    payload = {
        "model": model,
        "input": (
            f"搜索一张适合用作角色卡头像的清晰人物插画或肖像，角色名为：{query}。"
            "优先与角色名称对应的公开图片；只需调用文搜图工具。"
        ),
        "tools": [{"type": "web_search_image"}],
    }
    request = urllib.request.Request(
        f"{base_url}/responses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "AI-Adventure-RoleCard-ImageSearch/2.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response_body = response.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImageSearchError("百炼在线图片搜索暂不可用，请稍后重试") from exc
    if len(response_body) > MAX_RESPONSE_BYTES:
        raise ImageSearchError("百炼在线图片搜索响应过大，请稍后重试")
    try:
        result = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImageSearchError("百炼在线图片搜索返回了无效数据") from exc
    if not isinstance(result, dict):
        raise ImageSearchError("百炼在线图片搜索返回了无效数据")
    return result


def _image_items(response: dict[str, Any]) -> list[dict[str, str]]:
    output = response.get("output")
    if not isinstance(output, list):
        raise ImageSearchError("百炼未返回图片搜索结果")

    candidates: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "web_search_image_call":
            continue
        raw_images = item.get("output")
        try:
            images = json.loads(raw_images) if isinstance(raw_images, str) else raw_images
        except json.JSONDecodeError:
            continue
        if not isinstance(images, list):
            continue
        for image in images:
            if not isinstance(image, dict):
                continue
            image_url = image.get("url") or image.get("image_url")
            if not _is_https_url(image_url) or image_url in seen_urls:
                continue
            seen_urls.add(image_url)
            parsed_url = urlparse(image_url)
            title = _search_text(str(image.get("title") or parsed_url.hostname), 160)
            candidates.append(
                {
                    "image_url": image_url,
                    "thumbnail_url": image_url,
                    "page_url": image_url,
                    "title": title or parsed_url.hostname or "在线图片",
                    "source": parsed_url.hostname or "",
                }
            )
            if len(candidates) >= MAX_RESULTS:
                return candidates
    return candidates


def search_character_images(name: str) -> dict[str, object]:
    """Return HTTPS role-card artwork candidates from Model Studio's tool output."""
    query = build_character_query(name)
    return {"query": query, "items": _image_items(_search_provider(query))}


def fetch_search_thumbnail(url: str) -> tuple[bytes, str]:
    """Read only legacy Bing thumbnails; Model Studio results are stored as HTTPS URLs."""
    try:
        parsed = urlparse(url)
        allowed = bool(
            parsed.scheme == "https"
            and parsed.port is None
            and parsed.hostname
            and re.fullmatch(r"ts\d+\.mm\.bing\.net", parsed.hostname, flags=re.IGNORECASE)
        )
    except ValueError:
        allowed = False
    if not allowed:
        raise SearchImageFetchError("文搜图结果可直接设为角色头像，无需下载裁剪")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8",
            "User-Agent": "AI-Adventure-RoleCard-ImageEditor/1.0",
        },
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            data = response.read(MAX_IMAGE_BYTES + 1)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImageSearchError("在线图片暂时无法读取，请换一张后重试") from exc
    if len(data) > MAX_IMAGE_BYTES:
        raise SearchImageFetchError("在线图片不能超过 5MB")
    try:
        return data, image_extension(data)
    except ImageUploadError as exc:
        raise SearchImageFetchError("在线候选图片格式不受支持") from exc
