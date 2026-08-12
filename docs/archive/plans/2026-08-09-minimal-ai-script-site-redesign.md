# 全站简约 AI 剧本网站美术重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 AI 对话冒险平台改造为覆盖全站的白色半透明、简约 AI 剧本工作台界面，同时不改变任何业务功能。

**Architecture:** 以 `frontend/css/style.css` 为唯一的视觉系统入口，替换根令牌和现有组件选择器的表现层规则。保留 `frontend/index.html` 的语义骨架和 `frontend/js/main.js` 的路由、数据及事件绑定；只有当现有类名不足以实现布局时才增加最小结构辅助。

**Tech Stack:** 原生 HTML、CSS、JavaScript；FastAPI 本地服务；浏览器开发者工具进行视觉与控制台验证。

## Global Constraints

- 只改变前端美术、布局与响应式样式，不改变后端、数据库、API 契约、Hash 路由或已有功能事件。
- 使用浅灰至白色背景、半透明白色容器、细灰边框、柔和阴影，以及蓝紫色作为唯一主要强调色。
- 不添加图片、插画、外部字体、前端依赖或构建工具。
- 维持键盘焦点、禁用、加载、成功与错误状态的可辨识性，并支持 `prefers-reduced-motion`。
- 该工作区当前不是 Git 仓库；各任务完成后使用文件检查和运行验证代替提交。

---

## File Structure

- Modify: `frontend/css/style.css` — 全局设计令牌、基础控件、页面组件、响应式规则与动效。
- Inspect only: `frontend/index.html` — 确认顶栏和根容器的现有语义足以承载新视觉。
- Inspect only: `frontend/js/main.js` — 通过既有路由进入作品库、详情、冒险、创作与设置页，验证功能未变。
- Test: running local service plus browser at `/`, `#/work/:id`, `#/adventure/:id`, `#/creator`, `#/settings`。

### Task 1: 建立全局半透明白色设计系统

**Files:**
- Modify: `frontend/css/style.css:3-546`
- Test: 浏览器中的作品库与顶栏

**Interfaces:**
- Consumes: 现有 `:root` CSS 变量以及 `.topbar`、`.panel`、`.btn`、`.input`、`.tag` 等既有类名。
- Produces: 所有页面共享的白色半透明颜色、边框、阴影、圆角、控件与焦点样式，无需修改 JavaScript。

- [ ] **Step 1: 为目标令牌定义视觉验收基线**

在 `:root` 中确认并替换下列变量为浅色玻璃系统：`--bg`、`--bg-soft`、`--panel`、`--panel-2`、`--panel-3`、`--input`、`--line`、`--text`、`--muted`、`--accent`、`--accent-strong`、`--shadow`、`--radius`。主色使用低饱和蓝紫，文本使用深灰。

- [ ] **Step 2: 应用全局背景、容器和顶栏规则**

更新 `html`、`body`、`.topbar`、`main#app` 与 `.panel`：页面背景为低对比浅灰白渐变；顶栏和面板使用半透明白底、`backdrop-filter: blur(...)`、细边框和柔和阴影；维持现有 sticky 顶栏与内容最大宽度行为。

- [ ] **Step 3: 统一交互控件与状态**

更新 `.btn`、`.btn-primary`、`.btn-ghost`、`.btn-danger`、`.icon-btn`、`.input`、`.textarea`、`.select`、`.tag`、`.chip`、`.segmented`：主按钮和活动标签使用蓝紫色，其他控件保持透明白底；保留 `:focus-visible` 轮廓，并使禁用、错误与成功状态在白底上具有清晰对比。

- [ ] **Step 4: 增加减少动态效果规则**

在文件末尾加入以下规则，确保页面动画与悬停过渡可被系统偏好关闭：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: 验证基础界面**

运行：`python start.py --no-browser`

在浏览器打开 `http://127.0.0.1:8000/#/`。确认顶栏、卡片、输入控件、主/次按钮、键盘焦点和主题切换均可用，且控制台无 CSS 或 JavaScript 错误。

### Task 2: 重做作品库与详情的内容层级

**Files:**
- Modify: `frontend/css/style.css:547-801`
- Test: `#/` 与 `#/work/:id`

**Interfaces:**
- Consumes: `renderLibrary()` 和 `renderWorkDetail()` 已输出的 `.work-grid`、`.work-card`、`.cover`、`.detail-layout`、`.detail-hero`、`.detail-main`、`.detail-actions` 类名。
- Produces: 适合阅读与探索作品的轻量作品卡和详情布局；原有链接与按钮事件保持不变。

- [ ] **Step 1: 处理作品卡与封面**

更新 `.work-grid`、`.work-card`、`.work-card-body`、`.work-card-title`、`.work-card-description`、`.work-card-meta`：增大留白，降低边界对比度，悬停仅轻微上浮。更新 `.cover`、`.cover::after`、`.cover-1` 至 `.cover-6`、`.cover-inner`：将斜线纹理替换为低对比蓝紫/灰白渐变和弱化圆形装饰，不使用图片。

- [ ] **Step 2: 处理作品详情主次关系**

