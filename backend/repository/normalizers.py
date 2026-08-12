import re
from collections.abc import Mapping


def clean_update_data(data):
    """过滤 None 值，避免接口误把未传字段写成 NULL。"""
    return {key: value for key, value in data.items() if value is not None}


def validate_onboarding(config):
    config = config or {}
    if not isinstance(config, dict):
        raise ValueError("onboarding 必须是对象")
    fields, keys, result = config.get("fields") or [], set(), []
    if not isinstance(fields, list):
        raise ValueError("fields 必须是列表")
    for field in fields:
        key = str(field.get("key", "")).strip() if isinstance(field, dict) else ""
        if not re.fullmatch(r"[A-Za-z0-9_]+", key) or key in keys:
            raise ValueError("field key 必须唯一且仅含字母、数字和下划线")
        field_type = field.get("type", "text")
        if field_type not in ("text", "textarea", "select"):
            raise ValueError("field type 无效")
        options = [str(item).strip() for item in field.get("options", []) if str(item).strip()]
        if field_type == "select" and not options:
            raise ValueError("select field 必须包含 options")
        default = str(field.get("default", ""))
        if field_type == "select" and default and default not in options:
            raise ValueError("select default 必须在 options 中")
        keys.add(key)
        result.append(
            {
                "key": key,
                "label": str(field.get("label", key)).strip() or key,
                "type": field_type,
                "required": bool(field.get("required", False)),
                "placeholder": str(field.get("placeholder", "")),
                "default": default,
                **({"options": options} if field_type == "select" else {}),
            }
        )
    return {
        "enabled": bool(config.get("enabled", False)),
        "intro": str(config.get("intro", "")),
        "allow_freeform": bool(config.get("allow_freeform", False)),
        "fields": result,
    }


def validate_reply_templates(raw):
    """Normalize reply templates into non-empty, uniquely identified mappings."""
    if not isinstance(raw, list):
        return []

    templates = []
    used_ids = set()
    generated_id = 1

    def next_generated_id():
        nonlocal generated_id
        while f"template-{generated_id}" in used_ids:
            generated_id += 1
        template_id = f"template-{generated_id}"
        generated_id += 1
        return template_id

    for item in raw:
        if not isinstance(item, Mapping):
            continue
        template_id = "" if item.get("id") is None else str(item.get("id")).strip()
        name = "" if item.get("name") is None else str(item.get("name")).strip()
        content = "" if item.get("content") is None else str(item.get("content"))
        if not name and not content.strip():
            continue
        if not template_id or template_id in used_ids:
            template_id = next_generated_id()
        used_ids.add(template_id)
        templates.append(
            {"id": template_id, "name": name or "未命名模板", "content": content}
        )
    return templates


def normalize_active_reply_template_id(raw, templates):
    active_id = "" if raw is None else str(raw).strip()
    return active_id if active_id in {item["id"] for item in templates} else ""


def normalize_state(raw=None):
    """把任意初始状态统一成引擎使用的完整状态结构。"""
    raw = raw or {}
    characters = {}
    for name, profile in (raw.get("characters") or {}).items():
        if not isinstance(profile, dict):
            continue
        characters[str(name)] = {
            "attributes": dict(profile.get("attributes") or {}),
            "flags": list(profile.get("flags") or []),
        }
    return {
        "attributes": dict(raw.get("attributes") or {}),
        "items": list(raw.get("items") or []),
        "money": raw.get("money", 0),
        "relations": dict(raw.get("relations") or {}),
        "quests": list(raw.get("quests") or []),
        "flags": list(raw.get("flags") or []),
        "characters": characters,
        "logs": list(raw.get("logs") or []),
    }
