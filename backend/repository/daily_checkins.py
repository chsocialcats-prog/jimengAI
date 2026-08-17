"""Persistence helpers for one check-in per account and calendar day."""

from __future__ import annotations

from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from typing import Any

from .. import database
from ..services.holiday_calendar import festival_fortune_for, festival_metadata_for, festivals_for_month


_CHECKIN_TIMEZONE = timezone(timedelta(hours=8), "Asia/Shanghai")
_FORTUNE_VERSION = "fortune-v1"

_FORTUNES: tuple[dict[str, str], ...] = (
    {"rank": "大吉", "verse": "笔墨流转处，自有灵感生。", "lucky_color": "樱粉", "do": "整理灵感", "avoid": "反复犹豫"},
    {"rank": "中吉", "verse": "慢些落笔，故事会自己发光。", "lucky_color": "薰衣草", "do": "续写片段", "avoid": "急于定稿"},
    {"rank": "小吉", "verse": "一页新章，正等待你的名字。", "lucky_color": "晨雾蓝", "do": "记录细节", "avoid": "忽略休息"},
    {"rank": "平", "verse": "安静积累，也是在推进旅程。", "lucky_color": "新芽绿", "do": "回顾设定", "avoid": "同时开太多线"},
    {"rank": "大吉", "verse": "心中有光，笔下便有远方。", "lucky_color": "蜜杏", "do": "开启新章", "avoid": "低估自己"},
    {"rank": "中吉", "verse": "不必追赶灵感，它会在专注时抵达。", "lucky_color": "薰衣草", "do": "完善人物", "avoid": "分心切换"},
    {"rank": "小吉", "verse": "旧线索轻轻一碰，便能长出新故事。", "lucky_color": "樱粉", "do": "串联伏笔", "avoid": "删去草稿"},
    {"rank": "平", "verse": "留白一点，想象便多一处入口。", "lucky_color": "晨雾蓝", "do": "放慢节奏", "avoid": "苛求完美"},
)

_FORTUNE_FIELDS = ("rank", "verse", "lucky_color", "do", "avoid")


def _current_time(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(_CHECKIN_TIMEZONE)
    if now.tzinfo is None:
        return now.replace(tzinfo=_CHECKIN_TIMEZONE)
    return now.astimezone(_CHECKIN_TIMEZONE)


def _fortune_for(user_id: int, checkin_date: str) -> dict[str, str]:
    festival_fortune = festival_fortune_for(date.fromisoformat(checkin_date))
    if festival_fortune:
        return festival_fortune
    digest = hashlib.sha256(f"{user_id}:{checkin_date}:{_FORTUNE_VERSION}".encode("utf-8")).digest()
    return dict(_FORTUNES[int.from_bytes(digest, "big") % len(_FORTUNES)])


def _read_fortune(value: Any) -> dict[str, str] | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict) or any(not isinstance(parsed.get(field), str) for field in _FORTUNE_FIELDS):
        return None
    return {field: parsed[field] for field in _FORTUNE_FIELDS}


def _serialize_fortune(fortune: dict[str, str]) -> str:
    return json.dumps(fortune, ensure_ascii=False, separators=(",", ":"))


def _backfill_user_records(connection, user_id: int) -> None:
    """Populate new fields for legacy rows using their original China-local date."""
    rows = connection.execute(
        """
        SELECT checkin_date, fortune_json, streak_days, points_awarded
        FROM daily_checkins
        WHERE user_id = ?
        ORDER BY checkin_date ASC
        """,
        (user_id,),
    ).fetchall()
    previous_date: date | None = None
    streak_days = 0
    for row in rows:
        checkin_date = date.fromisoformat(row["checkin_date"])
        streak_days = streak_days + 1 if previous_date == checkin_date - timedelta(days=1) else 1
        fortune = _read_fortune(row["fortune_json"])
        points_awarded = row["points_awarded"]
        needs_update = (
            fortune is None
            or row["streak_days"] != streak_days
            or not isinstance(points_awarded, int)
            or points_awarded < 0
        )
        if needs_update:
            connection.execute(
                """
                UPDATE daily_checkins
                SET fortune_json = ?, streak_days = ?, points_awarded = ?
                WHERE user_id = ? AND checkin_date = ?
                """,
                (
                    _serialize_fortune(fortune or _fortune_for(user_id, row["checkin_date"])),
                    streak_days,
                    points_awarded if isinstance(points_awarded, int) and points_awarded >= 0 else 1,
                    user_id,
                    row["checkin_date"],
                ),
            )
        previous_date = checkin_date


