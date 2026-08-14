# -*- coding: utf-8 -*-
"""后端接口冒烟测试。

要求服务已启动在 http://127.0.0.1:8000。
覆盖：健康检查、CRUD、mock 流式对话、结构化状态变化、/roll、存档读档。
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar

BASE_URL = "http://127.0.0.1:8000"
SUFFIX = str(int(time.time()))
USERNAME = f"smoke_{SUFFIX}"
PASSWORD = "smoke-test-password-2026"
COOKIE_JAR = http.cookiejar.CookieJar()


def request(method, path, payload=None):
    """发送 JSON 请求并解析响应。"""
    url = BASE_URL + path
    data = None
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            body = response.read()
            if response.status == 204:
                return None
            return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {path} 失败：HTTP {exc.code} {body}") from exc


def chat(path, content):
    """调用流式对话接口并解析 SSE 事件。"""
    url = BASE_URL + path
    data = json.dumps({"content": content}, ensure_ascii=False).encode("utf-8")
    csrf_token = next(
        (cookie.value for cookie in COOKIE_JAR if cookie.name == "neko_csrf"),
        None,
    )
    headers = {"Content-Type": "application/json; charset=utf-8", "Origin": BASE_URL}
    if csrf_token:
        headers["X-CSRF-Token"] = csrf_token
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
    with opener.open(req) as response:
        raw = response.read().decode("utf-8")
    events = []
    current_event = None
    for line in raw.splitlines():
        if line.startswith("event: "):
            current_event = line[7:].strip()
        elif line.startswith("data: ") and current_event:
            events.append(
                {
                    "event": current_event,
                    "data": json.loads(line[6:]),
                }
            )
    return events


def authenticated_request(method, path, payload=None):
    """Send an authenticated request with the current CSRF double-submit token."""
    token = next(
        (cookie.value for cookie in COOKIE_JAR if cookie.name == "neko_csrf"),
        None,
    )
    url = BASE_URL + path
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8", "Origin": BASE_URL}
    if token:
        headers["X-CSRF-Token"] = token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))
    try:
        with opener.open(req) as response:
            if response.status == 204:
                return None
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {path} 失败：HTTP {exc.code} {body}") from exc


def assert_true(condition, message):
    """测试断言。"""
    if not condition:
        raise AssertionError(message)


def main():
    """执行冒烟测试并打印结果。"""
    results = []

    def check(name, callback):
        try:
            value = callback()
            results.append((name, True, ""))
            return value
        except Exception as exc:
            results.append((name, False, str(exc)))
            print(f"[FAIL] {name}: {exc}")
            return None

    health = check("健康检查", lambda: request("GET", "/api/health"))
    assert_true(health and health.get("status") == "ok", "健康检查未返回 ok")

    csrf = check("读取 CSRF", lambda: authenticated_request("GET", "/api/auth/csrf"))
    assert_true(csrf and csrf.get("csrf_token"), "CSRF 初始化失败")
    account = check(
        "注册冒烟账号",
        lambda: authenticated_request(
            "POST", "/api/auth/register", {"username": USERNAME, "password": PASSWORD}
        ),
    )
    assert_true(account and account.get("authenticated"), "账号注册失败")

    config = check("读取个人配置", lambda: authenticated_request("GET", "/api/config"))
    assert_true(
        config and "api_key_set" in config and "api_key_unreadable" in config,
        "配置未返回 api_key_set/api_key_unreadable",
    )

    card = check("创建角色卡", lambda: authenticated_request(
        "POST",
        "/api/cards",
        {
            "name": f"测试角色{SUFFIX}",
            "persona": "冷峻而寡言的边境守夜人",
            "personality": "谨慎、忠诚",
            "speaking_style": "简短有力",
            "relationships": {"玩家": "暂时同行的陌生人"},
            "directives": ["保持人设", "不主动告白"],
            "initial_state": {
                "attributes": {"魅力": 60, "武力": 40},
                "items": ["旧钥匙"],
                "money": 100,
                "relations": {"艾琳": "同伴"},
            },
        },
    ))
    assert_true(card and card.get("id"), "角色卡创建失败")

    card_detail = check("读取角色卡详情", lambda: authenticated_request(
        "GET",
        f"/api/cards/{card['id']}",
    ))
    assert_true(
        card_detail and card_detail["name"] == card["name"],
        "角色卡详情读取失败",
    )

    card_updated = check("更新角色卡", lambda: authenticated_request(
        "PUT",
        f"/api/cards/{card['id']}",
        {"persona": "更新后的守夜人人设"},
    ))
    assert_true(
        card_updated and card_updated["persona"] == "更新后的守夜人人设",
        "角色卡更新失败",
    )

    worldbook = check("创建世界书", lambda: authenticated_request(
        "POST",
        "/api/worldbooks",
        {"title": f"测试世界{SUFFIX}", "description": "边境王城的夜间设定"},
    ))
    assert_true(worldbook and worldbook.get("id"), "世界书创建失败")

    worldbook_detail = check("读取世界书详情", lambda: authenticated_request(
        "GET",
        f"/api/worldbooks/{worldbook['id']}",
    ))
    assert_true(
        worldbook_detail and worldbook_detail["title"] == worldbook["title"],
        "世界书详情读取失败",
    )

    worldbook_updated = check("更新世界书", lambda: authenticated_request(
        "PUT",
        f"/api/worldbooks/{worldbook['id']}",
        {"description": "更新后的边境王城设定"},
    ))
    assert_true(
        worldbook_updated and worldbook_updated["description"].startswith("更新后"),
        "世界书更新失败",
    )

    entry = check("创建世界书条目", lambda: authenticated_request(
        "POST",
        f"/api/worldbooks/{worldbook['id']}/entries",
        {
            "title": "王城旧门",
            "keywords": ["王城", "旧门"],
            "content": "旧门由黑铁铸造，推开时会发出低沉声响。",
            "priority": 10,
        },
    ))
    assert_true(entry and entry.get("id"), "世界书条目创建失败")

    entry_updated = check("更新世界书条目", lambda: authenticated_request(
        "PUT",
        f"/api/worldbooks/{worldbook['id']}/entries/{entry['id']}",
        {"priority": 20, "content": "旧门由黑铁铸造，推开时会发出低沉的警示声。"},
    ))
    assert_true(
        entry_updated and entry_updated["priority"] == 20,
        "世界书条目更新失败",
    )

    entry_list = check("世界书条目列表", lambda: authenticated_request(
        "GET",
        f"/api/worldbooks/{worldbook['id']}/entries",
    ))
    assert_true(entry_list and entry_list["total"] >= 1, "世界书条目列表失败")

    work = check("创建作品", lambda: authenticated_request(
        "POST",
        "/api/works",
        {
            "title": f"测试冒险{SUFFIX}",
            "description": "用于后端联调的作品",
            "player_attributes": {"魅力": 60, "武力": 40},
            "card_id": card["id"],
            "worldbook_id": worldbook["id"],
            "opening": "深夜，你站在王城外的旧门前，风里夹着铁锈味。",
            "tags": ["20+", "测试"],
        },
    ))
    assert_true(work and work.get("id"), "作品创建失败")

    works = check("作品搜索", lambda: authenticated_request(
        "GET",
        f"/api/works?q={urllib.parse.quote(f'测试冒险{SUFFIX}')}",
    ))
    assert_true(works and works["total"] >= 1, "作品搜索失败")

    updated_work = check("更新作品", lambda: authenticated_request(
        "PUT",
        f"/api/works/{work['id']}",
        {"description": "已更新简介"},
    ))
    assert_true(
        updated_work and updated_work["description"] == "已更新简介",
        "作品更新失败",
    )

    conversation = check("创建会话", lambda: authenticated_request(
        "POST",
        "/api/conversations",
        {"work_id": work["id"], "title": "联调冒险"},
    ))
    assert_true(conversation and conversation.get("id"), "会话创建失败")

    onboarding = check("完成开局设定", lambda: authenticated_request(
        "POST",
        f"/api/conversations/{conversation['id']}/onboarding",
        {"answers": {}},
    ))
    assert_true(
        onboarding and onboarding.get("onboarding_status") == "completed",
        "开局设定未完成",
    )

    state = check("读取初始状态", lambda: authenticated_request(
        "GET",
        f"/api/conversations/{conversation['id']}/state",
    ))
    assert_true(state and state["attributes"]["魅力"] == 60, "初始状态错误")

    events = check("mock 流式对话", lambda: chat(
        f"/api/conversations/{conversation['id']}/chat",
        "我捡到旧钥匙并得到10金币",
    ))
    if events:
        delta_text = "".join(
            item["data"]["content"]
            for item in events
            if item["event"] == "delta"
        )
        assert_true("本地模拟回复" in delta_text, "mock 对话未返回模拟文本")
        assert_true(any(item["event"] == "done" for item in events), "对话缺少 done")

    state = check("校验结构化状态变化", lambda: authenticated_request(
        "GET",
        f"/api/conversations/{conversation['id']}/state",
    ))
    if state:
        assert_true("旧钥匙" in state["items"], "状态未写入物品")
        assert_true(state["money"] == 10, "状态未写入金钱变化")

    messages = check("读取对话历史", lambda: authenticated_request(
        "GET",
        f"/api/conversations/{conversation['id']}/messages",
    ))
    assert_true(messages and len(messages) >= 3, "对话历史读取失败")

    roll_events = check("/掷骰 指令", lambda: chat(
        f"/api/conversations/{conversation['id']}/chat",
        "/掷骰 2d6+3",
    ))
    if roll_events:
        roll_text = "".join(
            item["data"]["content"]
            for item in roll_events
            if item["event"] == "delta"
        )
        assert_true("未知指令" in roll_text, "手动掷骰指令未被拒绝")

    judge_events = check("自动攻击判定", lambda: chat(
        f"/api/conversations/{conversation['id']}/chat",
        "我攻击守卫",
    ))
    if judge_events:
        judge_text = "".join(
            item["data"]["content"]
            for item in judge_events
            if item["event"] == "delta"
        )
        assert_true("骰子判定" in judge_text, "AI 攻击未触发自动判定")

    snapshot = check("手动存档", lambda: authenticated_request(
        "POST",
        f"/api/conversations/{conversation['id']}/snapshots",
        {"name": "测试存档", "note": "冒烟测试"},
    ))
    assert_true(snapshot and snapshot.get("id"), "手动存档失败")

    check("修改状态用于读档验证", lambda: authenticated_request(
        "PUT",
        f"/api/conversations/{conversation['id']}/state",
        {"money": 55},
    ))

    restore = check("读档恢复", lambda: authenticated_request(
        "POST",
        f"/api/conversations/{conversation['id']}/snapshots/{snapshot['id']}/restore",
    ))
    if restore:
        assert_true(restore["state"]["money"] == 10, "读档未恢复存档状态")

    state = check("读档后状态查询", lambda: authenticated_request(
        "GET",
        f"/api/conversations/{conversation['id']}/state",
    ))
    if state:
        assert_true(state["money"] == 10, "读档后实时状态未恢复")

    check("删除会话", lambda: authenticated_request(
        "DELETE",
        f"/api/conversations/{conversation['id']}",
    ))
    check("删除作品", lambda: authenticated_request("DELETE", f"/api/works/{work['id']}"))
    check("删除世界书", lambda: authenticated_request(
        "DELETE",
        f"/api/worldbooks/{worldbook['id']}",
    ))
    check("删除角色卡", lambda: authenticated_request("DELETE", f"/api/cards/{card['id']}"))

    print("\n=== 冒烟测试结果 ===")
    passed = 0
    for name, ok, message in results:
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}" + (f"：{message}" if message else ""))
        passed += int(ok)
    print(f"通过 {passed}/{len(results)}")
    if passed != len(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
