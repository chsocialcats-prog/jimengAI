"""Authentication endpoint request schemas."""

from pydantic import BaseModel, Field


class CredentialsRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdateRequest(BaseModel):
    avatar_url: str = Field(default="", max_length=2048)
