"""Station-master control-plane APIs."""

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from .. import database
from ..api_models.admin import AdminPasswordResetRequest
from ..auth.dependencies import require_station_master
from ..auth.cookies import set_no_store
from ..auth.errors import AuthValidationError
from ..services.admin_service import AdminService, AdminServiceError
from ..services.admin_resources import AdminResourceService

def _no_store(response: Response):
    set_no_store(response)


router = APIRouter(prefix="/api/admin", tags=["站长后台"], dependencies=[Depends(_no_store)])


def _service(request: Request):
    service = getattr(request.app.state, "admin_service", None)
    return service if service is not None else AdminService(database.connect)


def _resource_service(request: Request):
    service = getattr(request.app.state, "admin_resource_service", None)
    return service if service is not None else AdminResourceService(database.connect)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _raise_admin_error(exc: AdminServiceError):
    raise HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    ) from exc


@router.get("/overview")
def overview(request: Request, _station_master=Depends(require_station_master)):
    return _service(request).overview()


@router.get("/users")
def list_users(
    request: Request,
    q: str = Query(default="", max_length=120),
    status: str = Query(default="all", pattern="^(all|active|disabled)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _station_master=Depends(require_station_master),
):
    return _service(request).list_users(query=q, status=status, page=page, page_size=page_size)


@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    request: Request,
    _station_master=Depends(require_station_master),
):
    try:
        return {"user": _service(request).get_user(user_id)}
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.post("/users/{user_id}/suspend")
def suspend_user(
    user_id: int,
    request: Request,
    station_master=Depends(require_station_master),
):
    try:
        return {"user": _service(request).set_user_active(station_master, user_id, False, request_ip=_client_ip(request))}
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.post("/users/{user_id}/activate")
def activate_user(
    user_id: int,
    request: Request,
    station_master=Depends(require_station_master),
):
    try:
        return {"user": _service(request).set_user_active(station_master, user_id, True, request_ip=_client_ip(request))}
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: AdminPasswordResetRequest,
    request: Request,
    station_master=Depends(require_station_master),
):
    try:
        return {"user": _service(request).reset_password(station_master, user_id, payload.new_password, request_ip=_client_ip(request))}
    except AdminServiceError as exc:
        _raise_admin_error(exc)
    except AuthValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message}) from exc


@router.post("/users/{user_id}/ai/clear-secrets")
def clear_ai_secrets(
    user_id: int,
    request: Request,
    station_master=Depends(require_station_master),
):
    try:
        return {"user": _service(request).clear_ai_settings(station_master, user_id, request_ip=_client_ip(request))}
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.get("/audit-logs")
def audit_logs(
    request: Request,
    action: str = Query(default="", max_length=100),
    target_user_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    _station_master=Depends(require_station_master),
):
    return _service(request).list_audit_logs(
        page=page,
        page_size=page_size,
        action=action,
        target_user_id=target_user_id,
    )


@router.get("/resources")
def list_resources(
    request: Request,
    kind: str = Query(...),
    q: str = Query(default="", max_length=240),
    owner_user_id: int | None = Query(default=None, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _station_master=Depends(require_station_master),
):
    try:
        return _resource_service(request).list_resources(
            kind=kind,
            query=q,
            owner_user_id=owner_user_id,
            page=page,
            page_size=page_size,
        )
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.get("/resources/{kind}/{resource_id}/export")
def export_resource(
    kind: str,
    resource_id: int,
    request: Request,
    _station_master=Depends(require_station_master),
):
    try:
        resource = _resource_service(request).export_resource(kind, resource_id)
    except AdminServiceError as exc:
        _raise_admin_error(exc)
    body = json.dumps(resource, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="admin-{kind}-{resource_id}.json"'},
    )


@router.get("/resources/{kind}/{resource_id}")
def get_resource(
    kind: str,
    resource_id: int,
    request: Request,
    _station_master=Depends(require_station_master),
):
    try:
        return {"resource": _resource_service(request).get_resource(kind, resource_id)}
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.patch("/resources/{kind}/{resource_id}")
def update_resource(
    kind: str,
    resource_id: int,
    request: Request,
    payload: dict = Body(default={}),
    station_master=Depends(require_station_master),
):
    try:
        return {
            "resource": _resource_service(request).update_resource(
                station_master,
                kind,
                resource_id,
                payload,
                request_ip=_client_ip(request),
            )
        }
    except AdminServiceError as exc:
        _raise_admin_error(exc)


@router.delete("/resources/{kind}/{resource_id}", status_code=204)
def delete_resource(
    kind: str,
    resource_id: int,
    request: Request,
    station_master=Depends(require_station_master),
):
    try:
        _resource_service(request).delete_resource(
            station_master,
            kind,
            resource_id,
            request_ip=_client_ip(request),
        )
    except AdminServiceError as exc:
        _raise_admin_error(exc)
    return Response(status_code=204)
