"""China-local festival definitions for daily check-ins and month calendars."""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import Any

import holidays
from lunardate import LunarDate


_TRADITIONAL = 3
_STATUTORY = 2
_THEME = 1


def _festival(
    festival_id: str,
    name: str,
    icon: str,
    priority: int,
    verse: str,
    lucky_color: str,
    do: str,
    avoid: str,
) -> dict[str, Any]:
    return {
        "id": festival_id,
        "name": name,
        "icon": icon,
        "priority": priority,
        "fortune": {
            "rank": "大吉",
            "verse": verse,
            "lucky_color": lucky_color,
            "do": do,
            "avoid": avoid,
        },
    }


_FESTIVALS = {
    "spring_festival": _festival("spring_festival", "春节", "house", _TRADITIONAL, "新岁开篇，万事皆可期。", "樱粉", "写下心愿", "匆忙赶路"),
    "lantern_festival": _festival("lantern_festival", "元宵节", "lamp", _TRADITIONAL, "灯火照前路，团圆也照见新灵感。", "蜜杏", "与人分享", "把心事藏起"),
    "dragon_boat_festival": _festival("dragon_boat_festival", "端午节", "flag", _TRADITIONAL, "一舟越过旧浪，新的篇章正待落笔。", "新芽绿", "整理行囊", "忘记休息"),
    "qixi_festival": _festival("qixi_festival", "七夕节", "heart", _TRADITIONAL, "星河有约，真心会找到自己的回声。", "薰衣草", "表达心意", "妄自猜测"),
    "mid_autumn_festival": _festival("mid_autumn_festival", "中秋节", "moon", _TRADITIONAL, "月满人间，笔下也有圆满的归处。", "晨雾蓝", "联络故人", "独自焦虑"),
    "new_years_day": _festival("new_years_day", "元旦", "sparkles", _STATUTORY, "新年的第一页，正等你写下闪光的开端。", "樱粉", "开启新章", "回望遗憾"),
    "qingming_festival": _festival("qingming_festival", "清明节", "flower-2", _STATUTORY, "春风轻拂旧页，思念会化作温柔的勇气。", "新芽绿", "慢慢回顾", "苛责自己"),
    "labour_day": _festival("labour_day", "劳动节", "briefcase", _STATUTORY, "认真耕耘的每一笔，都在为故事铺路。", "蜜杏", "完成一件小事", "透支精力"),
    "national_day": _festival("national_day", "国庆节", "landmark", _STATUTORY, "山河舒展，心中的远方也有了回响。", "晨雾蓝", "记录见闻", "局限想象"),
    "valentines_day": _festival("valentines_day", "情人节", "heart", _THEME, "真诚是最明亮的告白，也照亮今天的旅程。", "樱粉", "感谢陪伴", "吝于表达"),
    "womens_day": _festival("womens_day", "妇女节", "flower-2", _THEME, "愿每一份从容与力量，都被温柔看见。", "薰衣草", "肯定自己", "忽略感受"),
    "childrens_day": _festival("childrens_day", "儿童节", "gift", _THEME, "把好奇心留在身边，今天的世界会格外辽阔。", "蜜杏", "尝试新点子", "急着成熟"),
    "christmas": _festival("christmas", "圣诞节", "gift", _THEME, "冬夜有暖灯，心里的愿望也会慢慢抵达。", "樱粉", "送出祝福", "独自逞强"),
}

_LUNAR_FESTIVALS = {
    (1, 1): "spring_festival",
    (1, 15): "lantern_festival",
    (5, 5): "dragon_boat_festival",
    (7, 7): "qixi_festival",
    (8, 15): "mid_autumn_festival",
}

_FIXED_STATUTORY = {
    (1, 1): "new_years_day",
    (5, 1): "labour_day",
    (10, 1): "national_day",
}

_FIXED_THEME = {
    (2, 14): "valentines_day",
    (3, 8): "womens_day",
    (6, 1): "childrens_day",
    (12, 25): "christmas",
}


@lru_cache(maxsize=None)
def _china_public_holidays(year: int):
    return holidays.country_holidays("CN", years=year, observed=False)


def _festival_payload(festival: dict[str, Any]) -> dict[str, Any]:
    return {key: festival[key] for key in ("id", "name", "icon", "priority")}


def festival_for(day: date) -> dict[str, Any] | None:
    """Return the primary festival for a date, favoring traditional holidays."""
    candidates: list[dict[str, Any]] = []
    lunar = LunarDate.fromSolarDate(day.year, day.month, day.day)
    if not lunar.isLeapMonth:
        lunar_festival = _LUNAR_FESTIVALS.get((lunar.month, lunar.day))
        if lunar_festival:
            candidates.append(_FESTIVALS[lunar_festival])

    public_holidays = _china_public_holidays(day.year)
    statutory = _FIXED_STATUTORY.get((day.month, day.day))
    if statutory and day in public_holidays:
        candidates.append(_FESTIVALS[statutory])
    holiday_name = str(public_holidays.get(day, ""))
    if "Qingming" in holiday_name or "清明" in holiday_name:
        candidates.append(_FESTIVALS["qingming_festival"])

    theme = _FIXED_THEME.get((day.month, day.day))
    if theme:
        candidates.append(_FESTIVALS[theme])

    if not candidates:
        return None
    return max(candidates, key=lambda item: item["priority"])


def festival_metadata_for(day: date) -> dict[str, Any] | None:
    festival = festival_for(day)
    return _festival_payload(festival) if festival else None


def festival_fortune_for(day: date) -> dict[str, Any] | None:
    festival = festival_for(day)
    return dict(festival["fortune"]) if festival else None


def festivals_for_month(month_start: date) -> list[dict[str, Any]]:
    """List each primary festival in a natural month, sorted by date."""
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    day = month_start
    festivals: list[dict[str, Any]] = []
    while day < next_month:
        metadata = festival_metadata_for(day)
        if metadata:
            festivals.append({"date": day.isoformat(), **metadata})
        day += timedelta(days=1)
    return festivals
