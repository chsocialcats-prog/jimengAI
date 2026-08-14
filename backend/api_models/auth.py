"""Authentication endpoint request schemas."""

from pydantic import BaseModel, Field


class CredentialsRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
