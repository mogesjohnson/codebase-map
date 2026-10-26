import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { END, START, mergeIntoFile } from "../dist/markers.js";
import { tmpTree } from "./helpers.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const count = (s, sub) => s.split(sub).length - 1;
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("mergeIntoFile creates, then updates in place keeping outside text and one marker pair", () => {
  const root = tmpTree({});
  const out = join(root, "docs", "CODEBASE_MAP.md");
  assert.equal(mergeIntoFile(out, "first"), "created");
  writeFileSync(out, "My intro\n\n" + readFileSync(out, "utf8") + "\nMy footer\n");
  assert.equal(mergeIntoFile(out, "second"), "updated");
  assert.equal(mergeIntoFile(out, "third"), "updated");
  const text = readFileSync(out, "utf8");
  assert.ok(text.startsWith("My intro\n"));
  assert.ok(text.endsWith("\nMy footer\n"));
  assert.ok(text.includes(`${START}\nthird\n${END}`));
  assert.ok(!text.includes("second") && !text.includes("first"));
  assert.equal(count(text, START), 1);
  assert.equal(count(text, END), 1);
});

test("mergeIntoFile appends a block to a file without markers", () => {
  const root = tmpTree({ "map.md": "Hand written\n\n\n" });
  const out = join(root, "map.md");
  assert.equal(mergeIntoFile(out, "gen"), "appended");
  assert.equal(readFileSync(out, "utf8"), `Hand written\n\n${START}\ngen\n${END}\n`);
});

test("cli --help prints usage and exits 0", () => {
  const r = run("--help");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: codebase-map/);
});

test("cli rejects unknown flags with exit 2", () => {
  const r = run("--nope");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown flag\(s\): --nope/);
});

test("cli fails with exit 1 on a missing directory", () => {
  const r = run(join(tmpTree({}), "missing"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not a directory/);
});

test("cli --stdout prints the map without writing, and the no-git fallback is used", () => {
  const root = tmpTree({ "src/a.ts": "export const a = 1;\n" });
  const r = run(root, "--stdout");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No git history found/);
  assert.equal(existsSync(join(root, "docs", "CODEBASE_MAP.md")), false);
});

test("cli writes docs/CODEBASE_MAP.md and --llm falls back to static analysis", () => {
  const root = tmpTree({ "src/a.ts": "export const a = 1;\n" });
  const r = run(root, "--llm");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not implemented yet/);
  assert.match(r.stdout, /created .*CODEBASE_MAP\.md/);
  const r2 = run(root);
  assert.match(r2.stdout, /updated/);
  assert.equal(count(readFileSync(join(root, "docs", "CODEBASE_MAP.md"), "utf8"), START), 1);
});
