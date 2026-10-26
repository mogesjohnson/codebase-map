import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../dist/analyze.js";
import { MAX_CONSECUTIVE_FAILURES, OLLAMA_DEFAULTS, cleanSummary, summarizeModules, truncateWords } from "../dist/ollama.js";
import { render } from "../dist/render.js";
import { scanFiles } from "../dist/scan.js";
import { tmpTree } from "./helpers.mjs";
import { mockOllama } from "./ollama-mock.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const SIX = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((m) => [`${m}/index.ts`, `export const ${m} = 1;\n`]));
const modsOf = (root) => [...analyze(root, scanFiles(root)).modules.values()].sort((x, y) => x.name.localeCompare(y.name));
const opts = (url) => ({ ...OLLAMA_DEFAULTS, url, timeoutMs: 2_000 });
const reply = (text) => (body, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ response: text })); };
function run(args, env = {}) {
  return new Promise((res) => execFile(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } },
    (err, stdout, stderr) => res({ status: err ? err.code : 0, stdout, stderr })));
}

test("truncateWords cuts at a word boundary with an ellipsis and never splits an escape", () => {
  const long = "word ".repeat(100).trim();
  const out = truncateWords(long, 400);
  assert.ok(out.length <= 400);
  assert.ok(out.endsWith("word…"));
  assert.equal(truncateWords("short", 400), "short");
  assert.ok(!/&[a-z]*…$/.test(truncateWords("x".repeat(395) + " &lt;T&gt; more words", 400)));
  assert.ok(cleanSummary("lorem ipsum ".repeat(60)).endsWith("…"));
});

test("a reply that is only <think>...</think> warns for that module", async () => {
  const mock = await mockOllama(reply("<think>pondering</think>"));
  try {
    const root = tmpTree({ "a/index.ts": "export const a = 1;\n" });
    const r = await summarizeModules(root, modsOf(root), opts(mock.url));
    assert.equal(r.summaries.size, 0);
    assert.deepEqual(r.failed.map((f) => f.module), ["a"]);
    assert.match(r.failed[0].reason, /empty after removing <think> blocks/);
    const cli = await run([root, "--llm", "--ollama-url", mock.url]);
    assert.equal(cli.status, 0);
    assert.match(cli.stderr, /warning: no AI summary for 1 module\(s\): a \(reply was empty/);
  } finally { await mock.close(); }
});

test(`repeated server errors stop after ${MAX_CONSECUTIVE_FAILURES} requests in a row with one warning`, async () => {
  const mock = await mockOllama((body, res) => res.writeHead(500).end("overloaded"));
  try {
    const root = tmpTree(SIX);
    const r = await summarizeModules(root, modsOf(root), opts(mock.url));
    assert.equal(mock.requests.length, MAX_CONSECUTIVE_FAILURES);
    assert.match(r.stopped, /stopped after 3 failed requests in a row .*HTTP 500.*; 3 more module\(s\) not asked/);
    const cli = await run([root, "--llm", "--ollama-url", mock.url]);
    assert.equal(cli.status, 0);
    assert.equal((cli.stderr.match(/warning/g) || []).length, 1);
    assert.match(cli.stderr, /stopped after 3 failed requests in a row/);
  } finally { await mock.close(); }
});

test("a success resets the failure streak", async () => {
  let n = 0;
  const mock = await mockOllama((body, res) => (++n % 3 === 0 ? reply("fine")(body, res) : res.writeHead(500).end("x")));
  try {
    const root = tmpTree(SIX);
    const r = await summarizeModules(root, modsOf(root), opts(mock.url));
    assert.equal(mock.requests.length, 6);
    assert.equal(r.stopped, undefined);
    assert.equal(r.summaries.size, 2);
  } finally { await mock.close(); }
});

test("header says Static map only without AI summaries, and counts use singulars", () => {
  const root = tmpTree({ "a/index.ts": "export const a = 1;\n" });
  const files = scanFiles(root);
  const base = { repoName: "r", analysis: analyze(root, files), risks: [], hasGit: false, agentFiles: [], fileCount: files.length };
  const plain = render(base);
  assert.match(plain, /^_Static map of \*\*r\*\*: 1 module, 1 file\._/);
  assert.match(plain, /└── a\/  \(1 file\)/);
  const ai = render({ ...base, ai: { model: "m", summaries: new Map([["a", "A."]]) } });
  assert.match(ai, /^_Map of \*\*r\*\*: 1 module, 1 file\. Static analysis plus AI summaries from Ollama `m`\._/);
  assert.ok(!ai.includes("Static map"));
});

test("--llm --stdout keeps progress on stderr and only the map on stdout", async () => {
  const mock = await mockOllama();
  try {
    const root = tmpTree({ "a/index.ts": "export const a = 1;\n" });
    const r = await run([root, "--llm", "--stdout", "--ollama-url", mock.url]);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.startsWith("_Map of"), r.stdout.slice(0, 80));
    assert.ok(!r.stdout.includes("codebase-map:"));
    assert.match(r.stderr, /asking Ollama/);
    assert.match(r.stderr, /1 AI summary\./);
  } finally { await mock.close(); }
});
