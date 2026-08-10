# -*- coding: utf-8 -*-
"""把 data/cards 下的文本卡批量导入到本地服务。"""

import json
import pathlib
import urllib.request

BASE_URL = "http://127.0.0.1:8000"


def import_card(text):
    payload = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + "/api/imports/card-text",
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    cards_dir = pathlib.Path("data") / "cards"
    for path in sorted(cards_dir.glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        result = import_card(text)
        work = result["work"]
        print(f"OK  {work['title']}  work_id={work['id']}")


if __name__ == "__main__":
    main()
