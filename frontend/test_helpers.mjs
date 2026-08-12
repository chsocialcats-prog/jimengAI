import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

export function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source end marker: ${endMarker}`);
  return source.slice(start, end);
}
