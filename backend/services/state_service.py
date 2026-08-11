# -*- coding: utf-8 -*-
"""状态系统：读取、局部更新、结构化状态变化应用与持久化。"""

import copy
import json

from .. import repositories


def get_state(conversation_id):
    """返回会话完整状态。"""
    state = repositories.get_state(conversation_id)
    if state.get("characters"):
        return state
    conversation = repositories.get_conversation(conversation_id)
    cards = repositories.get_conversation_cards(conversation)
    characters = repositories._initial_character_states(cards, state)
    if not characters:
        return state
    state["characters"] = characters
    return repositories.save_state(conversation_id, state)


def _json_key(value):
    """生成用于去重的稳定键。"""
    return json.dumps(value, ensure_ascii=False, default=str, sort_keys=True)


def _apply_dict_delta(target, value):
    """合并属性或关系字典，支持 +5/-3 这类相对数值。"""
    changed = False
    for key, item_value in (value or {}).items():
        old_value = target.get(key)
        new_value = item_value
        if (
            isinstance(item_value, str)
            and item_value[:1] in ("+", "-")
            and isinstance(old_value, (int, float))
        ):
            try:
                new_value = old_value + float(item_value)
            except ValueError:
                new_value = item_value
        if old_value != new_value:
            target[key] = new_value
            changed = True
    return changed


def _merge_items(current, value):
    """合并物品列表，支持纯列表或 add/remove/set 结构。"""
    current = list(current)
    existing_keys = {_json_key(item) for item in current}
    if isinstance(value, list):
        for item in value:
            key = _json_key(item)
            if key not in existing_keys:
                current.append(item)
                existing_keys.add(key)
    elif isinstance(value, dict):
        for item in value.get("add", []):
            key = _json_key(item)
            if key not in existing_keys:
                current.append(item)
                existing_keys.add(key)
        for item in value.get("set", []):
            key = _json_key(item)
            current = [old for old in current if _json_key(old) != key]
            current.append(item)
            existing_keys.add(key)
        remove_keys = {_json_key(item) for item in value.get("remove", [])}
        if remove_keys:
            current = [
                item for item in current if _json_key(item) not in remove_keys
            ]
    return current


def _quest_key(quest):
    """任务合并使用 title 或 id 作为主键。"""
    if isinstance(quest, dict):
        return str(quest.get("title") or quest.get("id") or _json_key(quest))
    return str(quest)


def _merge_quests(current, value):
    """合并任务列表，支持 add/update/remove/set。"""
    current = list(current)

    def upsert(quest):
        key = _quest_key(quest)
        for index, existing in enumerate(current):
            if _quest_key(existing) == key:
                if isinstance(existing, dict) and isinstance(quest, dict):
                    current[index] = {**existing, **quest}
                return
        current.append(quest)

    if isinstance(value, list):
        for quest in value:
            upsert(quest)
    elif isinstance(value, dict):
        for quest in value.get("add", []):
            upsert(quest)
        for quest in value.get("update", []):
            key = _quest_key(quest)
            for index, existing in enumerate(current):
                if _quest_key(existing) == key:
                    if isinstance(existing, dict) and isinstance(quest, dict):
                        current[index] = {**existing, **quest}
                    break
            else:
                current.append(quest)
        remove_keys = {_quest_key(quest) for quest in value.get("remove", [])}
        if remove_keys:
            current = [
                quest for quest in current if _quest_key(quest) not in remove_keys
            ]
        if "set" in value:
            current = []
            for quest in value["set"]:
                current.append(quest)
    return current


def _merge_flags(current, value):
    """合并状态标记。"""
    current = list(current)
    if isinstance(value, list):
        for flag in value:
            if flag not in current:
                current.append(flag)
    elif isinstance(value, dict):
        for flag in value.get("add", []):
            if flag not in current:
                current.append(flag)
        remove_set = set(value.get("remove", []))
        if remove_set:
            current = [flag for flag in current if flag not in remove_set]
        if "set" in value:
            current = list(value["set"])
    return current


def _append_logs(current, value):
    """追加日志并限制条数，避免无限膨胀。"""
    current = list(current)
    if isinstance(value, str):
        current.append(value)
    elif isinstance(value, list):
        current.extend(value)
    return current[-200:]


def _merge_characters(current, value):
    characters = copy.deepcopy(current or {})
    changed = False
    for name, patch in (value or {}).items():
        if not isinstance(patch, dict):
            continue
        profile = characters.setdefault(str(name), {"attributes": {}, "flags": []})
        if isinstance(patch.get("attributes"), dict):
            attributes = profile.setdefault("attributes", {})
            if _apply_dict_delta(attributes, patch["attributes"]):
                changed = True
        if "flags" in patch:
            flags = _merge_flags(profile.get("flags", []), patch["flags"])
            if _json_key(flags) != _json_key(profile.get("flags", [])):
                profile["flags"] = flags
                changed = True
    return characters, changed


