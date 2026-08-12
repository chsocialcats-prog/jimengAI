import { icon } from "./icons.js";
import { esc } from "./core/format.mjs";

export function createDynamicRow(options = {}) {
  const row = document.createElement("div"); row.className = "dynamic-row";
  const placeholders = options.mode === "pair"
    ? options.placeholders || ["名称", "说明"]
    : [options.placeholder || "内容"];
  row.innerHTML = `${placeholders.map((placeholder) => `<input class="input" placeholder="${esc(placeholder)}">`).join("")}
    <button type="button" class="btn btn-sm btn-ghost" title="删除">${icon("trash")}</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

export function readDynamicRows(container) {
  return Array.from(container?.querySelectorAll(".dynamic-row") || [])
    .map((row) => Array.from(row.querySelectorAll("input")).map((input) => input.value.trim()));
}
