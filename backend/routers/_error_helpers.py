"""Shared private error responses for HTTP routers."""

from typing import NoReturn

from fastapi import HTTPException


def _raise_not_found(message: str) -> NoReturn:
    raise HTTPException(
        status_code=404,
        detail={"code": "not_found", "message": message},
    )


def _raise_validation_error(message: str) -> NoReturn:
    raise HTTPException(
        status_code=422,
        detail={"code": "validation_error", "message": message},
    )


def _raise_no_update_fields() -> NoReturn:
    _raise_validation_error("没有可更新的字段")


def _raise_validation_from_value_error(
    exc: Exception, *, chain: bool = True
) -> NoReturn:
    error = HTTPException(
        status_code=422,
        detail={"code": "validation_error", "message": str(exc)},
    )
    if chain:
        raise error from exc
    raise error
