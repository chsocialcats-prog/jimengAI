# -*- coding: utf-8 -*-
"""文本角色卡导入接口。"""

from fastapi import APIRouter

from .. import repositories
from ..schemas import CardTextImport
from ..services.card_importer import parse_card_text
from ._error_helpers import _raise_validation_error

router = APIRouter(prefix="/api/imports", tags=["导入"])


@router.post("/card-text", status_code=201, summary="导入文本角色卡")
def import_card_text(payload: CardTextImport):
    """把粘贴的文本卡解析并创建为作品、角色卡和世界书。"""
    if not payload.text.strip():
        _raise_validation_error("导入内容不能为空")
    parsed = parse_card_text(payload.text)
    card = repositories.create_card(parsed["card"])
    worldbook = repositories.create_worldbook(parsed["worldbook"])
    for entry in parsed["worldbook_entries"]:
        repositories.create_worldbook_entry(worldbook["id"], entry)
    work = repositories.create_work(
        {
            **parsed["work"],
            "card_id": card["id"],
            "worldbook_id": worldbook["id"],
        }
    )
    return {"work": work, "card": card, "worldbook": worldbook}
