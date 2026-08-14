# -*- coding: utf-8 -*-
"""流式对话 SSE 与停止接口。"""

import threading

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from ..ai.deepseek_client import (
    DeepSeekError,
    create_client,
    estimate_tokens,
)
from ..ai.request_policy import AIRequestPolicyError
from ..auth.dependencies import require_auth
from ..auth.types import AuthContext, ConversationAccess
from ..repository import conversation_repository
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
from ..services.user_ai_settings import EffectiveAIConfig
from ..sse import sse
from .settings_routes import _service as _get_user_ai_settings_service

router = APIRouter(prefix="/api/conversations", tags=["流式对话"])
_activity_registry_init_lock = threading.Lock()
_MAX_CONTINUATION_ATTEMPTS = 2


class _MockEffectiveAIConfig(EffectiveAIConfig):
    """Expose the frozen config to the legacy mock client's read-only view."""

    def __getitem__(self, key):
        if key == "deepseek":
            return {
                "base_url": self.base_url,
                "model": self.model,
                "api_key": self.api_key,
                "timeout_seconds": self.timeout_seconds,
            }
        if key == "generation":
            return self.generation
        raise KeyError(key)


def _client_config(config):
    """Keep the no-key mock deterministic without consulting global config."""
    if isinstance(config, EffectiveAIConfig) and not config.ai_enabled:
        return _MockEffectiveAIConfig(
            base_url=config.base_url,
            model=config.model,
            api_key=config.api_key,
            generation=config.generation,
            timeout_seconds=config.timeout_seconds,
            ai_enabled=config.ai_enabled,
            api_key_unreadable=config.api_key_unreadable,
        )
    return config


def _recover_missing_options(client, messages, narrative, stop_event=None):
    """Ask the configured model for scene-specific options when the first reply omits them."""
    if not str(narrative or "").strip():
        return None

    recovery_messages = [
        *messages,
        {"role": "assistant", "content": narrative},
        {
            "role": "user",
            "content": (
                "刚刚的剧情正文已经生成，但选项块缺失。请只根据这段刚刚完成的剧情，"
                "给出 2 到 4 个紧接当前场景、玩家可以直接执行的具体行动。"
                "不要补写剧情，不要解释，不要输出正文或代码围栏；不要使用通用占位选项。"
                "严格只输出一个结构化选项块："
                '<options>["行动一","行动二"]</options>'
            ),
        },
    ]
    output_filter = adventure_engine.StructuredOutputFilter()
    visible = ""
    try:
        for event in client.stream_chat(recovery_messages):
            if stop_event is not None and stop_event.is_set():
                return None
            if event.get("type") != "delta":
                continue
            visible += output_filter.feed(event.get("content") or "")
        if stop_event is not None and stop_event.is_set():
            return None
        tail, _, _, options = output_filter.finish()
        visible += tail
    except DeepSeekError:
        return None
    return options or adventure_engine.parse_visible_options(visible)


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


def _conversation_id(access):
    if not isinstance(access, ConversationAccess):
        raise TypeError("chat operations require ConversationAccess")
    return access.conversation["id"]


def _user_id(access):
    if not isinstance(access, ConversationAccess):
        raise TypeError("chat operations require ConversationAccess")
    return access.auth.user.id


def _claim_chat_activity(app, access):
    """Atomically reserve a conversation for one chat stream."""
    lock, active_conversations = _chat_activity(app)
    key = str(_conversation_id(access))
    with lock:
        if key in active_conversations:
            return False
        active_conversations.add(key)
        return True


def _release_chat_activity(app, access):
    """Release a chat stream reservation after its generator finishes or closes."""
    lock, active_conversations = _chat_activity(app)
    with lock:
        active_conversations.discard(str(_conversation_id(access)))


def _stream_with_activity_release(
    app,
    access,
    content,
    client_metadata,
    stop_event,
    effective_config,
    request_policy,
):
    """Ensure every normal, failed, or cancelled stream releases its reservation."""
    try:
        yield from _stream_chat(
            access,
            content,
            client_metadata,
            stop_event,
            effective_config,
            request_policy,
        )
    finally:
        _release_chat_activity(app, access)

def _get_conversation_or_404(conversation_id, auth):
    access = conversation_repository.require_conversation_owner(
        conversation_id, auth
    )
    if access is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "冒险会话不存在"},
        )
    return access


