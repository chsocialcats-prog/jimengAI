# -*- coding: utf-8 -*-
"""流式对话 SSE 与停止接口。"""

import threading

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from .. import repositories
from ..ai.deepseek_client import (
    DeepSeekError,
    create_client,
    estimate_tokens,
)
from ..config import load_config
from ..schemas import ChatRequest
from ..services import (
    adventure_engine,
    commands,
    context_service,
    reply_length,
    roll_service,
    snapshot_service,
    state_service,
)
from ..sse import sse

router = APIRouter(prefix="/api/conversations", tags=["流式对话"])
_activity_registry_init_lock = threading.Lock()


def _chat_activity(app):
    """Return the lock and active conversation set shared by this app instance."""
    lock = getattr(app.state, "chat_activity_lock", None)
    if lock is None:
        with _activity_registry_init_lock:
            lock = getattr(app.state, "chat_activity_lock", None)
            if lock is None:
                lock = threading.Lock()
                app.state.chat_activity_lock = lock
                app.state.active_chat_conversations = set()
    return lock, app.state.active_chat_conversations


def _claim_chat_activity(app, conversation_id):
    """Atomically reserve a conversation for one chat stream."""
    lock, active_conversations = _chat_activity(app)
    key = str(conversation_id)
    with lock:
        if key in active_conversations:
            return False
        active_conversations.add(key)
        return True


def _release_chat_activity(app, conversation_id):
    """Release a chat stream reservation after its generator finishes or closes."""
    lock, active_conversations = _chat_activity(app)
    with lock:
        active_conversations.discard(str(conversation_id))


def _stream_with_activity_release(app, conversation_id, content, client_metadata, stop_event):
    """Ensure every normal, failed, or cancelled stream releases its reservation."""
    try:
        yield from _stream_chat(
            conversation_id,
            content,
            client_metadata,
            stop_event,
        )
    finally:
        _release_chat_activity(app, conversation_id)

def _get_conversation_or_404(conversation_id):
    conversation = repositories.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "冒险会话不存在"},
        )
    return conversation


def _get_stop_event(app, conversation_id):
    """每个会话对应一个停止事件，供 /stop 中断流式生成。"""
    events = getattr(app.state, "stop_events", None)
    if events is None:
        events = {}
        app.state.stop_events = events
    key = str(conversation_id)
    event = events.get(key)
    if event is None:
        event = threading.Event()
        events[key] = event
    return event


def _state_event(conversation_id):
    """生成契约中的 state 事件数据。"""
    state = state_service.get_state(conversation_id)
    return {
        "current_state": state,
        "attributes": state["attributes"],
        "items": state["items"],
        "quests": state["quests"],
        "flags": state["flags"],
    }


def _stream_chat(conversation_id, content, client_metadata, stop_event):
    """SSE 生成器：先写玩家消息，再按指令或 AI 客户端产出事件。"""
    repositories.create_message(
        conversation_id,
        "user",
        content,
        metadata={"kind": "chat", "client_metadata": client_metadata},
        token_count=estimate_tokens(content),
    )

    parsed_command = commands.parse_command(content)
    if parsed_command is not None:
        yield from _stream_command(
            conversation_id,
            content,
            stop_event,
        )
        return

    yield from _stream_ai_reply(
        conversation_id,
        stop_event,
        client_metadata,
    )


def _stream_command(conversation_id, content, stop_event):
    """执行快捷指令并返回 SSE 事件。"""
    try:
        result = commands.handle_command(conversation_id, content)
    except ValueError as exc:
        yield sse(
            "error",
            {"code": "validation_error", "message": str(exc)},
        )
        return

    message_id = result.get("metadata", {}).get("message_id")
    if message_id:
        assistant_message = repositories.get_message(message_id)
    else:
        assistant_message = repositories.create_message(
            conversation_id,
            "assistant",
            result["content"],
            metadata=result["metadata"],
            token_count=estimate_tokens(result["content"]),
        )

    yield sse(
        "meta",
        {
            "conversation_id": conversation_id,
            "message_id": assistant_message["id"],
        },
    )
    yield sse("delta", {"content": result["content"]})
    yield sse("state", _state_event(conversation_id))
    usage = {
        "prompt_tokens": 0,
        "completion_tokens": estimate_tokens(result["content"]),
        "total_tokens": estimate_tokens(result["content"]),
    }
    yield sse(
        "done",
        {
            "message_id": assistant_message["id"],
            "usage": usage,
        },
    )


