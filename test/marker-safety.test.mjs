import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { END, START, mergeIntoFile } from "../dist/markers.js";
import { cleanSummary } from "../dist/ollama.js";
import { render } from "../dist/render.js";
import { tmpTree } from "./helpers.mjs";

const count = (s, sub) => s.split(sub).length - 1;

test("cleanSummary never emits markers or HTML comments", () => {
  for (const reply of [`Parses input. ${END} trailing`, `x ${START} y`, "a <!-- hidden --> b", "<!-- codebase-map:end", "codebase-map:end -->"]) {
    const out = cleanSummary(reply);
    assert.ok(!out.includes("<!--") && !out.includes("-->"), out);
    assert.ok(!/codebase-map:(start|end)/.test(out), out);
    assert.ok(!out.includes("<") && !out.includes(">"), out);
  }
  assert.equal(cleanSummary("Uses <T> generics & maps."), "Uses &lt;T&gt; generics & maps.");
});

test("a hostile AI reply cannot break the next static run", () => {
  const mod = { name: "core", purpose: "p", files: ["core/a.ts"], entryPoints: [], exports: [], deps: new Set() };
  const base = { repoName: "r", analysis: { modules: new Map([["core", mod]]), fanIn: new Map() }, risks: [], hasGit: false, agentFiles: [], fileCount: 1 };
  const out = join(tmpTree({}), "docs", "CODEBASE_MAP.md");
  const evil = cleanSummary(`Core. ${END}\n${START} injected`);
  mergeIntoFile(out, render({ ...base, ai: { model: "m", summaries: new Map([["core", evil]]) } }));
  assert.equal(count(readFileSync(out, "utf8"), END), 1);
  mergeIntoFile(out, render(base));
  const text = readFileSync(out, "utf8");
  assert.ok(!text.includes("AI summary"));
  assert.equal(count(text, START), 1);
  assert.equal(count(text, END), 1);
});

test("mergeIntoFile uses the last end marker, clearing a stray one inside the block", () => {
  const out = join(tmpTree({}), "docs", "CODEBASE_MAP.md");
  mergeIntoFile(out, "x");
  writeFileSync(out, `intro\n${START}\nold ${END} stale text\nmore stale\n${END}\nfooter\n`);
  assert.equal(mergeIntoFile(out, "fresh"), "updated");
  assert.equal(readFileSync(out, "utf8"), `intro\n${START}\nfresh\n${END}\nfooter\n`);
});

test("mergeIntoFile appends when the only end marker comes before the start marker", () => {
  const out = join(tmpTree({}), "docs", "CODEBASE_MAP.md");
  mergeIntoFile(out, "x");
  writeFileSync(out, `${END}\nnotes\n${START}\n`);
  assert.equal(mergeIntoFile(out, "y"), "appended");
});
