# 开发状态

截至 2026-08-16，静态导出的 Next 前端源码、资源与 `out/` 位于 `frontend/`，并由 `backend/main.py` 从 `frontend/out` 托管。旧的 `ai/ai` 前端副本、其压缩包与 Superdesign 运行元数据已从工作树移除，迁移前版本仍可从 Git 历史获取。`config.json` 和 TypeScript 构建缓存为本地文件，不应提交；使用 `config.example.json` 创建本地配置。当前前端仍设置了 `typescript.ignoreBuildErrors`，因此应额外运行 `pnpm exec tsc --noEmit`。已确认后端完整测试 273 项、前端类型检查和 `pnpm build` 通过；构建会报告一个来自依赖生成选择器的 CSS 警告。后续应补充新界面的自动化浏览器验证，并在发布前执行后端冒烟测试。
