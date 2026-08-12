import { icon } from "./icons.js";
import { esc } from "./core/format.mjs";

export function createDynamicRow(options = {}) {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  if (options.mode === "pair") {
    row.innerHTML = `
      <input class="input" placeholder="${esc(options.placeholders?.[0] || "名称")}">
      <input class="input" placeholder="${esc(options.placeholders?.[1] || "说明")}">
      <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>`;
  } else {
    row.innerHTML = `
      <input class="input" placeholder="${esc(options.placeholder || "内容")}">
      <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>`;
  }
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

export function readDynamicRows(container) {
  return Array.from(container?.querySelectorAll(".dynamic-row") || [])
    .map((row) => Array.from(row.querySelectorAll("input")).map((input) => input.value.trim()));
}
