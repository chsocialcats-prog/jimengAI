# 创建角色卡 JSON 格式说明弹窗设计

## 目标

在创建/编辑角色卡页面的 JSON 文件上传控件旁增加“JSON 格式”按钮。点击按钮后，在当前页面打开只读弹窗，展示项目当前支持的角色卡 JSON 示例、字段说明和导入注意事项，帮助用户准备可导入文件。

## 交互设计

- 按钮位于现有 JSON 文件上传控件旁，文案为“JSON 格式”。
- 点击按钮后使用前端已有的 `openModal()` 打开说明弹窗。
- 弹窗包含：标题、简短说明、完整示例 JSON、字段说明、导入格式注意事项和“关闭”按钮。
- 弹窗沿用现有行为：点击“关闭”或遮罩即可关闭。
- 说明为只读静态帮助内容，不读取当前表单值，也不修改角色卡数据。
- 不改变现有上传、解析、填充表单和保存逻辑。

## 内容范围

说明以当前项目实际角色卡结构为准，包含以下字段：

- `name`
- `persona`
- `personality`
- `speaking_style`
- `relationships`
- `directives`
- `initial_state`
- `character_attributes`
- `source`

同时明确：`name` 是唯一必填字段；`id`、`created_at`、`updated_at` 由服务端返回；`world` 和 `opening` 属于作品/世界书配置，不属于当前角色卡对象；导入支持直接对象和顶层 `card` 包装对象。

## 实现边界

- 在 `frontend/js/main.js` 中新增小型帮助内容函数和按钮绑定。
- 按钮放在 `renderCardEditor()` 生成的 `.detail-actions` 中。
- 使用 `openModal()`，不新增第二套弹窗机制。
- 示例 JSON 使用 `<pre><code>` 展示，并对内容进行 HTML 转义，避免帮助文本被解释为 HTML。
- 在 `frontend/test_role_card_library.mjs` 增加源代码回归测试，验证按钮存在、格式说明函数存在、关键字段和弹窗调用存在。
- 不修改后端 schema、导入解析规则或已有未相关的工作区改动。

## 验收标准

1. 创建角色卡页和编辑角色卡页都显示“JSON 格式”按钮。
2. 点击按钮打开说明弹窗，示例 JSON 和字段说明可读且不会溢出页面。
3. 点击关闭按钮或遮罩可以关闭弹窗。
4. 上传 JSON 文件仍按原逻辑导入，现有字段保留行为不变。
5. 相关前端测试和 `node --check frontend/js/main.js` 通过。
