import assert from "node:assert/strict";
import test from "node:test";

import { projectOwnership } from "./js/domain/ownership.mjs";

test("所有权投影只根据后端 can_edit 决定编辑入口", () => {
  const projection = projectOwnership({
    owner_username: "alice",
    can_edit: false,
    current_username: "alice",
  });

  assert.equal(projection.ownerLabel, "创建者：alice");
  assert.equal(projection.canEdit, false);
  assert.equal(projection.showEdit, false);
  assert.equal(projection.isReadOnly, true);
  assert.ok(projection.readOnlyReason);
});

test("can_edit 为 true 时显示编辑入口，不比较用户名", () => {
  const projection = projectOwnership({ owner_username: "someone-else", can_edit: true });

  assert.equal(projection.canEdit, true);
  assert.equal(projection.showEdit, true);
  assert.equal(projection.isReadOnly, false);
  assert.equal(projection.readOnlyReason, null);
});

test("缺少创建者字段时不推测身份并保持只读", () => {
  const projection = projectOwnership({});

  assert.equal(projection.ownerLabel, "创建者：未知");
  assert.equal(projection.canEdit, false);
  assert.equal(projection.showEdit, false);
  assert.equal(projection.isReadOnly, true);
});
