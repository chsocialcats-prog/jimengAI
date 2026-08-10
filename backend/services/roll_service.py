# -*- coding: utf-8 -*-
"""判定系统：骰子解析、随机投掷、大成功/大失败与结果写回。"""

import random
import re

from .. import repositories
from ..database import now_str
from . import state_service

ROLL_PATTERN = re.compile(
    r"^(?P<count>\d*)d(?P<sides>\d+)(?P<modifier>[+-]\d+)?$",
    re.IGNORECASE,
)


def parse_roll_expression(text):
    """解析 1d20、2d6+3、d8 等骰子表达式。"""
    raw = (text or "").strip().lower().replace(" ", "")
    match = ROLL_PATTERN.match(raw)
    if not match:
        raise ValueError("骰子表达式格式应为 1d20、2d6+3 或 d20")
    count = int(match.group("count") or 1)
    sides = int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)
    if count < 1 or count > 100:
        raise ValueError("骰子数量必须在 1 到 100 之间")
    if sides < 2 or sides > 1000:
        raise ValueError("骰子面数必须在 2 到 1000 之间")
    expression = f"{count}d{sides}"
    if modifier:
        expression += f"{modifier:+d}"
    return {
        "count": count,
        "sides": sides,
        "modifier": modifier,
        "expression": expression,
    }


def roll_dice(text):
    """投掷骰子并返回详细结果。"""
    parsed = parse_roll_expression(text)
    rolls = [random.randint(1, parsed["sides"]) for _ in range(parsed["count"])]
    total = sum(rolls) + parsed["modifier"]
    if all(value == parsed["sides"] for value in rolls):
        critical_type = "大成功"
    elif all(value == 1 for value in rolls):
        critical_type = "大失败"
    else:
        critical_type = "普通"
    return {
        **parsed,
        "rolls": rolls,
        "total": total,
        "critical_type": critical_type,
    }


def judge_roll(roll, target=None):
    """根据目标和骰子结果判定成功/失败。"""
    if target is None:
        return "未判定"
    if roll["critical_type"] == "大成功":
        return "成功（大成功）"
    if roll["critical_type"] == "大失败":
        return "失败（大失败）"
    return "成功" if roll["total"] >= target else "失败"


def format_roll_result(roll, target=None, attribute=None, reason=""):
    """生成展示给玩家和写入对话的中文判定文本。"""
    lines = [f"骰子判定：{roll['expression']} → {roll['total']}"]
    if roll["rolls"]:
        lines.append("明细：" + "、".join(str(value) for value in roll["rolls"]))
    if roll["modifier"]:
        lines.append(f"调整值：{roll['modifier']:+d}")
    if roll["critical_type"] != "普通":
        lines.append(f"特殊结果：{roll['critical_type']}")
    if target is not None:
        lines.append(f"目标难度：{target}")
        if attribute:
            lines.append(f"判定属性：{attribute}")
        lines.append(f"判定结果：{judge_roll(roll, target)}")
    if reason:
        lines.append(f"判定原因：{reason}")
    return "\n".join(lines)


def perform_roll(
    conversation_id,
    dice="1d20",
    target=None,
    attribute=None,
    reason="",
):
    """执行骰子判定并把结果写入状态日志，不直接创建消息。"""
    roll = roll_dice(dice)
    roll["target"] = target
    roll["attribute"] = attribute
    roll["outcome"] = judge_roll(roll, target)
    content = format_roll_result(roll, target, attribute, reason)
    metadata = {
        "kind": "roll",
        "expression": roll["expression"],
        "rolls": roll["rolls"],
        "total": roll["total"],
        "target": target,
        "attribute": attribute,
        "outcome": roll["outcome"],
        "critical_type": roll["critical_type"],
    }
    state_service.apply_state_delta(
        conversation_id,
        {
            "logs": [
                {
                    "type": "roll",
                    "expression": roll["expression"],
                    "rolls": roll["rolls"],
                    "total": roll["total"],
                    "target": target,
                    "attribute": attribute,
                    "outcome": roll["outcome"],
                    "critical_type": roll["critical_type"],
                    "created_at": now_str(),
                }
            ]
        },
        source="判定系统",
    )
    return {
        "content": content,
        "metadata": metadata,
        "roll": roll,
    }


def record_roll(
    conversation_id,
    dice="1d20",
    target=None,
    attribute=None,
    reason="",
):
    """执行骰子判定并把结果写回消息、状态日志和存档。"""
    result = perform_roll(
        conversation_id,
        dice=dice,
        target=target,
        attribute=attribute,
        reason=reason,
    )
    return repositories.create_message(
        conversation_id,
        "assistant",
        result["content"],
        metadata=result["metadata"],
        token_count=0,
    )


def record_judge(conversation_id, judge_block):
    """解析 AI 结构化判定块并执行一次骰子判定。"""
    if not isinstance(judge_block, dict):
        return None
    return record_roll(
        conversation_id,
        dice=str(judge_block.get("dice") or "1d20"),
        target=judge_block.get("target"),
        attribute=judge_block.get("attribute"),
        reason=str(judge_block.get("reason") or ""),
    )


def perform_judge(conversation_id, judge_block):
    """解析 AI 结构化判定块，返回结果文本但不创建独立消息。"""
    if not isinstance(judge_block, dict):
        return None
    return perform_roll(
        conversation_id,
        dice=str(judge_block.get("dice") or "1d20"),
        target=judge_block.get("target"),
        attribute=judge_block.get("attribute"),
        reason=str(judge_block.get("reason") or ""),
    )
