"""Bounded, account-scoped read-only context for the web assistant."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .. import database
from ..repository import conversation_repository, works, worldbooks


_MAX_ITEMS = 8
_MAX_TEXT = 240
_MAX_CURRENT_TEXT = 900
_ID_PATTERN = re.compile(r"[1-9]\d*")


def _short_text(value: Any, limit: int = _MAX_TEXT) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[:limit - 1]}…"


def _safe_value(value: Any, *, depth: int = 0) -> Any:
    """Keep user-authored material bounded before it enters an AI prompt."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _short_text(value)
    if depth >= 3:
        return _short_text(value)
    if isinstance(value, list):
        return [_safe_value(item, depth=depth + 1) for item in value[:_MAX_ITEMS]]
    if isinstance(value, dict):
        return {
            _short_text(key, 80): _safe_value(item, depth=depth + 1)
            for key, item in list(value.items())[:_MAX_ITEMS]
        }
    return _short_text(value)


def _page_path(value: str) -> tuple[str, dict[str, list[str]]]:
    """Only retain local route context and numeric detail identifiers."""
    if not isinstance(value, str) or len(value) > 240:
        return "/", {}
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return "/", {}
    query = parse_qs(parsed.query, keep_blank_values=False)
    allowed = {
        name: values[:1]
        for name, values in query.items()
        if name in {"work", "conversation"}
        and values
        and _ID_PATTERN.fullmatch(values[0] or "")
    }
    suffix = "&".join(f"{name}={values[0]}" for name, values in sorted(allowed.items()))
    return f"{parsed.path}?{suffix}" if suffix else parsed.path, allowed


def _selected_id(query: dict[str, list[str]], name: str) -> int | None:
    values = query.get(name)
    return int(values[0]) if values else None


def _owned_overview(user_id: int) -> dict[str, Any]:
    work_rows = database.fetch_all(
        """SELECT id, title, description, tags, is_archive, updated_at FROM works
        WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?""",
        (user_id, _MAX_ITEMS),
    )
    card_rows = database.fetch_all(
        """SELECT id, name, persona, personality, speaking_style, updated_at FROM cards
        WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?""",
        (user_id, _MAX_ITEMS),
    )
    worldbook_rows = database.fetch_all(
        """SELECT worldbooks.id, worldbooks.title, worldbooks.description,
        worldbooks.updated_at, COUNT(worldbook_entries.id) AS entry_count
        FROM worldbooks LEFT JOIN worldbook_entries ON worldbook_entries.worldbook_id = worldbooks.id
        WHERE worldbooks.owner_user_id = ? GROUP BY worldbooks.id
        ORDER BY worldbooks.updated_at DESC, worldbooks.id DESC LIMIT ?""",
        (user_id, _MAX_ITEMS),
    )
    conversation_rows = database.fetch_all(
        """SELECT id, work_id, title, status, updated_at, last_message_at FROM conversations
        WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?""",
        (user_id, _MAX_ITEMS),
    )
    snapshot_count = database.fetch_one(
        """SELECT COUNT(*) AS total FROM snapshots
        JOIN conversations ON conversations.id = snapshots.conversation_id
        WHERE conversations.user_id = ?""",
        (user_id,),
    )["total"]
    return {
        "works": [{
            "id": row["id"], "title": _short_text(row["title"], 100),
            "description": _short_text(row["description"], 160),
            "tags": _safe_value(database.json_loads(row["tags"], [])),
            "archived": bool(row["is_archive"]), "updated_at": row["updated_at"],
        } for row in work_rows],
        "role_cards": [{
            "id": row["id"], "name": _short_text(row["name"], 100),
            "persona": _short_text(row["persona"] or row["personality"] or row["speaking_style"], 180),
            "updated_at": row["updated_at"],
        } for row in card_rows],
        "worldbooks": [{
            "id": row["id"], "title": _short_text(row["title"], 100),
            "description": _short_text(row["description"], 140),
            "entry_count": row["entry_count"], "updated_at": row["updated_at"],
        } for row in worldbook_rows],
        "conversations": [{
            "id": row["id"], "work_id": row["work_id"], "title": _short_text(row["title"], 100),
            "status": row["status"], "updated_at": row["updated_at"], "last_message_at": row["last_message_at"],
        } for row in conversation_rows],
        "snapshot_count": snapshot_count,
    }


def _catalog_overview() -> dict[str, int]:
    """Expose only public-library totals, never another account's content."""
    return {
        "work_count": database.fetch_one("SELECT COUNT(*) AS total FROM works")["total"],
        "role_card_count": database.fetch_one("SELECT COUNT(*) AS total FROM cards")["total"],
        "worldbook_count": database.fetch_one("SELECT COUNT(*) AS total FROM worldbooks")["total"],
    }


def _work_focus(work_id: int, user_id: int) -> dict[str, Any] | None:
    work = works.get_work(work_id, viewer_user_id=user_id)
    if work is None:
        return None
    worldbook = worldbooks.get_worldbook(work["worldbook_id"], viewer_user_id=user_id) if work.get("worldbook_id") else None
    return {
        "kind": "work", "id": work["id"], "title": _short_text(work["title"], 120),
        "description": _short_text(work.get("description"), 300),
        "opening": _short_text(work.get("opening"), _MAX_CURRENT_TEXT),
        "tags": _safe_value(work.get("tags", [])), "archived": bool(work.get("is_archive")),
        "cards": [{
            "name": _short_text(card.get("name"), 100),
            "persona": _short_text(card.get("persona") or card.get("personality") or card.get("speaking_style"), 180),
        } for card in work.get("cards", [])[:_MAX_ITEMS] if isinstance(card, dict)],
        "worldbook": None if worldbook is None else {
            "title": _short_text(worldbook.get("title"), 120),
            "description": _short_text(worldbook.get("description"), 240),
            "entries": [{
                "title": _short_text(entry.get("title"), 100),
                "keywords": _safe_value(entry.get("keywords", [])),
                "content": _short_text(entry.get("content"), 180),
            } for entry in worldbook.get("entries", [])[:_MAX_ITEMS]
              if isinstance(entry, dict) and entry.get("enabled")],
        },
    }


def _conversation_focus(conversation_id: int, user_id: int) -> dict[str, Any] | None:
    conversation = conversation_repository.get_conversation(conversation_id, user_id)
    if conversation is None:
        return None
    messages = conversation_repository.get_messages(conversation_id, user_id, limit=6)
    return {
        "kind": "conversation", "id": conversation["id"],
        "title": _short_text(conversation.get("title"), 120), "status": conversation.get("status"),
        "work_id": conversation.get("work_id"), "current_state": _safe_value(conversation.get("current_state", {})),
        "recent_messages": [{"role": message.get("role"), "content": _short_text(message.get("content"), 360)} for message in messages],
    }


def build_read_only_context(user_id: int, page_path: str = "") -> dict[str, Any]:
    """Return a bounded snapshot without invoking any database write path."""
    path, query = _page_path(page_path)
    route = path.split("?", 1)[0]
    focus: dict[str, Any] = {"kind": "page", "path": path}
    if route in {"/work", "/editor"}:
        work_id = _selected_id(query, "work")
        if work_id is not None:
            focus = _work_focus(work_id, user_id) or focus
    elif route in {"/adventure", "/saves"}:
        conversation_id = _selected_id(query, "conversation")
        if conversation_id is not None:
            focus = _conversation_focus(conversation_id, user_id) or focus
    return {
        "mode": "read_only",
        "page": path,
        "current": focus,
        "catalog": _catalog_overview(),
        "owned": _owned_overview(user_id),
    }
