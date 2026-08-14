import assert from "node:assert/strict";
import test from "node:test";

import {
  READ_ONLY_DEMO_CODE,
  createReadOnlyDemoAdapter,
  readOnlyDemoData,
} from "./js/read-only-demo.mjs";

test("只读演示返回深拷贝，外部修改不会污染内置数据", () => {
  const adapter = createReadOnlyDemoAdapter();
  const first = adapter.getSnapshot();
  first.works[0].title = "被篡改";
  first.cards.push({ id: "fake" });

  const second = adapter.getSnapshot();
  assert.notEqual(second.works[0].title, "被篡改");
  assert.equal(second.cards.some((card) => card.id === "fake"), false);
  assert.equal(Object.isFrozen(readOnlyDemoData), true);
});

test("只读演示提供最小作品、角色卡和世界书展示数据", () => {
  const adapter = createReadOnlyDemoAdapter();

  assert.ok(adapter.listWorks().length > 0);
  assert.ok(adapter.listCards().length > 0);
  assert.ok(adapter.listWorldbooks().length > 0);
});

test("所有写入和开始冒险入口都抛出 read_only_demo", () => {
  const adapter = createReadOnlyDemoAdapter();
  for (const method of ["create", "update", "delete", "startAdventure", "save"]) {
    assert.throws(() => adapter[method]({ id: "demo" }), (error) => error.code === READ_ONLY_DEMO_CODE, method);
  }
});

test("演示适配器不访问旧 localStorage、sessionStorage 或私有会话", () => {
  const adapter = createReadOnlyDemoAdapter();
  assert.equal(typeof adapter.localStorage, "undefined");
  assert.equal(typeof adapter.sessionStorage, "undefined");
  assert.equal(typeof adapter.listConversations, "undefined");
});
