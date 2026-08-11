# 本地 Live2D 部署

页面现在从 `frontend/vendor/live2d-widget/autoload.js` 加载 Live2D 运行时，不再依赖 jsDelivr 的入口脚本。模型配置位于 `frontend/vendor/live2d-models`；切换按钮默认从 6 个本地模型开始，并继续提供 3 个在线模型：Pio、Tia、海王星。切换到在线模型时需要网络。

启动项目后访问 `http://127.0.0.1:8000` 即可使用。要增加模型：

1. 从来源仓库的 `assets/model.index` 选择一个完整模型目录，保持该目录内部的相对路径不变，复制到 `frontend/vendor/live2d-models`。
2. 在 `frontend/vendor/live2d-models/models.json` 的 `models` 数组中加入一个 Cubism 2 模型项；本地模型的 `paths` 指向本地 `.model.json`，在线模型可使用 HTTPS 的模型 JSON 地址并标记 `"online": true`。
3. 运行 `node --test frontend/test_live2d_widget.mjs`，再用浏览器点击看板娘工具栏里的模型切换按钮确认资源全部返回 200。

来源与许可说明见 `frontend/vendor/live2d-models/SOURCE.md`。模型文件属于各自作者，使用和再发布前请遵守来源仓库及模型作者的许可限制。