def _resolve_generation_config(request, auth):
    """Resolve and validate one immutable per-user generation snapshot."""
    service = _get_user_ai_settings_service(request)
    effective_config = service.resolve_for_user(auth.user.id)
    if effective_config.api_key_unreadable:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "api_key_unreadable",
                "message": "已保存的 API Key 无法读取",
            },
        )
    request_policy = service.request_policy
    if request_policy is not None:
        try:
            request_policy.validate_base_url(effective_config.base_url)
        except AIRequestPolicyError as exc:
            raise HTTPException(
                status_code=422,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
    return effective_config, request_policy


def _get_stop_event(app, access):
    """每个会话对应一个停止事件，供 /stop 中断流式生成。"""
    events = getattr(app.state, "stop_events", None)
    if events is None:
        events = {}
        app.state.stop_events = events
    key = str(_conversation_id(access))
    event = events.get(key)
    if event is None:
        event = threading.Event()
        events[key] = event
    return event


def _state_event(access):
    """生成契约中的 state 事件数据。"""
    state = state_service.get_state(access)
    return {
        "current_state": state,
        "attributes": state["attributes"],
        "items": state["items"],
        "quests": state["quests"],
        "flags": state["flags"],
    }


def _stream_chat(
    access,
    content,
    client_metadata,
    stop_event,
    effective_config,
    request_policy,
):
    """SSE 生成器：先写玩家消息，再按指令或 AI 客户端产出事件。"""
    conversation_id = _conversation_id(access)
    user_id = _user_id(access)
    conversation_repository.create_message(
        conversation_id,
        user_id,
        "user",
        content,
        metadata={"kind": "chat", "client_metadata": client_metadata},
        token_count=estimate_tokens(content),
    )

    parsed_command = commands.parse_command(content)
    if parsed_command is not None:
        yield from _stream_command(
            access,
            content,
            stop_event,
        )
        return

    yield from _stream_ai_reply(
        access,
        stop_event,
        client_metadata,
        effective_config,
        request_policy,
    )


def _stream_command(access, content, stop_event):
    """执行快捷指令并返回 SSE 事件。"""
    conversation_id = _conversation_id(access)
    user_id = _user_id(access)
    try:
        result = commands.handle_command(access, content)
    except ValueError as exc:
        yield sse(
            "error",
            {"code": "validation_error", "message": str(exc)},
        )
        return

    message_id = result.get("metadata", {}).get("message_id")
    if message_id:
        assistant_message = conversation_repository.get_message(message_id, user_id)
    else:
        assistant_message = conversation_repository.create_message(
            conversation_id,
            user_id,
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
    yield sse("state", _state_event(access))
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


def _stream_ai_reply(
    access,
    stop_event,
    client_metadata=None,
    effective_config=None,
    request_policy=None,
):
    """调用 DeepSeek 或 mock 客户端并流式输出清洗后的剧情。"""
    conversation_id = _conversation_id(access)
    user_id = _user_id(access)
    config = effective_config
    if not isinstance(config, EffectiveAIConfig):
        raise TypeError("_stream_ai_reply requires EffectiveAIConfig")
    if config.api_key_unreadable:
        yield sse(
            "error",
            {
                "code": "api_key_unreadable",
                "message": "已保存的 API Key 无法读取",
            },
        )
        return

    try:
        inspection = context_service.inspect_context(access, config)
        if inspection.needs_compression:
            yield sse("context", {"status": "compressing"})
        prepared = context_service.prepare_context(
            access,
            config,
            request_policy=request_policy,
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
            config.generation.get("max_tokens", 2048),
        )
        messages = reply_length.append_reply_length_instruction(
            prepared.messages,
            reply_settings["key"],
        )
        prompt_tokens = prepared.prompt_tokens_after
        # Construct the client before creating the assistant row. Policy failures
        # therefore remain an SSE error without an assistant side effect.
        client = create_client(_client_config(config), request_policy)
    except AIRequestPolicyError as exc:
        yield sse("error", {"code": exc.code, "message": exc.message})
        return

    assistant_message = conversation_repository.create_message(
        conversation_id,
        user_id,
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

    output_filter = adventure_engine.StructuredOutputFilter()
    emitted = ""
    usage = None
    stopped = False
    finish_reason = None
    continuation_failed = False

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
            elif event["type"] == "finish":
                finish_reason = event.get("finish_reason")
        if stop_event.is_set():
            stopped = True

        tail, state_delta, judge_block, options = output_filter.finish()
        if tail:
            emitted += tail
            yield sse("delta", {"content": tail})

        minimum_characters = int(reply_settings.get("min_characters", 0))
        for _ in range(_MAX_CONTINUATION_ATTEMPTS):
            current_characters = reply_length.count_reply_characters(emitted)
            if not (
                minimum_characters
                and current_characters < minimum_characters
                and not stopped
                and finish_reason in ("stop", "length")
                and config.ai_enabled
            ):
                break
            continuation_messages = [
                *messages,
                {"role": "assistant", "content": emitted},
                {
                    "role": "user",
                    "content": (
                        f"上一段可见正文只有 {current_characters} 个字，未达到最低 {minimum_characters} 个字。"
                        f"请从上一句自然接续，使整段回复达到 {minimum_characters} 至 "
                        f"{reply_settings.get('max_characters', minimum_characters)} 个可见中文字符；"
                        "只补充当前场景的环境、感官、动作、对话和情绪，不要重新开头、总结或重复；"
                        "不要推进新的剧情阶段，不要引入新的判定、状态变化或选项，"
                        "不要输出 XML、JSON 或元数据，未达到最低字数前不要结束。"
                    ),
                },
            ]
            continuation_filter = adventure_engine.StructuredOutputFilter()
            continuation_finish_reason = None
            try:
                continuation_stream = client.stream_chat(
                    continuation_messages,
                    max_tokens=reply_settings["max_tokens"],
                )
                for event in continuation_stream:
                    if stop_event.is_set():
                        stopped = True
                        break
                    if event["type"] == "usage":
                        usage = event.get("usage")
                    elif event["type"] == "delta":
                        chunk = event.get("content") or ""
                        if not chunk:
                            continue
                        visible = continuation_filter.feed(chunk)
                        if visible:
                            emitted += visible
                            yield sse("delta", {"content": visible})
                    elif event["type"] == "finish":
                        continuation_finish_reason = event.get("finish_reason")
            except DeepSeekError:
                continuation_failed = True
                break
            continuation_tail, _, _, _ = continuation_filter.finish()
            if continuation_tail:
                emitted += continuation_tail
                yield sse("delta", {"content": continuation_tail})
            finish_reason = continuation_finish_reason

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
        if (
            not options
            and not stopped
            and config.ai_enabled
        ):
            options = _recover_missing_options(
                client, messages, emitted, stop_event
            )
            if stop_event.is_set():
                stopped = True
        if not options and not stopped:
            options = adventure_engine.default_turn_options(emitted, latest_user_text)

        visible_state_fallback = False
        if state_delta is None:
            state_delta = adventure_engine.parse_visible_state_delta(emitted)
            visible_state_fallback = state_delta is not None
        if state_delta is None and not stopped:
            state_delta = adventure_engine.default_turn_state_delta(
                state_service.get_state(access), latest_user_text
            )

        if stopped:
            stop_marker = "\n（回复已停止）"
            emitted += stop_marker
            yield sse("delta", {"content": stop_marker})

        if state_delta:
            state_service.apply_state_delta(
                access,
                state_delta,
                source=config.model if config.ai_enabled else "mock",
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
                    access, judge_block
                )
            except ValueError as exc:
                state_service.apply_state_delta(
                    access,
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
            "source": "deepseek" if config.ai_enabled else "mock",
            "status": "stopped" if stopped else "done",
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "state_delta": state_delta,
            "judge": judge_result["roll"] if judge_result else None,
            "options": options or [],
            "continuation_failed": continuation_failed,
        }
        conversation_repository.update_message(
            assistant_message["id"],
            user_id,
            content=emitted,
            metadata=metadata,
            token_count=completion_tokens,
        )
        snapshot_service.autosave(access, note="流式回复后自动存档")
        yield sse("state", _state_event(access))
        yield sse(
            "done",
            {
                "message_id": assistant_message["id"],
                "usage": metadata["usage"],
                "options": metadata["options"],
            },
        )
    except AIRequestPolicyError as exc:
        conversation_repository.update_message(
            assistant_message["id"],
            user_id,
            content=emitted,
            metadata={"status": "error", "error": exc.code},
            token_count=estimate_tokens(emitted),
        )
        yield sse("error", {"code": exc.code, "message": exc.message})
    except DeepSeekError as exc:
        conversation_repository.update_message(
            assistant_message["id"],
            user_id,
            content=emitted,
            metadata={"status": "error", "error": str(exc)},
            token_count=estimate_tokens(emitted),
        )
        yield sse(
            "error",
            {"code": "api_error", "message": "DeepSeek 请求失败"},
        )
    finally:
        current = conversation_repository.get_message(
            assistant_message["id"], user_id
        )
        if current and current.get("metadata", {}).get("status") == "streaming":
            conversation_repository.update_message(
                assistant_message["id"],
                user_id,
                content=emitted or "",
                metadata={"status": "interrupted"},
                token_count=estimate_tokens(emitted),
            )
        stop_event.clear()


@router.post("/{conversation_id}/chat", summary="流式对话")
def chat(
    conversation_id: int,
    payload: ChatRequest,
    request: Request,
    auth: AuthContext = Depends(require_auth),
):
    """按契约返回 text/event-stream，包含 meta/delta/state/done。"""
    access = _get_conversation_or_404(conversation_id, auth)
    if access.conversation.get("onboarding_status") == "pending":
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "请先完成开局设定"},
        )
    effective_config, request_policy = _resolve_generation_config(request, auth)
    if not _claim_chat_activity(request.app, access):
        raise HTTPException(
            status_code=409,
            detail={"code": "conflict", "message": "该会话正在生成回复"},
        )
    stop_event = _get_stop_event(request.app, access)
    stop_event.clear()
    return StreamingResponse(
        _stream_with_activity_release(
            request.app,
            access,
            payload.content,
            payload.metadata,
            stop_event,
            effective_config,
            request_policy,
        ),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{conversation_id}/stop", status_code=204, summary="停止当前回复")
def stop_chat(
    conversation_id: int,
    request: Request,
    auth: AuthContext = Depends(require_auth),
):
    """设置停止事件，当前流式生成会在下一个分片处结束。"""
    access = _get_conversation_or_404(conversation_id, auth)
    _get_stop_event(request.app, access).set()
    return Response(status_code=204)
