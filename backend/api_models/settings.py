"""Request bodies for personal AI settings APIs."""

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    timeout_seconds: int | None = Field(None, ge=1, le=300)
