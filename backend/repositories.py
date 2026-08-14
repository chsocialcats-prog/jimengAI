# -*- coding: utf-8 -*-
"""SQLite 业务数据访问 facade。

路由和服务继续只依赖本模块；具体数据访问按业务域放在 repository 包中。
"""

from .database import (
    connect,
    execute,
    fetch_all,
    fetch_one,
    json_dumps,
    json_loads,
    now_str,
)
from .repository.cards import (
    CardReferenceConflict,
    create_card,
    get_card,
    list_card_references,
    list_cards,
    row_to_card,
    update_card,
)
from .repository.cards import delete_card as _delete_card
from .repository.conversation_repository import (
    ConversationRecord,
    _EMPTY_CARD_SNAPSHOT_MARKER,
    _initial_character_states,
    _json_safe_copy,
    _ordered_work_cards_in_connection,
    add_conversation_correction,
    delete_conversation,
    get_conversation,
    get_conversation_card,
    get_conversation_cards,
    get_memory_summary,
    get_memory_summary_record,
    get_message,
    get_messages,
    list_conversations,
    row_to_conversation,
    row_to_message,
    update_conversation,
    update_message,
)
from .repository.conversation_repository import (
    complete_conversation_onboarding as _complete_conversation_onboarding,
)
from .repository.conversation_repository import (
    create_conversation as _create_conversation,
)
from .repository.conversation_repository import (
    create_conversation_branch as _create_conversation_branch,
)
from .repository.conversation_repository import create_message as _create_message
from .repository.conversation_repository import get_state as _get_state
from .repository.conversation_repository import replace_messages as _replace_messages
from .repository.conversation_repository import save_memory_summary as _save_memory_summary
from .repository.conversation_repository import save_state as _save_state
from .repository.normalizers import (
    clean_update_data as _clean_update_data,
    normalize_active_reply_template_id as _normalize_active_reply_template_id,
    normalize_state,
    validate_onboarding,
    validate_reply_templates,
)
from .repository.snapshot_repository import (
    delete_snapshot,
    get_snapshot,
    list_snapshots,
    row_to_snapshot,
)
from .repository.snapshot_repository import create_snapshot as _create_snapshot
from .repository.snapshot_repository import restore_snapshot as _restore_snapshot
from .repository.worldbooks import (
    create_worldbook,
    create_worldbook_entry,
    delete_worldbook,
    delete_worldbook_entry,
    get_worldbook,
    get_worldbook_entry,
    list_worldbook_entries,
    list_worldbooks,
    row_to_entry,
    update_worldbook,
    update_worldbook_entry,
)
from .repository.work_bundles import save_work_bundle as _save_work_bundle
from .repository.works import (
    delete_work,
    get_work,
    list_works,
    normalize_card_ids,
    ordered_work_cards as _ordered_work_cards,
    replace_work_cards as _replace_work_cards,
    row_to_work,
    validate_card_ids as _validate_card_ids,
)
from .repository.works import create_work as _create_work
from .repository.works import normalize_player_attributes as _normalize_player_attributes
from .repository.works import update_work as _update_work


def delete_card(card_id, *, owner_user_id):
    """Delete an owned card through the compatibility facade.

    Ownership is intentionally required at this boundary.  Callers that do
    not have an authenticated owner must use the public read repositories;
    the facade never invents a default or a sentinel account.
    """
    return _delete_card(card_id, owner_user_id=owner_user_id, connect_fn=connect)


def create_work(data, *, owner_user_id):
    return _create_work(data, owner_user_id=owner_user_id, connect_fn=connect)


def update_work(work_id, data, *, owner_user_id):
    return _update_work(
        work_id, data, owner_user_id=owner_user_id, connect_fn=connect
    )


def save_work_bundle(work_data, worldbook_data, work_id=None, *, owner_user_id):
    return _save_work_bundle(
        work_data,
        worldbook_data,
        work_id=work_id,
        owner_user_id=owner_user_id,
        connect_fn=connect,
    )


def create_conversation(work_id, title, *, user_id):
    return _create_conversation(work_id, title, user_id, connect_fn=connect)


def create_conversation_branch(
    source_conversation_id, title, branch_label="", snapshot_id=None, *, user_id
):
    return _create_conversation_branch(
        source_conversation_id,
        user_id,
        title,
        branch_label,
        snapshot_id,
        connect_fn=connect,
    )


def complete_conversation_onboarding(conversation_id, answers, *, user_id):
    return _complete_conversation_onboarding(
        conversation_id, user_id, answers, connect_fn=connect
    )


def create_message(
    conversation_id, role, content, metadata=None, token_count=0, *, user_id
):
    return _create_message(
        conversation_id,
        user_id,
        role,
        content,
        metadata=metadata,
        token_count=token_count,
        connect_fn=connect,
    )


def replace_messages(conversation_id, messages, *, user_id):
    return _replace_messages(conversation_id, user_id, messages, connect_fn=connect)


def get_state(conversation_id, *, user_id):
    return _get_state(conversation_id, user_id, connect_fn=connect)


def save_state(conversation_id, state, *, user_id):
    return _save_state(conversation_id, user_id, state, connect_fn=connect)


def save_memory_summary(
    conversation_id, summary, covered_until_sequence=-1, *, user_id
):
    return _save_memory_summary(
        conversation_id,
        user_id,
        summary,
        covered_until_sequence,
        connect_fn=connect,
    )


def create_snapshot(
    conversation_id,
    name="手动存档",
    note="",
    branch_label="",
    autosave=False,
    *,
    user_id,
):
    return _create_snapshot(
        conversation_id,
        user_id,
        name=name,
        note=note,
        branch_label=branch_label,
        autosave=autosave,
        connect_fn=connect,
    )


def restore_snapshot(conversation_id, snapshot_id, *, user_id):
    return _restore_snapshot(
        conversation_id, snapshot_id, user_id, connect_fn=connect
    )
