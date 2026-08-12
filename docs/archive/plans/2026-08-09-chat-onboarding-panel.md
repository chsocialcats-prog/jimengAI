# 聊天内开局面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新建会话的聊天页面显示开局资料与必填引导面板。

**Architecture:** 前端重用会话、作品、角色卡与世界书 API，在 `renderAdventure` 中渲染强制或只读模态面板；无需后端数据变更。

**Tech Stack:** 原生 JavaScript、HTML/CSS、现有 FastAPI API。

## Global Constraints

- 仅新建且未完成引导的会话强制显示；已完成会话只能只读回顾。
- 面板展示开场、角色卡、世界书和会话回答；确认后才启用输入。
- 不修改剧本、角色卡、世界书或历史消息。

---

### Task 1: 嵌入聊天的开局资料面板

**Files:**
- Modify: `frontend/js/main.js`
- Modify: `frontend/css/style.css`

**Interfaces:**
- Produces: `openAdventureOnboarding(conversation, work, card, worldbook, readOnly)`。

- [ ] **Step 1: 写入最小渲染函数，复用既有 `esc`、`modalRoot` 和 onboarding API。**

```javascript
function openAdventureOnboarding(conversation, work, card, worldbook, readOnly) {
  // 显示开场、角色、世界和回答；非只读时提交 /onboarding。
}
```

- [ ] **Step 2: 在 `renderAdventure` 加载角色卡与世界书，并对 pending 会话自动打开面板。**

- [ ] **Step 3: 增加聊天顶部“开局设定”只读按钮。**

- [ ] **Step 4: 运行验证。**

Run: `node --check frontend/js/main.js; python -m pytest backend/test_onboarding.py backend/test_chat_exclusivity.py -v`

Expected: 命令成功。
