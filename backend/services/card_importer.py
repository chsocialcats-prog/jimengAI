# -*- coding: utf-8 -*-
"""从粘贴的文本角色卡解析出作品、角色卡和世界书。"""

import re

SECTION_HEADERS = ("正文", "环境", "状态栏", "记忆区", "偷听心声")


def _split_sections(text):
    """按文本卡常用小标题切分正文/环境/状态栏/记忆区。"""
    sections = {}
    current = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        matched = None
        for header in SECTION_HEADERS:
            if line == header or line.startswith(header + "：") or line.startswith(header + ":"):
                matched = header
                break
        if matched:
            current = matched
            sections.setdefault(current, [])
            tail = line[len(matched):].lstrip("：: ")
            if tail:
                sections[current].append(tail)
            continue
        if current:
            sections[current].append(line)
    return {key: "\n".join(value).strip() for key, value in sections.items()}


def _prelude(text):
    """收集标题之后的角色心声与选项文本。"""
    parts = []
    started = False
    for raw in text.splitlines():
        line = raw.strip()
        if not started and line:
            started = True
            continue
        if any(line == header or line.startswith(header + "：") or line.startswith(header + ":") for header in SECTION_HEADERS):
            break
        if line:
            parts.append(line)
    return "\n".join(parts).strip()


def _extract_name(title, text):
    match = re.search(r"[（(]([^（）()]+)[)）]", title)
    if match:
        name = match.group(1).strip()
        if name and len(name) <= 12 and "包养" not in name:
            return name
    match = re.search(r"人物[:：]\s*([^\s、，,]+)", text)
    if match:
        name = match.group(1).strip().replace("{{user}}", "")
        if name:
            return name
    return "角色"


def _opening(body, fallback):
    paragraphs = [part.strip() for part in body.split("\n\n") if part.strip()]
    if not paragraphs:
        paragraphs = [body.strip()] if body.strip() else []
    text = ""
    for paragraph in paragraphs:
        text += paragraph + "\n\n"
        if len(text) >= 700:
            break
    return text.strip() or fallback


def _first_paragraph(body, fallback):
    paragraphs = [part.strip() for part in body.split("\n\n") if part.strip()]
    return paragraphs[0][:220] if paragraphs else fallback


def _star_value(value):
    count = value.count("⭐") or value.count("★")
    return count * 20 if count else None


def _parse_attributes(status_text):
    """从状态栏文本提取可展示的属性数值。"""
    attributes = {}
    for raw in status_text.splitlines():
        line = raw.strip()
        if "：" in line:
            key, _, value = line.partition("：")
        elif ":" in line:
            key, _, value = line.partition(":")
        else:
            continue
        key = key.strip().lstrip("-").strip()
        value = value.strip()
        if not key or not value or "用户" in key or "姓名" in key:
            continue
        stars = _star_value(value)
        if stars is not None:
            attributes[key] = stars
            continue
        if value in ("是", "有", "开"):
            attributes[key] = 100
            continue
        if value in ("否", "无", "关", "未开发"):
            attributes[key] = 0
            continue
        numeric = re.sub(r"[^\d.]", "", value)
        if numeric:
            attributes[key] = int(float(numeric))
    attributes.setdefault("紧张", 80)
    attributes.setdefault("接受度", 20)
    return attributes


def _env_entries(env_text):
    entries = []
    event = ""
    place = ""
    for raw in env_text.splitlines():
        line = raw.strip()
        if line.startswith("当前事件"):
            event = line.split(":", 1)[-1].split("：", 1)[-1].strip()
        elif line.startswith("当前地点"):
            place = line.split(":", 1)[-1].split("：", 1)[-1].strip()
    if env_text:
        entries.append(
            {
                "title": "环境设定",
                "keywords": ["环境", "日期", "时间", "天气", "地点"],
                "content": env_text,
                "priority": 30,
                "enabled": True,
            }
        )
    if event or place:
        entries.append(
            {
                "title": "当前事件",
                "keywords": ["事件", "当前", "见面", "地点"],
                "content": f"当前事件：{event}\n当前地点：{place}".strip(),
                "priority": 40,
                "enabled": True,
            }
        )
    return entries


def parse_card_text(text):
    """把文本卡转成 card / worldbook / work 三个创建载荷。"""
    text = (text or "").strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title = lines[0] if lines else "未命名作品"
    sections = _split_sections(text)
    body = sections.get("正文", "")
    env_text = sections.get("环境", "")
    status_text = sections.get("状态栏", "")
    memory_text = sections.get("记忆区", "")
    inner_text = sections.get("偷听心声", "") or _prelude(text)
    name = _extract_name(title, text)
    description = _first_paragraph(body, title)
    opening = _opening(body, f"你来到{name}身边。")

    directives = [
        "保持角色人设与状态栏设定",
        "角色为已满 20 岁的成年人",
        "每次回复推进剧情，描写环境、感官与角色反应",
        "按玩家选择推进，不擅自替玩家行动",
    ]
    if "偷听心声" in text and "关" in inner_text:
        directives.append("偷听心声已关闭，不要向玩家展示角色内心独白")

    persona_parts = []
    if status_text:
        persona_parts.append("【角色状态栏】\n" + status_text)
    if inner_text:
        persona_parts.append("【角色内心与选项】\n" + inner_text)
    if memory_text:
        persona_parts.append("【记忆区】\n" + memory_text)
    if body:
        persona_parts.append("【正文场景】\n" + body[:3000])
    persona = "\n\n".join(persona_parts)

    worldbook_entries = _env_entries(env_text)
    if status_text:
        worldbook_entries.append(
            {
                "title": "角色状态栏",
                "keywords": ["状态", "身份", "性格", "关系", "接受度"],
                "content": status_text,
                "priority": 50,
                "enabled": True,
            }
        )
    if memory_text:
        worldbook_entries.append(
            {
                "title": "记忆区",
                "keywords": ["记忆", "回忆", "过去"],
                "content": memory_text,
                "priority": 20,
                "enabled": True,
            }
        )
    if inner_text:
        worldbook_entries.append(
            {
                "title": "角色心声",
                "keywords": ["心声", "内心", "想法", "独白"],
                "content": inner_text,
                "priority": 10,
                "enabled": True,
            }
        )

    tags = ["20+", "角色扮演", "自定义"]
    if any(keyword in text for keyword in ("现代", "都市", "酒吧", "公寓", "大学")):
        tags.append("现代")
    if any(keyword in text for keyword in ("包养", "合约", "金主")):
        tags.append("包养")

    card = {
        "name": name,
        "persona": persona,
        "personality": "按文本卡设定，细腻描写角色心理与身体反应",
        "speaking_style": "小说式旁白，穿插角色内心独白与状态变化",
        "relationships": {"玩家": "按文本卡中的关系设定推进"},
        "directives": directives,
        "initial_state": {
            "attributes": _parse_attributes(status_text),
            "items": [],
            "relations": {},
            "money": 100,
            "quests": [],
            "flags": [],
        },
        "source": "text-import",
    }
    worldbook = {
        "title": f"{title} 世界设定",
        "description": description,
    }
    work = {
        "title": title,
        "description": description,
        "opening": opening,
        "tags": tags,
    }
    return {
        "card": card,
        "worldbook": worldbook,
        "worldbook_entries": worldbook_entries,
        "work": work,
    }