def format_state_delta_for_player(delta):
    """把 AI 的结构化状态变化转换为可直接展示在对话中的简短摘要。"""
    if not isinstance(delta, dict):
        return ""

    lines = []
    for key, value in (delta.get("attributes") or {}).items():
        if isinstance(value, str) and value[:1] in ("+", "-"):
            lines.append(f"{key} {value}")
        else:
            lines.append(f"{key} → {value}")

    if "money" in delta:
        value = delta["money"]
        if isinstance(value, str) and value[:1] in ("+", "-"):
            lines.append(f"金钱 {value}")
        else:
            lines.append(f"金钱 → {value}")

    items = delta.get("items")
    if isinstance(items, list):
        items = {"add": items}
    if isinstance(items, dict):
        lines.extend(f"获得：{item}" for item in items.get("add", []))
        lines.extend(f"失去：{item}" for item in items.get("remove", []))

    flags = delta.get("flags")
    if isinstance(flags, list):
        flags = {"add": flags}
    if isinstance(flags, dict):
        lines.extend(f"新增状态：{flag}" for flag in flags.get("add", []))
        lines.extend(f"移除状态：{flag}" for flag in flags.get("remove", []))

    for name, profile in (delta.get("characters") or {}).items():
        if not isinstance(profile, dict):
            continue
        for key, value in (profile.get("attributes") or {}).items():
            text = f"{name}·{key} {value}" if isinstance(value, str) and value[:1] in ("+", "-") else f"{name}·{key} → {value}"
            lines.append(text)
        character_flags = profile.get("flags") or {}
        if isinstance(character_flags, list):
            character_flags = {"add": character_flags}
        if isinstance(character_flags, dict):
            lines.extend(f"{name}新增状态：{flag}" for flag in character_flags.get("add", []))
            lines.extend(f"{name}移除状态：{flag}" for flag in character_flags.get("remove", []))

    if not lines:
        return ""
    return "\n\n【状态变化】\n" + "\n".join(f"- {line}" for line in lines)


def merge_state(current, delta):
    """把状态变化合并进当前状态，返回新状态和变化字段集合。"""
    new_state = copy.deepcopy(current)
    changed = set()

    for key in ("attributes", "relations"):
        if key in delta and isinstance(delta.get(key), dict):
            target = new_state.setdefault(key, {})
            if _apply_dict_delta(target, delta[key]):
                changed.add(key)

    if "money" in delta:
        value = delta["money"]
        if isinstance(value, str) and value[:1] in ("+", "-") and isinstance(
            new_state.get("money"), (int, float)
        ):
            try:
                new_value = new_state["money"] + float(value)
            except ValueError:
                new_value = value
        else:
            new_value = value
        if new_state.get("money") != new_value:
            new_state["money"] = new_value
            changed.add("money")

    if "items" in delta:
        merged = _merge_items(new_state.get("items", []), delta["items"])
        if _json_key(merged) != _json_key(new_state.get("items", [])):
            new_state["items"] = merged
            changed.add("items")

    if "quests" in delta:
        merged = _merge_quests(new_state.get("quests", []), delta["quests"])
        if _json_key(merged) != _json_key(new_state.get("quests", [])):
            new_state["quests"] = merged
            changed.add("quests")

    if "flags" in delta:
        merged = _merge_flags(new_state.get("flags", []), delta["flags"])
        if _json_key(merged) != _json_key(new_state.get("flags", [])):
            new_state["flags"] = merged
            changed.add("flags")

    if "characters" in delta and isinstance(delta.get("characters"), dict):
        merged, character_changed = _merge_characters(
            new_state.get("characters", {}), delta["characters"]
        )
        if character_changed:
            new_state["characters"] = merged
            changed.add("characters")

    if "logs" in delta:
        new_state["logs"] = _append_logs(new_state.get("logs", []), delta["logs"])
        changed.add("logs")

    return new_state, changed


def apply_state_delta(conversation_id, delta, source="AI"):
    """解析并持久化 AI 结构化状态变化。"""
    if not isinstance(delta, dict) or not delta:
        return get_state(conversation_id)
    current = get_state(conversation_id)
    new_state, changed = merge_state(current, delta)
    if changed and not delta.get("logs"):
        new_state["logs"] = _append_logs(
            new_state.get("logs", []),
            [
                {
                    "type": "state_update",
                    "source": source,
                    "keys": sorted(changed),
                }
            ],
        )
    if changed:
        return repositories.save_state(conversation_id, new_state)
    return current


def update_state(conversation_id, payload):
    """接口局部更新状态。"""
    current = get_state(conversation_id)
    new_state, changed = merge_state(current, payload)
    if changed:
        return repositories.save_state(conversation_id, new_state)
    return current
