# -*- coding: utf-8 -*-
"""Frozen cross-package authentication value types."""

from __future__ import annotations

from dataclasses import dataclass


DEFAULT_ACCOUNT_AVATAR_URL = "/images/avatars/default-account.png"
ROLE_USER = "user"
ROLE_STATION_MASTER = "station_master"


@dataclass(frozen=True)
class PublicUser:
    id: int
    username: str
    created_at: str
    avatar_url: str = ""
    role: str = ROLE_USER


@dataclass(frozen=True)
class AuthContext:
    user: PublicUser
    session_id: int


@dataclass(frozen=True)
class IssuedSession:
    session_id: int
    token: str
    absolute_expires_at: str


@dataclass(frozen=True)
class ConversationAccess:
    auth: AuthContext
    conversation: dict
