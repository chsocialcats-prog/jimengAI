import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addDynamicRow, collectAttributeRows } from "./js/creator-page.mjs";
import { createDynamicRow, readDynamicRows } from "./js/form-rows.mjs";

const containers = new Map();

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.type = "";
    this.title = "";
    this.value = "";
    this.placeholder = "";
    this._listeners = new Map();
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    for (const match of String(value).matchAll(/<input\b[^>]*>/g)) {
      const input = new FakeElement("input");
      input.className = match[0].match(/class="([^"]*)"/)?.[1] || "";
      input.type = match[0].match(/type="([^"]*)"/)?.[1] || "";
      input.placeholder = match[0].match(/placeholder="([^"]*)"/)?.[1] || "";
      this.appendChild(input);
    }
    const buttonMatch = String(value).match(/<button\b([^>]*)>([\s\S]*?)<\/button>/);
    if (buttonMatch) {
      const button = new FakeElement("button");
      button.className = buttonMatch[1].match(/class="([^"]*)"/)?.[1] || "";
      button.type = buttonMatch[1].match(/type="([^"]*)"/)?.[1] || "";
      button.title = buttonMatch[1].match(/title="([^"]*)"/)?.[1] || "";
      button.innerHTML = buttonMatch[2];
      this.appendChild(button);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    this._listeners.set(type, listener);
  }

  click() {
    this._listeners.get("click")?.({});
  }

  querySelector(selector) {
    if (selector === "button") return this.children.find((child) => child.tagName === "BUTTON") || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "input") return this.children.filter((child) => child.tagName === "INPUT");
    if (selector === ".dynamic-row") return this.children.filter((child) => child.className === "dynamic-row");
    return [];
  }
}

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
  querySelector: (selector) => containers.get(selector) || null,
};

test("createDynamicRow preserves the single-row DOM contract and delete behavior", () => {
  const container = new FakeElement("div");
  const row = createDynamicRow({ mode: "single", placeholder: "保持人设" });
  const input = row.querySelectorAll("input")[0];
  const button = row.querySelector("button");

  assert.equal(row.className, "dynamic-row");
  assert.equal(input.className, "input");
  assert.equal(input.type, "");
  assert.equal(input.placeholder, "保持人设");
  assert.equal(button?.className, "btn btn-sm btn-ghost");
  assert.equal(button?.type, "button");
  assert.equal(button?.title, "删除");
  assert.match(button?.innerHTML || "", /<svg class="icon"/);

  container.appendChild(row);
  button.click();
  assert.equal(container.children.length, 0);
});

test("createDynamicRow preserves pair field order and escaped placeholders", () => {
  const row = createDynamicRow({ mode: "pair", placeholders: ["关系对象 <", "关系说明 &"] });
  const inputs = row.querySelectorAll("input");

  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map((input) => input.className), ["input", "input"]);
  assert.equal(inputs[0].placeholder, "关系对象 &lt;");
  assert.equal(inputs[1].placeholder, "关系说明 &amp;");
  assert.equal(row.querySelector("button")?.type, "button");
});

test("readDynamicRows returns trimmed input values in row and field order", () => {
  const container = new FakeElement("div");
  const first = createDynamicRow({ mode: "pair" });
  const second = createDynamicRow({ mode: "single" });
  first.querySelectorAll("input")[0].value = "  心情  ";
  first.querySelectorAll("input")[1].value = " 50 ";
  second.querySelectorAll("input")[0].value = " 保持人设 ";
  container.appendChild(first);
  container.appendChild(second);

  assert.deepEqual(readDynamicRows(container), [["心情", "50"], ["保持人设"]]);
});

test("creator wrappers preserve attribute conversion and validation", () => {
  const container = new FakeElement("div");
  containers.set("#attributes", container);
  addDynamicRow("#attributes", { mode: "pair", placeholders: ["属性名", "数值或文本"] });
  const first = container.querySelectorAll(".dynamic-row")[0];
  first.querySelectorAll("input")[0].value = " 收入 ";
  first.querySelectorAll("input")[1].value = " 42 ";
  const text = createDynamicRow({ mode: "pair" });
  text.querySelectorAll("input")[0].value = "类型";
  text.querySelectorAll("input")[1].value = " 分类 ";
  container.appendChild(text);
  container.appendChild(createDynamicRow({ mode: "pair" }));

  assert.deepEqual(collectAttributeRows("#attributes"), { 收入: 42, 类型: "分类" });

  const missingKey = new FakeElement("div");
  const missingKeyRow = createDynamicRow({ mode: "pair" });
  missingKeyRow.querySelectorAll("input")[1].value = "value";
  missingKey.appendChild(missingKeyRow);
  containers.set("#attributes", missingKey);
  assert.throws(() => collectAttributeRows("#attributes"), /属性名称不能为空/);

  const duplicate = new FakeElement("div");
  for (const value of ["name", "name"]) {
    const row = createDynamicRow({ mode: "pair" });
    row.querySelectorAll("input")[0].value = value;
    duplicate.appendChild(row);
  }
  containers.set("#attributes", duplicate);
  assert.throws(() => collectAttributeRows("#attributes"), /属性名称重复：name/);
});

test("main single and pair collectors share the dynamic-row reader", async () => {
  const mainJs = await readFile(new URL("./js/main.js", import.meta.url), "utf8");
  assert.match(mainJs, /function collectSingleRows[\s\S]*readDynamicRows\(\$\(selector\)\)/);
  assert.match(mainJs, /function collectPairRows[\s\S]*readDynamicRows\(\$\(selector\)\)/);
});
