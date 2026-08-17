"""SillyTavern V3 character-card and lorebook interchange helpers.

The application deliberately supports a conservative subset at runtime.  The
codec preserves unimplemented V3 fields so imported content can be exported
again without silently discarding authoring metadata.
"""

from __future__ import annotations

import base64
import copy
import json
import struct
import zlib
from collections import defaultdict
from typing import Any


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/"
    "zdrd8QAAAABJRU5ErkJggg=="
)


class SillyTavernFormatError(ValueError):
    """Raised when an uploaded card or lorebook is not a supported format."""


def _as_text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [part.strip() for part in value.replace("，", ",").split(",")]
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _json_object(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SillyTavernFormatError("文件不是有效的 UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise SillyTavernFormatError("SillyTavern 数据必须是 JSON 对象")
    return value


def is_png(data: bytes) -> bool:
    return data.startswith(PNG_SIGNATURE)


def _png_chunks(data: bytes):
    if not is_png(data):
        raise SillyTavernFormatError("PNG 文件签名无效")
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        if offset + 12 > len(data):
            raise SillyTavernFormatError("PNG 文件结构不完整")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_end = offset + 12 + length
        if chunk_end > len(data):
            raise SillyTavernFormatError("PNG 数据块长度无效")
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        yield kind, payload
        offset = chunk_end
        if kind == b"IEND":
            if offset != len(data):
                raise SillyTavernFormatError("PNG 结束块之后存在额外数据")
            return
    raise SillyTavernFormatError("PNG 文件缺少结束块")


def _text_chunk_value(kind: bytes, payload: bytes) -> tuple[str, str] | None:
    try:
        if kind == b"tEXt":
            key, value = payload.split(b"\0", 1)
            return key.decode("latin-1"), value.decode("latin-1")
        if kind == b"zTXt":
            key, remainder = payload.split(b"\0", 1)
            if not remainder or remainder[0] != 0:
                return None
            return key.decode("latin-1"), zlib.decompress(remainder[1:]).decode("utf-8")
        if kind == b"iTXt":
            key, remainder = payload.split(b"\0", 1)
            if len(remainder) < 2:
                return None
            compressed, method = remainder[0], remainder[1]
            language_end = remainder.find(b"\0", 2)
            if language_end < 0:
                return None
            translated_end = remainder.find(b"\0", language_end + 1)
            if translated_end < 0:
                return None
            value = remainder[translated_end + 1 :]
            if compressed:
                if method != 0:
                    return None
                value = zlib.decompress(value)
            return key.decode("latin-1"), value.decode("utf-8")
    except (UnicodeDecodeError, ValueError, zlib.error):
        return None
    return None


def extract_card_document_from_png(data: bytes) -> dict[str, Any]:
    for kind, payload in _png_chunks(data):
        if kind not in {b"tEXt", b"zTXt", b"iTXt"}:
            continue
        decoded = _text_chunk_value(kind, payload)
        if decoded is None or decoded[0] != "chara":
            continue
        try:
            return _json_object(base64.b64decode(decoded[1], validate=False))
        except (ValueError, SillyTavernFormatError) as exc:
            raise SillyTavernFormatError("PNG 中的 chara 元数据无效") from exc
    raise SillyTavernFormatError("PNG 中未找到 SillyTavern chara 元数据")


def read_card_document(data: bytes) -> tuple[dict[str, Any], bytes | None]:
    document = extract_card_document_from_png(data) if is_png(data) else _json_object(data)
    if document.get("spec") != "chara_card_v3" or not isinstance(document.get("data"), dict):
        raise SillyTavernFormatError("仅支持 SillyTavern chara_card_v3 角色卡")
    return document, data if is_png(data) else None


def read_worldbook_document(data: bytes) -> dict[str, Any]:
    """Decode a standalone JSON lorebook without accepting arbitrary file types."""
    if is_png(data):
        raise SillyTavernFormatError("世界书 JSON 不能使用 PNG 格式读取")
    return _json_object(data)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _is_chara_text_chunk(kind: bytes, payload: bytes) -> bool:
    decoded = _text_chunk_value(kind, payload)
    return decoded is not None and decoded[0] == "chara"


def embed_card_document_in_png(png_data: bytes, document: dict[str, Any]) -> bytes:
    # Iteration validates the complete PNG before we preserve its chunks.
    chunks = list(_png_chunks(png_data))
    encoded = base64.b64encode(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    chara_chunk = _chunk(b"tEXt", b"chara\0" + encoded)
    output = bytearray(PNG_SIGNATURE)
    inserted = False
    for kind, payload in chunks:
        if _is_chara_text_chunk(kind, payload):
            continue
        if kind == b"IEND" and not inserted:
            output.extend(chara_chunk)
            inserted = True
        output.extend(_chunk(kind, payload))
    return bytes(output)


def _unsupported_entry_fields(entry: dict[str, Any]) -> list[str]:
    unsupported = []
    fields = {
        "secondary_keys": "二级关键词",
        "selective": "选择性注入",
        "position": "注入位置",
        "use_regex": "正则关键词",
        "extensions": "高级扩展规则",
    }
    for key, label in fields.items():
        value = entry.get(key)
        if value not in (None, "", [], {}, False):
            unsupported.append(label)
    return unsupported


def _normalise_entry(entry: Any, position: int) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise SillyTavernFormatError("世界书条目必须是对象")
    source = copy.deepcopy(entry)
    children = source.pop("children", [])
    if children is None:
        children = []
    if not isinstance(children, list):
        raise SillyTavernFormatError("世界书子条目必须是数组")
    warnings = _unsupported_entry_fields(source)
    title = _as_text(source.get("comment")) or _as_text(source.get("title")) or f"条目 {position + 1}"
    return {
        "title": title,
        "keywords": _as_string_list(source.get("keys") or source.get("keywords")),
        "content": _as_text(source.get("content")),
        "priority": _as_int(source.get("insertion_order"), position),
        "enabled": bool(source.get("enabled", True)),
        "constant": bool(source.get("constant", False)),
        "sort_order": position,
        "interop_data": {
            "format": "sillytavern_worldbook_entry",
            "source": source,
            "unsupported_fields": warnings,
        },
        "children": [_normalise_entry(child, child_index) for child_index, child in enumerate(children)],
    }


def _entries_from_document(document: dict[str, Any]) -> list[Any]:
    entries = document.get("entries", [])
    if isinstance(entries, dict):
        return list(entries.values())
    if isinstance(entries, list):
        return entries
    raise SillyTavernFormatError("世界书缺少 entries 条目列表")


def parse_worldbook_document(document: dict[str, Any], *, fallback_title: str = "导入世界书") -> dict[str, Any]:
    entries = [_normalise_entry(entry, index) for index, entry in enumerate(_entries_from_document(document))]
    warnings = sorted(
        {
            warning
            for entry in entries
            for warning in entry["interop_data"].get("unsupported_fields", [])
        }
    )
    return {
        "title": _as_text(document.get("name")) or _as_text(document.get("title")) or fallback_title,
        "description": _as_text(document.get("description")),
        "interop_data": {
            "format": "sillytavern_worldbook",
            "source": {key: copy.deepcopy(value) for key, value in document.items() if key != "entries"},
            "warnings": warnings,
        },
        "entries": entries,
        "warnings": warnings,
    }


def parse_card_document(document: dict[str, Any]) -> dict[str, Any]:
    if document.get("spec") != "chara_card_v3" or not isinstance(document.get("data"), dict):
        raise SillyTavernFormatError("仅支持 SillyTavern chara_card_v3 角色卡")
    data = document["data"]
    name = _as_text(data.get("name")) or _as_text(document.get("name"))
    if not name.strip():
        raise SillyTavernFormatError("角色卡缺少角色名")
    character_book = data.get("character_book")
    worldbook = None
    if isinstance(character_book, dict) and character_book.get("entries") is not None:
        worldbook = parse_worldbook_document(character_book, fallback_title=f"{name} 世界书")
    tags = _as_string_list(data.get("tags") or document.get("tags"))
    return {
        "card": {
            "name": name.strip(),
            "persona": _as_text(data.get("description")),
            "personality": _as_text(data.get("personality")),
            "speaking_style": "",
            "relationships": {},
            "directives": [],
            "initial_state": {},
            "character_attributes": {},
            "source": "sillytavern-v3",
            "interop_data": {
                "format": "sillytavern_v3",
                "card": copy.deepcopy(document),
            },
        },
        "worldbook": worldbook,
        "work": {
            "title": name.strip(),
            "description": _as_text(data.get("scenario")),
            "opening": _as_text(data.get("first_mes")),
            "tags": tags,
        },
        "warnings": worldbook["warnings"] if worldbook else [],
    }


def _entry_source(entry: dict[str, Any]) -> dict[str, Any]:
    interop = entry.get("interop_data")
    if isinstance(interop, dict) and isinstance(interop.get("source"), dict):
        return copy.deepcopy(interop["source"])
    return {}


def export_worldbook_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    children_by_parent: dict[int | None, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        parent_id = entry.get("parent_entry_id")
        children_by_parent[parent_id if isinstance(parent_id, int) else None].append(entry)
    for group in children_by_parent.values():
        group.sort(key=lambda item: (int(item.get("sort_order") or 0), int(item.get("id") or 0)))

    def build(parent_id: int | None) -> list[dict[str, Any]]:
        result = []
        for index, entry in enumerate(children_by_parent.get(parent_id, [])):
            value = _entry_source(entry)
            value.update(
                {
                    "id": value.get("id", index),
                    "keys": _as_string_list(entry.get("keywords")),
                    "comment": _as_text(entry.get("title")),
                    "content": _as_text(entry.get("content")),
                    "constant": bool(entry.get("constant", False)),
                    "insertion_order": _as_int(entry.get("priority")),
                    "enabled": bool(entry.get("enabled", True)),
                }
            )
            children = build(entry.get("id") if isinstance(entry.get("id"), int) else None)
            if children:
                value["children"] = children
            else:
                value.pop("children", None)
            result.append(value)
        return result

    return build(None)


def export_worldbook_document(worldbook: dict[str, Any]) -> dict[str, Any]:
    interop = worldbook.get("interop_data")
    source = interop.get("source") if isinstance(interop, dict) else None
    document = copy.deepcopy(source) if isinstance(source, dict) else {}
    document["name"] = _as_text(worldbook.get("title"))
    document["description"] = _as_text(worldbook.get("description"))
    document["entries"] = {
        str(index): entry
        for index, entry in enumerate(export_worldbook_entries(worldbook.get("entries") or []))
    }
    return document


def export_card_document(card: dict[str, Any], worldbook: dict[str, Any] | None = None) -> dict[str, Any]:
    interop = card.get("interop_data")
    original = interop.get("card") if isinstance(interop, dict) else None
    document = copy.deepcopy(original) if isinstance(original, dict) else {}
    data = document.get("data")
    if not isinstance(data, dict):
        data = {}
        document["data"] = data
    data["name"] = _as_text(card.get("name"))
    data["description"] = _as_text(card.get("persona"))
    data["personality"] = _as_text(card.get("personality"))
    data.setdefault("scenario", "")
    data.setdefault("first_mes", "")
    data.setdefault("mes_example", "")
    data.setdefault("system_prompt", "")
    data.setdefault("post_history_instructions", "")
    data.setdefault("creator_notes", "")
    data.setdefault("tags", [])
    if worldbook is not None:
        data["character_book"] = {
            "name": _as_text(worldbook.get("title")) or "Character Book",
            "entries": export_worldbook_entries(worldbook.get("entries") or []),
        }
    document["spec"] = "chara_card_v3"
    document["spec_version"] = "3.0"
    document["name"] = data["name"]
    document["description"] = data["description"]
    document["personality"] = data["personality"]
    document["scenario"] = data["scenario"]
    document["first_mes"] = data["first_mes"]
    document["mes_example"] = data["mes_example"]
    document["tags"] = data["tags"]
    return document
