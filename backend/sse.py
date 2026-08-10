# -*- coding: utf-8 -*-
"""SSE 事件格式化工具。"""

import json


def sse(event, data):
    """生成 text/event-stream 单条事件文本。"""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"
