# -*- coding: utf-8 -*-
"""Windows 本地启动脚本。

运行 `python start.py` 会启动 FastAPI 服务，并自动打开浏览器。
运行 `python start.py --no-browser` 可跳过自动打开浏览器。
"""

import argparse
import threading
import time
import webbrowser

import uvicorn

from backend.config import load_config


def open_browser(url, delay):
    """延迟打开浏览器，等服务端口真正可用。"""
    time.sleep(delay)
    webbrowser.open(url, new=2)


def main():
    parser = argparse.ArgumentParser(description="启动 AI 对话冒险平台本地服务")
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="启动服务但不自动打开浏览器",
    )
    args = parser.parse_args()

    config = load_config()
    app_config = config["app"]
    host = app_config.get("host", "127.0.0.1")
    port = int(app_config.get("port", 8000))
    should_open_browser = bool(app_config.get("open_browser", True))
    should_open_browser = should_open_browser and not args.no_browser

    browser_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    url = f"http://{browser_host}:{port}"

    if should_open_browser:
        thread = threading.Thread(
            target=open_browser,
            args=(url, 1.0),
            daemon=True,
        )
        thread.start()

    print(f"AI 对话冒险平台已启动：{url}")
    print("按 Ctrl+C 停止服务。")

    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
