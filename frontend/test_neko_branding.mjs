import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("./css/style.css", import.meta.url), "utf8");
const iconPath = new URL("./assets/neko-icon.png", import.meta.url);

test("top-left brand uses the NEKO icon and wordmark", () => {
  assert.match(indexSource, /<title>NEKO · AI 对话冒险<\/title>/);
  assert.match(indexSource, /<img class="brand-logo" src="assets\/neko-icon\.png" alt="">/);
  assert.match(indexSource, /<span class="brand-text">NEKO<\/span>/);
  assert.doesNotMatch(indexSource, /data-icon="compass"/);
  assert.doesNotMatch(indexSource, /<span class="brand-text">AI 对话冒险<\/span>/);
});

test("NEKO brand styles and transparent asset hook exist", () => {
  assert.match(cssSource, /\.brand-logo\s*\{/);
  assert.match(cssSource, /\.brand-text\s*\{/);
  assert.match(cssSource, /letter-spacing:\s*0\.2em/);
  assert.doesNotMatch(cssSource, /\.brand-mark\s*\{/);
  assert.equal(existsSync(iconPath), true);
});
