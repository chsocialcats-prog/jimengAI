"""Request bodies for personal AI settings APIs."""

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


_PROVIDER_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


class ProviderSettingsCreate(BaseModel):
    """One OpenAI-compatible provider profile created for an account."""

    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(..., min_length=1, max_length=64)
    display_name: str = Field(..., min_length=1, max_length=80)
    base_url: str = Field(..., min_length=1, max_length=500)
    protocol: str = "openai-completions"
    model: str = Field(..., min_length=1, max_length=200)
    models: list[str] = Field(default_factory=list, max_length=200)
    api_key: str | None = Field(None, max_length=2000)
    timeout_seconds: int = Field(60, ge=1, le=300)

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, value: str) -> str:
        if not _PROVIDER_ID.fullmatch(value):
            raise ValueError("provider_id 必须以小写字母开头，只能包含小写字母、数字和连字符")
        return value

    @field_validator("display_name", "base_url", "model")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("models")
    @classmethod
    def normalize_models(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            item = value.strip()
            if item and item not in normalized:
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def supports_available_protocol(self):
        if self.protocol != "openai-completions":
            raise ValueError("当前仅支持 openai-completions 协议")
        return self


class ProviderSettingsUpdate(BaseModel):
    """Partial update for one provider profile and its write-only API key."""

    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(None, min_length=1, max_length=80)
    base_url: str | None = Field(None, min_length=1, max_length=500)
    protocol: str | None = None
    model: str | None = Field(None, min_length=1, max_length=200)
    models: list[str] | None = Field(None, max_length=200)
    api_key: str | None = Field(None, max_length=2000)
    clear_api_key: bool = False
    timeout_seconds: int | None = Field(None, ge=1, le=300)
    activate: bool | None = None

    @field_validator("display_name", "base_url", "model")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("models")
    @classmethod
    def normalize_optional_models(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized: list[str] = []
        for value in values:
            item = value.strip()
            if item and item not in normalized:
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def key_and_protocol_are_valid(self):
        if self.clear_api_key and self.api_key not in (None, ""):
            raise ValueError("api_key and clear_api_key cannot be combined")
        if self.protocol is not None and self.protocol != "openai-completions":
            raise ValueError("当前仅支持 openai-completions 协议")
        return self


class DeepSeekSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    timeout_seconds: int | None = Field(None, ge=1, le=300)

    @model_validator(mode="after")
    def key_operation_is_unambiguous(self):
        if self.clear_api_key and self.api_key not in (None, ""):
            raise ValueError("api_key and clear_api_key cannot be combined")
        return self


class GenerationSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: float | None = Field(None, ge=0, le=2)
    max_tokens: int | None = Field(None, ge=1, le=32768)
    reasoning_effort: str | None = None
    context_window_tokens: int | None = Field(None, ge=2048, le=131072)
    compression_trigger_ratio: float | None = Field(None, ge=0.50, le=0.95)
    compression_keep_recent_messages: int | None = Field(None, ge=2, le=32)
    compression_summary_max_tokens: int | None = Field(None, ge=256, le=4096)


class UserAISettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deepseek: DeepSeekSettingsUpdate | None = None
    generation: GenerationSettingsUpdate | None = None


class ModelDiscoveryPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(None, min_length=1, max_length=64)
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    timeout_seconds: int | None = Field(None, ge=1, le=300)