def _status_in_connection(connection, user_id: int, current: datetime) -> dict:
    checkin_date = current.date().isoformat()
    row = connection.execute(
        """
        SELECT checked_in_at, fortune_json, streak_days, points_awarded
        FROM daily_checkins
        WHERE user_id = ? AND checkin_date = ?
        """,
        (user_id, checkin_date),
    ).fetchone()
    points_total = connection.execute(
        "SELECT COALESCE(SUM(points_awarded), 0) FROM daily_checkins WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]
    festival = festival_metadata_for(current.date())
    fortune = _read_fortune(row["fortune_json"]) if row is not None else None
    if fortune is not None and festival is not None:
        fortune = _fortune_for(user_id, checkin_date)
        fortune["festival"] = festival
    return {
        "date": checkin_date,
        "checked_in": row is not None,
        "checked_in_at": row["checked_in_at"] if row is not None else None,
        "fortune": fortune,
        "streak_days": row["streak_days"] if row is not None else 0,
        "points_awarded": row["points_awarded"] if row is not None else 0,
        "points_total": points_total,
    }


def get_status(user_id: int, *, now: datetime | None = None, connect_fn=database.connect) -> dict:
    """Return the authenticated user's check-in state for the China-local day."""
    current = _current_time(now)
    with closing(connect_fn()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _backfill_user_records(connection, user_id)
        result = _status_in_connection(connection, user_id, current)
        connection.commit()
        return result


def get_current_month_checkins(user_id: int, *, now: datetime | None = None, connect_fn=database.connect) -> dict:
    """Return the authenticated user's check-in dates for the China-local current month."""
    current = _current_time(now)
    month_start = current.date().replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    with closing(connect_fn()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _backfill_user_records(connection, user_id)
        rows = connection.execute(
            """
            SELECT checkin_date
            FROM daily_checkins
            WHERE user_id = ? AND checkin_date >= ? AND checkin_date < ?
            ORDER BY checkin_date ASC
            """,
            (user_id, month_start.isoformat(), next_month.isoformat()),
        ).fetchall()
        connection.commit()
    return {
        "month": month_start.strftime("%Y-%m"),
        "checkin_dates": [row["checkin_date"] for row in rows],
        "festivals": festivals_for_month(month_start),
    }


def check_in(user_id: int, *, now: datetime | None = None, connect_fn=database.connect) -> dict:
    """Record a check-in once, without treating a duplicate submission as an error."""
    current = _current_time(now)
    checkin_date = current.date().isoformat()
    checked_in_at = current.replace(microsecond=0).isoformat()
    with closing(connect_fn()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _backfill_user_records(connection, user_id)
        existing = connection.execute(
            "SELECT 1 FROM daily_checkins WHERE user_id = ? AND checkin_date = ?",
            (user_id, checkin_date),
        ).fetchone()
        if existing is None:
            yesterday = (current.date() - timedelta(days=1)).isoformat()
            previous = connection.execute(
                """
                SELECT streak_days FROM daily_checkins
                WHERE user_id = ? AND checkin_date = ?
                """,
                (user_id, yesterday),
            ).fetchone()
            streak_days = (previous["streak_days"] if previous is not None else 0) + 1
            connection.execute(
                """
                INSERT INTO daily_checkins (
                    user_id, checkin_date, checked_in_at, fortune_json, streak_days, points_awarded
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    checkin_date,
                    checked_in_at,
                    _serialize_fortune(_fortune_for(user_id, checkin_date)),
                    streak_days,
                    1,
                ),
            )
        connection.commit()
        result = _status_in_connection(connection, user_id, current)
        result["already_checked_in"] = existing is not None
        return result
