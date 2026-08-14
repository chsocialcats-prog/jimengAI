import assert from "node:assert/strict";
import test from "node:test";

import { createReadOnlyDemoAdapter, READ_ONLY_DEMO_CODE } from "./js/read-only-demo.mjs";
import { renderReadOnlyStatus } from "./js/worldbook-page.mjs";

test("只读演示状态明确禁止设置和私有冒险", () => {
  const adapter = createReadOnlyDemoAdapter();
  assert.match(renderReadOnlyStatus(adapter), /离线只读演示/);
  assert.throws(() => adapter.startAdventure("demo-work"), (error) => error.code === READ_ONLY_DEMO_CODE);
});
