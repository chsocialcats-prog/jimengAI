# Content Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能从作品详情安全编辑已有作品、角色卡、世界书和世界书条目。

**Architecture:** 前端复用现有创作表单，并以 `#/creator/{work_id}` 进入编辑模式。保存时沿用现有 REST `PUT`/`POST`/`DELETE` 接口：作品、角色卡和世界书更新为 `PUT`，世界书条目按已有 ID 执行更新、新增和删除。共享角色卡/世界书默认仍编辑原资源，保存前向用户提示受影响的作品数。

**Tech Stack:** 原生 HTML/CSS/JavaScript、FastAPI、SQLite；不增加依赖或构建工具。

## Global Constraints

- 保持个人电脑本地单机架构，不引入账号、云同步或外部服务。
- 保持现有新建作品和文本导入能力可用。
- 不修改已稳定的聊天、存档和数据库并发逻辑。
- 现有后端作品、角色卡、世界书及条目 CRUD 接口为唯一数据入口。

---

### Task 1: 编辑模式的数据加载与路由

**Files:**
- Modify: `frontend/js/main.js`
- Test: `node --check frontend/js/main.js`

**Interfaces:**
- Consumes: `GET /api/works/{id}`、`GET /api/cards/{id}`、`GET /api/worldbooks/{id}`、`GET /api/worldbooks/{id}/entries`
- Produces: `#/creator/{work_id}` 路由和预填充的创作表单

- [ ] **Step 1: 添加编辑路由和入口**

在 `parseRoute()` 中识别 `#/creator/{work_id}`，并在作品详情添加“编辑作品”按钮，导航到该路由。

- [ ] **Step 2: 加载聚合编辑数据**

在 `renderCreator(workId)` 中并行读取作品、其关联角色卡、世界书和条目；缺失关联资源时显示可理解的错误而不清空用户页面。

- [ ] **Step 3: 预填充现有表单**

将作品标题、简介、标签、开场、角色字段、初始状态、世界书字段和条目填入现有表单。每个已存在条目保留 `data-entry-id`，供后续保存判定。

- [ ] **Step 4: 验证**

运行：`node --check frontend/js/main.js`

预期：退出码为 0。

### Task 2: 条目差量保存与共享资源提示

**Files:**
- Modify: `frontend/js/main.js`
- Test: `node --check frontend/js/main.js`

**Interfaces:**
- Consumes: `PUT /api/works/{id}`、`PUT /api/cards/{id}`、`PUT /api/worldbooks/{id}`、`POST|PUT|DELETE /api/worldbooks/{worldbook_id}/entries`
- Produces: 编辑模式下原子顺序保存和完成后的作品详情跳转

- [ ] **Step 1: 区分新建和编辑保存分支**

`submitCreatorForm()` 保留原新建流程；编辑模式依次执行角色卡、世界书、作品的 `PUT`，且不创建新的关联资源。

- [ ] **Step 2: 同步世界书条目**

已有 `data-entry-id` 的条目调用 `PUT`；无 ID 的条目调用 `POST`；编辑页加载时存在、但提交时已被删除的 ID 调用 `DELETE`。新增条目时携带用户输入的优先级、关键词、内容和启用状态。

- [ ] **Step 3: 提示共享资源影响**

保存前读取作品列表并统计使用同一 `card_id` 或 `worldbook_id` 的其他作品。若存在其他引用，使用确认提示说明保存会同步影响的作品数量；取消则不提交任何写请求。

- [ ] **Step 4: 验证**

运行：`node --check frontend/js/main.js`

预期：退出码为 0；手工检查编辑入口、预填充、更新/新增/删除条目和取消共享资源确认提示。

### Task 3: 编辑完成后的体验与回归

**Files:**
- Modify: `frontend/js/main.js`
- Test: `node --check frontend/js/main.js`

**Interfaces:**
- Consumes: Task 1、Task 2 的编辑模式状态
- Produces: 清晰的保存状态、失败提示和不丢失表单内容的回退

- [ ] **Step 1: 保存状态与失败处理**

编辑保存期间禁用提交按钮并显示“保存中”；任一请求失败时恢复按钮与表单，不跳转，并展示接口错误信息。

- [ ] **Step 2: 保存成功后的回跳**

全部请求成功后显示“作品已更新”，跳转 `#/work/{work_id}` 并重新读取详情。

- [ ] **Step 3: 保持新建能力**

验证 `#/creator` 仍走原有新建和文本导入流程，且不出现编辑模式数据。

- [ ] **Step 4: 验证**

运行：`node --check frontend/js/main.js`

预期：退出码为 0。
