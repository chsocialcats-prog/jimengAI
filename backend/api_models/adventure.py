# -*- coding: utf-8 -*-
"""Private adventure request models kept outside the legacy public schema module."""

from pydantic import BaseModel, Field


class ConversationBranchCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    branch_label: str = ""
    snapshot_id: int | None = None
