# AI 对话冒险平台

个人自用、纯文字、20+ 成人向的 AI 对话冒险本地软件。
使用 DeepSeek 官方 API（OpenAI 兼容格式），无图片、无语音、无账号系统。

## 功能

- 作品库：搜索、标签筛选、推荐/最新/热门排序
- 作品详情：角色卡、世界书条目、开场剧情
- 冒险页：流式对话、剧情选项、快捷指令、状态面板、存档读档
- 创作台：创建角色卡、世界书和作品，支持导入 JSON 角色卡
- 设置：DeepSeek Base URL、API Key、模型、温度、回复长度
- 无 Key 时自动使用本地 Mock 回复；完全离线时使用内置演示数据

快捷指令支持中文和英文别名：`/状态`（`/status`）、`/背包`（`/inventory`）、`/存档`（`/save`）、`/帮助`（`/help`）。

## 启动方式

双击 `start.bat`，或在项目根目录运行：

```powershell
python start.py
```

服务启动后会打开 `http://127.0.0.1:8000`。自动打开浏览器失败时，可手动访问该地址。

本项目按单机、单进程模式设计；请使用上述启动方式，不要以多 worker / 多进程方式启动 Uvicorn。会话中的流式生成锁保存在当前服务进程内，用于保证同一会话不会同时生成多条回复。

如需只启动服务、不打开浏览器：

```powershell
python start.py --no-browser
```

## 本地配置

`config.json` 已包含 DeepSeek 配置占位：

```json
{
  "deepseek": {
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "api_key": ""
  }
}
```

把 API Key 填入 `api_key`，或设置环境变量 `DEEPSEEK_API_KEY` 即可。`/api/health` 的 `ai_enabled` 变为 `true` 后，对话会走 DeepSeek 流式接口。

## 项目结构

```text
ai模拟冒险/
├── backend/                  # FastAPI 后端
│   ├── ai/                   # DeepSeek 客户端与 mock 客户端
│   ├── routers/              # API 路由
│   ├── services/             # 冒险引擎、状态、骰子、存档
│   ├── config.py             # 读取 config.json
│   ├── database.py           # SQLite 自动初始化
│   └── smoke_test.py         # 后端冒烟测试
├── data/                     # SQLite 数据库目录
├── docs/api-contract.md      # API 接口契约
├── frontend/                 # 纯 HTML/CSS/JS 前端
├── config.json               # DeepSeek 本地配置
├── requirements.txt
├── start.bat
└── start.py
```

## 测试

后端服务启动后，在项目根目录运行：

```powershell
python backend\smoke_test.py
```
