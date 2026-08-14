# -*- coding: utf-8 -*-
"""文本角色卡导入接口。"""

from fastapi import APIRouter, Depends

from ..repository import work_bundles
from ..auth.dependencies import require_user
from ..schemas import CardTextImport
from ..services.card_importer import parse_card_text
from ._error_helpers import _raise_validation_error

router = APIRouter(prefix="/api/imports", tags=["导入"])


@router.post("/card-text", status_code=201, summary="导入文本角色卡")
def import_card_text(payload: CardTextImport, user=Depends(require_user)):
    """把粘贴的文本卡解析并创建为作品、角色卡和世界书。"""
    if not payload.text.strip():
        _raise_validation_error("导入内容不能为空")
    parsed = parse_card_text(payload.text)
    return work_bundles.save_import_bundle(
        parsed["card"],
        parsed["worldbook"],
        parsed["worldbook_entries"],
        parsed["work"],
        owner_user_id=user.id,
    )
