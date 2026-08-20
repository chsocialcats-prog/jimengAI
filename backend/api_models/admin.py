"""Request bodies for station-master operations."""

from pydantic import BaseModel, Field


class AdminPasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=10, max_length=128)
