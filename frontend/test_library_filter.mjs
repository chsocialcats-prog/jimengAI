import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filterWorks } from "./js/data.mjs";

const mainSource = readFileSync(new URL("./js/main.js", import.meta.url), "utf8");
const dataImport = mainSource.match(/import \{([\s\S]*?)\} from "\.\/data\.mjs";/)?.[1] || "";

test("作品库可以导入并使用作品筛选函数", () => {
  assert.match(dataImport, /\bfilterWorks,/);

  const works = [
    { title: "迷雾王都", description: "雨夜城门", tags: ["奇幻"] },
    { title: "深夜便利店", description: "城市异闻", tags: ["悬疑"] },
  ];

  assert.deepEqual(filterWorks(works, "雨夜", ""), [works[0]]);
  assert.deepEqual(filterWorks(works, "", "悬疑"), [works[1]]);
});
