"""Authenticated daily check-in endpoints."""

from fastapi import APIRouter, Depends

from ..auth.dependencies import require_auth
from ..auth.types import AuthContext
from ..repository import daily_checkins


router = APIRouter(prefix="/api/daily-checkin", tags=["每日签到"])


@router.get("/calendar", summary="读取本月签到日期")
def read_current_month_checkins(auth: AuthContext = Depends(require_auth)):
    return daily_checkins.get_current_month_checkins(auth.user.id)


@router.get("", summary="读取今日签到状态")
def read_daily_checkin(auth: AuthContext = Depends(require_auth)):
    return daily_checkins.get_status(auth.user.id)


@router.post("", summary="完成今日签到")
def create_daily_checkin(auth: AuthContext = Depends(require_auth)):
    return daily_checkins.check_in(auth.user.id)