更新 `.detail-layout`、`.detail-hero .cover`、`.detail-title`、`.detail-description`、`.detail-meta`、`.detail-actions`：让标题与“开始冒险”按钮成为主焦点，元信息和次级操作使用较弱颜色；保持大屏双栏与窄屏单列。

- [ ] **Step 3: 验证作品流程**

在 `#/` 检查筛选、搜索、排序及作品卡按钮；进入一个已有作品的 `#/work/:id`，检查详情、会话列表、新建/继续冒险等原有操作可用。分别以约 1440px 和 390px 宽度查看，确认没有横向滚动或文字截断。

### Task 3: 重做冒险对话阅读与状态面板

**Files:**
- Modify: `frontend/css/style.css:802-1176`
- Test: `#/adventure/:id`

**Interfaces:**
- Consumes: `renderAdventure()` 已输出的 `.adventure-shell`、`.conversation-pane`、`.message-list`、`.message`、`.message.user`、`.message.ai`、`.composer` 和状态面板相关类名。
- Produces: AI 白色气泡、用户淡蓝紫气泡、底部稳定输入区和轻量右侧上下文面板，且不干扰流式输出与发送事件。

- [ ] **Step 1: 建立对话区视觉层级**

更新 `.adventure-shell`、`.conversation-pane`、`.conversation-header`、`.message-list`、`.message`、`.message.ai`、`.message.user`、`.message.system`、`.message-label`：增加阅读留白与行高；AI 气泡使用半透明白色，玩家气泡使用低饱和蓝紫半透明；系统消息保持独立但低强调。

- [ ] **Step 2: 处理输入区与快捷操作**

更新 `.composer`、`.composer-row`、`.composer textarea` 以及此区间内的快捷指令/骰子相关类：输入区与对话底部有明确分隔，发送操作呈蓝紫主按钮，其他快捷操作为低强调胶囊或透明按钮；不改变现有元素 ID、表单行为和禁用状态。

- [ ] **Step 3: 处理右侧状态区与窄屏流向**

更新对话侧栏面板及 `@media (max-width: 960px)` 内的 `.adventure-shell` 规则：桌面保留主对话加状态栏的两列结构；窄屏按“对话在前、状态在后”改为单列，输入区保持可见且不压住消息。

- [ ] **Step 4: 验证对话流程**

创建或打开已有会话，发送一条普通消息并触发一次快捷指令（如 `/状态`）。确认流式内容、状态面板、骰子/快捷操作、存档相关按钮和消息滚动仍能使用；在 1440px 与 390px 视口检查布局及控制台。

### Task 4: 统一创作台、设置、弹窗与反馈层

**Files:**
- Modify: `frontend/css/style.css:1177-1588`
- Test: `#/creator`、`#/settings`、年龄确认弹窗与 toast

**Interfaces:**
- Consumes: `renderCreator()`、`renderSettings()` 与 `showAgeGate()` 生成的 `.creator-layout`、`.form-stack`、`.form-grid`、`.settings-layout`、`.modal`、`.toast` 类名及既有按钮 ID。
- Produces: 清晰的表单分组、唯一高强调保存操作、统一的反馈组件与移动端布局。

- [ ] **Step 1: 重做创作与设置表单分组**

更新 `.creator-layout`、`.form-stack`、`.form-grid`、`.dynamic-list`、`.entry-list`、`.settings-layout`、`.settings-actions` 与侧栏面板相关类：以间距、轻边框和标题层级区分“作品、角色、世界书、设置”等区块；保存按钮保持唯一主色动作，导入、预览、测试使用低强调样式。

- [ ] **Step 2: 重做提示与模态反馈**

更新 `.toast-root`、`.toast`、`.toast.error`、`.toast.success`、`.modal-backdrop`、`.modal`、`.modal-actions`：toast 采用半透明白卡和状态色小范围提示；弹窗采用带背景模糊的柔和遮罩、白色容器和清晰操作层级；不改变现有年龄确认、关闭和保存逻辑。

- [ ] **Step 3: 完成响应式收束**

复查并更新 `@media (max-width: 960px)`、`@media (max-width: 720px)`、`@media (max-width: 420px)`：创作侧栏和表单网格在窄屏收为单列；顶栏保持可操作；按钮文本、输入框和弹窗不溢出视口。

- [ ] **Step 4: 验证全站与后端回归**

在浏览器依次打开 `#/creator` 和 `#/settings`，测试表单输入、添加动态行、预览、保存、主题按钮和连接测试；清除 `localStorage` 的年龄键以验证弹窗后再恢复。运行：`python backend\smoke_test.py`。预期：所有 smoke test 通过，浏览器控制台无未处理异常，1440px 和 390px 视口均无横向溢出。

## Plan Self-Review

- Spec coverage: Task 1 覆盖全局白色半透明设计、颜色、状态与无障碍；Task 2 覆盖作品库和详情；Task 3 覆盖冒险对话与状态栏；Task 4 覆盖创作、设置、弹窗、toast、响应式与回归验证。
- Placeholder scan: 本计划不包含 TBD、TODO、或“类似 Task N”等未定义实施项。
- Interface consistency: 所有任务仅消费现有 HTML/JavaScript 类名和函数输出；不新增跨任务 JavaScript 接口。
