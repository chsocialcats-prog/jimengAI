# -*- coding: utf-8 -*-
"""Pydantic request models for backend APIs."""

from typing import Optional

from pydantic import BaseModel, Field

from .api_models.adventure import ConversationBranchCreate


class CardCreate(BaseModel):
    name: str
    avatar_url: str = ""
    persona: str = ""
    personality: str = ""
    speaking_style: str = ""
    relationships: dict = Field(default_factory=dict)
    directives: list = Field(default_factory=list)
    initial_state: dict = Field(default_factory=dict)
    character_attributes: dict = Field(default_factory=dict)
    source: str = "local"


class CardUpdate(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    persona: Optional[str] = None
    personality: Optional[str] = None
    speaking_style: Optional[str] = None
    relationships: Optional[dict] = None
    directives: Optional[list] = None
    initial_state: Optional[dict] = None
    character_attributes: Optional[dict] = None
    source: Optional[str] = None


class WorldbookCreate(BaseModel):
    title: str
    description: str = ""


class WorldbookUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class WorldbookEntryCreate(BaseModel):
    title: str
    keywords: list = Field(default_factory=list)
    content: str = ""
    priority: int = 0
    enabled: bool = True


class WorldbookEntryUpdate(BaseModel):
    title: Optional[str] = None
    keywords: Optional[list] = None
    content: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class ReplyTemplate(BaseModel):
    id: str = ""
    name: str = ""
    content: str = ""


class WorkCreate(BaseModel):
    title: str
    description: str = ""
    card_id: Optional[int] = None
    card_ids: Optional[list[int]] = None
    player_attributes: Optional[dict] = None
    worldbook_id: Optional[int] = None
    opening: str = ""
    tags: list = Field(default_factory=list)
    onboarding: dict = Field(default_factory=dict)
    cover_url: str = ""
    reply_templates: list[ReplyTemplate] = Field(default_factory=list)
    active_reply_template_id: str = ""


class WorkUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    card_id: Optional[int] = None
    card_ids: Optional[list[int]] = None
    player_attributes: Optional[dict] = None
    worldbook_id: Optional[int] = None
    opening: Optional[str] = None
    tags: Optional[list] = None
    onboarding: Optional[dict] = None
    cover_url: Optional[str] = None
    reply_templates: Optional[list[ReplyTemplate]] = None
    active_reply_template_id: Optional[str] = None
    is_archive: Optional[bool] = None


class CreatorWorldbookEntry(WorldbookEntryCreate):
    id: Optional[int] = None


class CreatorWorldbook(BaseModel):
    title: str
    description: str = ""
    entries: list[CreatorWorldbookEntry] = Field(default_factory=list)


class WorkBundleCreate(BaseModel):
    work: WorkCreate
    worldbook: CreatorWorldbook


class WorkBundleUpdate(BaseModel):
    work: WorkUpdate
    worldbook: CreatorWorldbook


class ConversationCreate(BaseModel):
    work_id: int
    title: str = "新的冒险"


class ConversationUpdate(BaseModel):
    title: str = Field(..., min_length=1)


class OnboardingComplete(BaseModel):
    answers: dict = Field(default_factory=dict)


class ConversationCorrection(BaseModel):
    kind: str
    content: str = Field(..., min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    metadata: dict = Field(default_factory=dict)


class SnapshotCreate(BaseModel):
    name: str = "手动存档"
    note: str = ""
    branch_label: str = ""


class StateUpdate(BaseModel):
    attributes: Optional[dict] = None
    items: Optional[list] = None
    money: Optional[float] = None
    relations: Optional[dict] = None
    quests: Optional[list] = None
    flags: Optional[list] = None
    characters: Optional[dict] = None
    logs: Optional[list] = None


class RollRequest(BaseModel):
    dice: str = "1d20"
    target: Optional[int] = None
    attribute: Optional[str] = None
    reason: str = ""


class GenerationUpdate(BaseModel):
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    reasoning_effort: Optional[str] = None
    context_window_tokens: Optional[int] = Field(None, ge=2048, le=131072)
    compression_trigger_ratio: Optional[float] = Field(None, ge=0.50, le=0.95)
    compression_keep_recent_messages: Optional[int] = Field(None, ge=2, le=32)
    compression_summary_max_tokens: Optional[int] = Field(None, ge=256, le=4096)


class ConfigUpdate(BaseModel):
    app: Optional[dict] = None
    deepseek: Optional[dict] = None
    generation: Optional[GenerationUpdate] = None


class ModelDiscoveryPreview(BaseModel):
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    timeout_seconds: int = Field(60, ge=1, le=300)


class ContentOnlyRequest(BaseModel):
    content: str = ""


class CardTextImport(BaseModel):
    text: str = Field(..., min_length=1)
