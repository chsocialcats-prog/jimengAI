"""Controlled account promotion commands for local operators."""

from __future__ import annotations

import argparse
import sys
from contextlib import closing

from . import database
from .auth.types import ROLE_STATION_MASTER
from .services.admin_service import (
    AdminServiceError,
    AdminUserNotFound,
    StationMasterExists,
    _now,
    record_admin_audit,
)


def promote_station_master(connection, username):
    """Promote one existing account without exposing a public promotion API."""
    username_key = str(username or "").strip().casefold()
    if not username_key:
        raise AdminServiceError("用户名不能为空")
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT id, username, username_key, role, is_active, avatar_url, created_at, updated_at "
            "FROM users WHERE username_key = ?",
            (username_key,),
        ).fetchone()
        if row is None:
            raise AdminUserNotFound("用户不存在")
        if row["role"] == ROLE_STATION_MASTER:
            connection.commit()
            return dict(row)
        existing = connection.execute(
            "SELECT id FROM users WHERE role = ? LIMIT 1", (ROLE_STATION_MASTER,)
        ).fetchone()
        if existing is not None:
            raise StationMasterExists()
        now = _now()
        connection.execute(
            "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
            (ROLE_STATION_MASTER, now, row["id"]),
        )
        record_admin_audit(
            connection,
            target_user_id=row["id"],
            action="promote_station_master",
            target_type="user",
            target_id=row["id"],
            summary={"role": ROLE_STATION_MASTER},
            request_ip="cli",
        )
        connection.commit()
        promoted = connection.execute(
            "SELECT id, username, username_key, is_active, role, avatar_url, created_at, updated_at "
            "FROM users WHERE id = ?",
            (row["id"],),
        ).fetchone()
        return dict(promoted)
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description="AI 对话冒险平台站长账户管理")
    subparsers = parser.add_subparsers(dest="command", required=True)
    promote = subparsers.add_parser("promote", help="将现有账户设为站长")
    promote.add_argument("--username", required=True, help="要提升的用户名")
    args = parser.parse_args(argv)

    database.init_db()
    try:
        with closing(database.connect()) as connection:
            user = promote_station_master(connection, args.username)
    except (AdminServiceError, AdminUserNotFound, StationMasterExists) as exc:
        print(f"操作失败：{exc}", file=sys.stderr)
        return 1
    print(f"已将账户 {user['username']} 设为站长。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
