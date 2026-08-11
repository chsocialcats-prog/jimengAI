# 无标题剧情选项解析修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后端识别没有标题、直接连续输出项目符号或编号的剧情选项，避免错误使用通用兜底选项。

**Architecture:** 保留 `<options>` 结构化块和带“选项：”标题列表的现有优先路径；仅在标题路径未命中时，增加对连续裸项目符号列表的候选收集。候选列表至少两项才被接受，并在状态块或普通正文处结束，最终仍由现有 SSE `options` 字段传给前端。

**Tech Stack:** Python 3、pytest、现有 `backend.services.adventure_engine` 解析器、SSE 聊天接口、Node 内置测试运行器。

## Global Constraints

- 不改变 `<options>` 结构化输出的优先级或数据格式。
- 不修改前端 `explicitOptions` 优先级，也不把通用兜底选项硬编码成特殊判断。
- 裸列表至少包含两项，最多返回四项。
- 遇到 `【状态变化】` 或普通正文时停止候选收集。
- 只修改本次行为所需文件，不覆盖工作区已有的其他修改。

---

### Task 1: 支持无标题剧情选项并加入回归测试

**Files:**
- Modify: `backend/test_options_output.py`，增加裸项目符号列表的回归测试。
- Modify: `backend/services/adventure_engine.py:321-374`，扩展 `parse_visible_options` 的可见列表解析。

**Interfaces:**
- Consumes: `parse_visible_options(text: str)` 的现有文本输入。
- Produces: `list[str] | None`，最多四个原始行动选项；无可靠列表时继续返回 `None`，让调用方使用原有兜底策略。

- [ ] **Step 1: 写出失败测试**

在 `backend/test_options_output.py` 的 `OptionOutputTests` 中增加：

```python
    def test_bare_bullets_are_extracted_before_fallback(self):
        narrative = (
            "她注视着你，只等着你给出自己的选择。\n\n"
            "- 问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？\n"
            "- 决定签下保密契约，跟她进入东区禁书区\n"
            "- 先问她：你有没有亲眼见过实际存在的那本笔记？\n"
            "- 微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”\n\n"
            "【状态变化】\n"
            "- 塞西莉亚·好感度 +2"
        )

        self.assertEqual(
            adventure_engine.parse_visible_options(narrative),
            [
                "问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？",
                "决定签下保密契约，跟她进入东区禁书区",
                "先问她：你有没有亲眼见过实际存在的那本笔记？",
                "微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”",
            ],
        )
```

- [ ] **Step 2: 运行测试并确认它因当前缺陷失败**

运行：

```powershell
python -m pytest -q backend/test_options_output.py -k bare_bullets
```

预期：测试失败，当前 `parse_visible_options(narrative)` 返回 `None`，而不是四个行动选项。若测试因导入、语法或编码错误失败，先修正测试本身，直到失败原因准确指向缺少裸列表解析行为。

- [ ] **Step 3: 实现最小解析修复**

在 `parse_visible_options` 中保留现有标题列表逻辑，并增加独立的裸列表候选组：

1. 每遇到不带标题的项目符号/编号行，将清理后的条目追加到当前候选组。
2. 空行可以出现在同一候选组的项目之间；遇到非项目符号正文时刷新候选组。
3. 候选组至少两项时记录为隐式选项组；遇到 `【状态变化】` 时先刷新并停止扫描。
4. 如果标题列表解析出了结果，继续返回标题列表；否则返回最后一个至少两项的隐式选项组，限制为四项。
5. 复用现有项目符号、编号、引号清理规则，避免改变现有带标题列表的返回值。

实现后，测试用例中的四个条目应在调用方触发 `if not options` 兜底前被返回。

- [ ] **Step 4: 运行回归测试确认通过**

运行：

```powershell
python -m pytest -q backend/test_options_output.py
```

预期：该文件全部通过，并且已有结构化 `<options>`、带标题列表和默认选项测试保持通过。

- [ ] **Step 5: 运行完整验证**

运行：

```powershell
python -m pytest -q backend
Get-ChildItem frontend -Filter 'test_*.mjs' | ForEach-Object { node --test $_.FullName }
```

预期：后端和前端现有测试均以退出码 0 完成，无新增失败或错误输出；工作区中除本任务涉及文件外，已有用户修改保持不变。

- [ ] **Step 6: 检查差异并提交实现**

运行：

```powershell
git diff --check
git status --short
```

确认只提交 `backend/services/adventure_engine.py` 与 `backend/test_options_output.py` 的本次改动，然后使用：

```powershell
git add -- backend/services/adventure_engine.py backend/test_options_output.py
git commit -m "fix: parse bare story options"
```