def _stream_ai_reply(conversation_id, stop_event, client_metadata=None):
    """调用 DeepSeek 或 mock 客户端并流式输出清洗后的剧情。"""
    config = load_config()
    inspection = context_service.inspect_context(conversation_id, config)
    if inspection.needs_compression:
        yield sse("context", {"status": "compressing"})
    prepared = context_service.prepare_context(
        conversation_id,
        config,
        inspection=inspection,
    )
    if prepared.compressed:
        yield sse(
            "context",
            {
                "status": "compressed" if prepared.method == "ai" else "fallback",
                "before_tokens": prepared.prompt_tokens_before,
                "after_tokens": prepared.prompt_tokens_after,
                "method": prepared.method,
            },
        )
    elif inspection.needs_compression:
        yield sse(
            "context",
            {
                "status": "fallback",
                "before_tokens": prepared.prompt_tokens_before,
                "after_tokens": prepared.prompt_tokens_after,
                "method": prepared.method or "local",
            },
        )
    reply_settings = reply_length.resolve_reply_length(
        client_metadata,
        config.get("generation", {}).get("max_tokens", 2048),
    )
    messages = reply_length.append_reply_length_instruction(
        prepared.messages,
        reply_settings["key"],
    )
    prompt_tokens = prepared.prompt_tokens_after
    assistant_message = repositories.create_message(
        conversation_id,
        "assistant",
        "",
        metadata={"status": "streaming"},
    )
    yield sse(
        "meta",
        {
            "conversation_id": conversation_id,
            "message_id": assistant_message["id"],
        },
    )

    client = create_client(config)
    output_filter = adventure_engine.StructuredOutputFilter()
    emitted = ""
    usage = None
    stopped = False

    try:
        if reply_settings["key"] is None:
            stream = client.stream_chat(messages)
        else:
            stream = client.stream_chat(
                messages,
                max_tokens=reply_settings["max_tokens"],
            )
        for event in stream:
            if stop_event.is_set():
                stopped = True
                break
            if event["type"] == "usage":
                usage = event.get("usage")
            elif event["type"] == "delta":
                chunk = event.get("content") or ""
                if not chunk:
                    continue
                visible = output_filter.feed(chunk)
                if visible:
                    emitted += visible
                    yield sse("delta", {"content": visible})
        if stop_event.is_set():
            stopped = True

        tail, state_delta, judge_block, options = output_filter.finish()
        if tail:
            emitted += tail
            yield sse("delta", {"content": tail})

        latest_user_text = next(
            (
                message.get("content", "")
                for message in reversed(messages)
                if message.get("role") == "user"
            ),
            "",
        )
        if not options and not stopped:
            options = adventure_engine.parse_visible_options(emitted)
        if not options and not stopped:
            options = adventure_engine.default_turn_options(emitted, latest_user_text)

        visible_state_fallback = False
        if state_delta is None:
            state_delta = adventure_engine.parse_visible_state_delta(emitted)
            visible_state_fallback = state_delta is not None
        if state_delta is None and not stopped:
            state_delta = adventure_engine.default_turn_state_delta(
                state_service.get_state(conversation_id), latest_user_text
            )

        if stopped:
            stop_marker = "\n（回复已停止）"
            emitted += stop_marker
            yield sse("delta", {"content": stop_marker})

        if state_delta:
            state_service.apply_state_delta(
                conversation_id,
                state_delta,
                source=config["deepseek"]["model"] if config["deepseek"].get("api_key") else "mock",
            )
            if not visible_state_fallback:
                state_notice = state_service.format_state_delta_for_player(state_delta)
                if state_notice:
                    emitted += state_notice
                    yield sse("delta", {"content": state_notice})

        judge_result = None
        if judge_block:
            try:
                judge_result = roll_service.perform_judge(
                    conversation_id, judge_block
                )
            except ValueError as exc:
                state_service.apply_state_delta(
                    conversation_id,
                    {"logs": [{"type": "judge_error", "message": str(exc)}]},
                    source="判定系统",
                )
            if judge_result:
                emitted += "\n" + judge_result["content"]
                yield sse("delta", {"content": "\n" + judge_result["content"]})

        completion_tokens = estimate_tokens(emitted)
        if usage:
            provider_prompt_tokens = usage.get("prompt_tokens")
            provider_completion_tokens = usage.get("completion_tokens")
            if provider_prompt_tokens is not None:
                prompt_tokens = provider_prompt_tokens
            if provider_completion_tokens is not None:
                completion_tokens = provider_completion_tokens

        metadata = {
            "kind": "assistant",
            "source": "mock" if not config["deepseek"].get("api_key") else "deepseek",
            "status": "stopped" if stopped else "done",
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "state_delta": state_delta,
            "judge": judge_result["roll"] if judge_result else None,
            "options": options or [],
        }
        repositories.update_message(
            assistant_message["id"],
            content=emitted,
            metadata=metadata,
            token_count=completion_tokens,
        )
        snapshot_service.autosave(conversation_id, note="流式回复后自动存档")
        yield sse("state", _state_event(conversation_id))
        yield sse(
            "done",
            {
                "message_id": assistant_message["id"],
                "usage": metadata["usage"],
                "options": metadata["options"],
            },
        )
    except DeepSeekError as exc:
        repositories.update_message(
            assistant_message["id"],
            content=emitted,
            metadata={"status": "error", "error": str(exc)},
            token_count=estimate_tokens(emitted),
        )
        yield sse(
            "error",
            {"code": "api_error", "message": "DeepSeek 请求失败"},
        )
    finally:
        current = repositories.get_message(assistant_message["id"])
        if current and current.get("metadata", {}).get("status") == "streaming":
            repositories.update_message(
                assistant_message["id"],
                content=emitted or "",
                metadata={"status": "interrupted"},
                token_count=estimate_tokens(emitted),
            )
        stop_event.clear()


@router.post("/{conversation_id}/chat", summary="流式对话")
def chat(conversation_id: int, payload: ChatRequest, request: Request):
    """按契约返回 text/event-stream，包含 meta/delta/state/done。"""
    conversation = _get_conversation_or_404(conversation_id)
    if conversation.get("onboarding_status") == "pending":
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "请先完成开局设定"},
        )
    if not _claim_chat_activity(request.app, conversation_id):
        raise HTTPException(
            status_code=409,
            detail={"code": "conflict", "message": "该会话正在生成回复"},
        )
    stop_event = _get_stop_event(request.app, conversation_id)
    stop_event.clear()
    return StreamingResponse(
        _stream_with_activity_release(
            request.app,
            conversation_id,
            payload.content,
            payload.metadata,
            stop_event,
        ),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{conversation_id}/stop", status_code=204, summary="停止当前回复")
def stop_chat(conversation_id: int, request: Request):
    """设置停止事件，当前流式生成会在下一个分片处结束。"""
    _get_conversation_or_404(conversation_id)
    _get_stop_event(request.app, conversation_id).set()
    return Response(status_code=204)
