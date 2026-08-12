import assert from "node:assert/strict";
import test from "node:test";
import { createDynamicRow, readDynamicRows } from "./js/form-rows.mjs";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.value = "";
    this.placeholder = "";
    this._listeners = new Map();
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    const inputMatches = [...String(value).matchAll(/<input\b[^>]*placeholder="([^"]*)"/g)];
    for (const match of inputMatches) {
      const input = new FakeElement("input");
      input.placeholder = match[1];
      this.appendChild(input);
    }
    if (String(value).includes("<button")) this.appendChild(new FakeElement("button"));
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
};

test("createDynamicRow preserves single-value row markup and delete behavior", () => {
  const container = new FakeElement("div");
  const row = createDynamicRow({ mode: "single", placeholder: "保持人设" });

  assert.equal(row.className, "dynamic-row");
  assert.match(row.innerHTML, /placeholder="保持人设"/);
  assert.equal(row.querySelectorAll("input").length, 1);
  assert.equal(row.querySelector("button")?.tagName, "BUTTON");

  container.appendChild(row);
  row.querySelector("button").click();
  assert.equal(container.children.length, 0);
});

test("createDynamicRow preserves pair field order and escaped placeholders", () => {
  const row = createDynamicRow({ mode: "pair", placeholders: ["关系对象 <", "关系说明 &"] });
  const inputs = row.querySelectorAll("input");

  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].placeholder, "关系对象 &lt;");
  assert.equal(inputs[1].placeholder, "关系说明 &amp;");
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
