# 开发状态

截至 2026-08-15，静态导出的 Next 前端源码、资源与 `out/` 已迁移至 `frontend/`，并由 `backend/main.py` 从 `frontend/out` 托管；原有旧前端已作为迁移前检查点推送至 Git 历史。当前前端仍设置了 `typescript.ignoreBuildErrors`，因此应额外运行 `pnpm exec tsc --noEmit`。已确认后端完整测试 271 项、前端类型检查和 `pnpm build` 通过；构建会报告一个来自依赖生成选择器的 CSS 警告。后续应补充新界面的自动化浏览器验证，并在发布前执行后端冒烟测试。
