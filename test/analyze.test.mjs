import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze, headerComment, moduleOf, parseExports, parseImports, readmePurpose, resolveImport } from "../dist/analyze.js";
import { scanFiles } from "../dist/scan.js";
import { FIXTURES, tmpTree } from "./helpers.mjs";

const BASIC = join(FIXTURES, "basic");

test("readmePurpose skips headings and badges and takes the first sentence", () => {
  const text = "# Title\n\n[![ci](b)](c)\n\n<!-- hidden -->\nThis module parses the config files. Second sentence.\n";
  assert.equal(readmePurpose(text), "This module parses the config files.");
});

test("headerComment reads block, line and hash comments after a shebang", () => {
  assert.equal(headerComment("#!/usr/bin/env node\n/** Runs the main build pipeline. */\nx"), "Runs the main build pipeline.");
  assert.equal(headerComment("// Helpers for date formatting.\n// More.\nconst a = 1;"), "Helpers for date formatting.");
  assert.equal(headerComment("# Shell helpers for release tasks.\necho"), "Shell helpers for release tasks.");
  assert.equal(headerComment("const a = 1;"), "");
});

test("module purpose comes from README, then package.json description, then a top comment", () => {
  const { modules } = analyze(BASIC, scanFiles(BASIC));
  assert.equal(modules.get("core").purpose, "Core holds the shared parsing helpers.");
  assert.equal(modules.get("packages/util").purpose, "Tiny string padding utilities.");
  assert.equal(modules.get("web").purpose, "Web front end that renders the parsed output.");
});

test("parseExports finds declarations, re-exports, defaults and CommonJS", () => {
  const src = [
    "export async function load() {}",
    "export class Store {}",
    "export const A = 1, b = 2;",
    "export interface Opts {}",
    "export type Id = string;",
    "export enum Color { Red }",
    "export { x as y, type Z };",
    "exports.helper = 1;",
  ].join("\n");
  assert.deepEqual(new Set(parseExports(src)), new Set(["load", "Store", "A", "Opts", "Id", "Color", "y", "Z", "helper"]));
  assert.deepEqual(parseExports("export default function () {}"), ["default"]);
  assert.deepEqual(parseExports("module.exports = {}"), ["module.exports"]);
});

test("parseImports keeps only relative specifiers from every import form", () => {
  const src = [
    "import a from './a.js';",
    "import { b } from \"../b\";",
    "import './side.css';",
    "export * from './re';",
    "const c = await import('./lazy');",
    "const d = require('./d.cjs');",
    "import fs from 'node:fs';",
    "import React from 'react';",
  ].join("\n");
  assert.deepEqual(new Set(parseImports(src)), new Set(["./a.js", "../b", "./side.css", "./re", "./lazy", "./d.cjs"]));
});

test("resolveImport maps .js to .ts, adds extensions and index files, and rejects escapes", () => {
  const known = new Set(["src/a.ts", "src/lib/index.ts", "src/b.mjs", "web/x.tsx"]);
  assert.equal(resolveImport("/nope", "src/main.ts", "./a.js", known), "src/a.ts");
  assert.equal(resolveImport("/nope", "src/main.ts", "./lib", known), "src/lib/index.ts");
  assert.equal(resolveImport("/nope", "src/main.ts", "./b", known), "src/b.mjs");
  assert.equal(resolveImport("/nope", "src/main.ts", "../web/x", known), "web/x.tsx");
  assert.equal(resolveImport("/nope", "src/main.ts", "../../outside", known), null);
  assert.equal(resolveImport("/nope", "src/main.ts", "./missing", known), null);
});

test("moduleOf prefers the deepest package dir, else the top-level folder", () => {
  const pkgs = ["packages/util/sub", "packages/util"];
  assert.equal(moduleOf("packages/util/sub/a.ts", pkgs), "packages/util/sub");
  assert.equal(moduleOf("packages/util/a.ts", pkgs), "packages/util");
  assert.equal(moduleOf("src/a.ts", pkgs), "src");
  assert.equal(moduleOf("README.md", pkgs), ".");
});

test("analyze builds module deps, exports, entry points and fan-in", () => {
  const { modules, fanIn } = analyze(BASIC, scanFiles(BASIC));
  assert.deepEqual([...modules.get("web").deps].sort(), ["core", "packages/util"]);
  assert.equal(modules.get("core").deps.size, 0);
  assert.ok(modules.get("core").exports.includes("parse"));
  assert.ok(modules.get("core").exports.includes("parseIt"));
  assert.ok(modules.get("packages/util").exports.includes("pad"));
  assert.ok(modules.get("packages/util").entryPoints.includes("main: `packages/util/index.js`"));
  assert.deepEqual([...fanIn.get("core/index.ts")], ["web"]);
  assert.equal(fanIn.has("core/parse.ts"), false, "same-directory imports do not count as fan-in");
});

test("a module with only docs is labelled Documentation", () => {
  const root = tmpTree({ "docs/guide.md": "# Guide\n" });
  const { modules } = analyze(root, scanFiles(root));
  assert.equal(modules.get("docs").purpose, "Documentation.");
});
