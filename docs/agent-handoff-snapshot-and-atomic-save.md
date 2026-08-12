# 存档修正与创作台原子保存交接

更新时间：2026-08-11

## 本轮完成内容

本轮处理了两个数据一致性问题：

1. 会话的人设修正、记忆修正现在会进入手动存档和自动存档，并在读档时恢复。
2. 创作台保存作品时，作品、世界书、世界书条目和角色卡顺序现在通过一个 SQLite 事务提交，不再由前端连续调用多个 CRUD 接口。

## 会话修正快照

### 数据库

`snapshots` 新增两个可空 JSON 文本列：

- `persona_corrections`
- `memory_corrections`

迁移位于 `backend/database.py`，数据库 `user_version` 已更新为 `2`。

可空设计是有意的：

- `NULL` 表示迁移前创建的旧快照，不知道当时的修正内容。恢复此类快照时保留会话当前修正。
- `'[]'` 表示新快照明确记录当时没有修正。恢复时应清空当前修正。
- JSON 数组表示精确恢复快照创建时的修正。

不要把旧快照的 `NULL` 批量回填为 `'[]'`，否则读档会错误清空用户已有修正。

### 后端行为

相关实现位于 `backend/repositories.py`：

- `create_snapshot()` 在同一个 `BEGIN IMMEDIATE` 中读取状态、消息、摘要和两类修正。
- 自动存档覆盖时也会更新两类修正。
- `restore_snapshot()` 在恢复状态、消息和摘要的同一事务中恢复修正。
- 修正恢复使用 `COALESCE` 保留旧快照兼容语义。
- `row_to_snapshot(include_private=False)` 不向存档列表公开消息、摘要或修正文案。

读档接口现在额外返回恢复后的 `conversation` 和 `messages`，已有的 `state` 字段保持不变。路由位于 `backend/routers/conversations_routes.py`。

### 前端与离线模式

`frontend/js/main.js` 在读档后会同步刷新：

- `session.state`
- `session.conv`
- `session.messages`
- `session.snapshots`

随后重新渲染消息和侧栏，避免后端已恢复但页面仍显示读档前消息。

离线模式的新会话会初始化两类修正数组。手动存档和每轮自动存档都会深拷贝状态、消息和修正。旧离线快照缺少修正字段时保留当前修正；字段存在且为空数组时清空修正。

## 创作台原子保存

### 新接口

新增两个聚合接口，原有作品和世界书 CRUD 接口继续保留：

```text
POST /api/works/bundle
PUT  /api/works/{work_id}/bundle
```

请求结构：

```json
{
  "work": {
    "title": "作品名",
    "card_ids": [],
    "player_attributes": {}
  },
  "worldbook": {
    "title": "世界书名",
    "description": "说明",
    "entries": []
  }
}
```

Pydantic 模型位于 `backend/schemas.py`，路由位于 `backend/routers/works_routes.py`，事务实现为 `backend/repositories.py` 中的 `save_work_bundle()`。

### 事务语义

单次事务包含：

- 创建或更新世界书。
- 新增、更新和删除世界书条目；更新时请求中的条目列表是最终完整列表，未提交的旧条目会被删除。
- 创建或更新作品字段。
- 校验并替换有序角色卡引用。

条目 ID 必须属于当前世界书，重复条目 ID、未知条目或未知角色卡会导致整个事务回滚。不要在前端恢复原来的多请求保存流程。

编辑共享世界书仍沿用旧产品语义：更新会影响所有引用该世界书的作品，但现在更新过程是原子的。

历史上没有世界书的作品也可以进入编辑器；保存时后端会在同一事务中创建世界书并关联作品。

### 前端行为

在线创作台的新建和编辑流程只调用对应的 bundle 接口。

离线模式没有独立世界书表，因此编辑共享世界书时会同步更新所有相同 `worldbook_id` 的作品副本。没有世界书的离线作品会在保存时获得新的世界书 ID。

## 测试

新增测试：

- `backend/test_snapshot_corrections.py`
- `backend/test_work_bundle.py`
- `frontend/test_atomic_creator_and_snapshot.mjs`

覆盖范围包括：

- 新快照恢复及清空修正。
- 旧快照 `NULL` 兼容。
- 真实旧表迁移并保留数据。
- 聚合创建作品和世界书。
- 条目完整列表替换。
- 事务失败后作品、世界书和条目全部回滚。
- 前端使用单次 bundle 请求。
- 无世界书作品编辑和离线共享世界书同步。
- 离线手动/自动存档保存修正并在读档后刷新消息。

本轮最终验证结果：

```text
后端：138 tests passed
前端：81 tests passed
```

运行命令：

```powershell
python -m unittest discover -s backend -p 'test_*.py'
$testFiles = Get-ChildItem -Path frontend -Filter 'test_*.mjs' | ForEach-Object { $_.FullName }
node --test $testFiles
```

## 协作注意

本轮开始前工作树已经包含其他未提交改动，包括属性白名单、回复长度、前端样式和仓储拆分等内容。不要通过 reset、checkout 或整文件覆盖清理这些改动。后续修改应基于当前代码和测试继续增量进行。
