import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze } from "../dist/analyze.js";
import { OLLAMA_DEFAULTS, OllamaError, buildPrompt, cleanSummary, generate, resolveOllamaUrl, summarizeModules } from "../dist/ollama.js";
import { scanFiles } from "../dist/scan.js";
import { FIXTURES } from "./helpers.mjs";
import { deadUrl, mockOllama } from "./ollama-mock.mjs";

const BASIC = join(FIXTURES, "basic");
const mods = () => [...analyze(BASIC, scanFiles(BASIC)).modules.values()].sort((a, b) => a.name.localeCompare(b.name));
const opts = (url, extra = {}) => ({ ...OLLAMA_DEFAULTS, url, timeoutMs: 2_000, ...extra });

test("resolveOllamaUrl: flag, then OLLAMA_HOST, then default; adds http:// and drops trailing slash", () => {
  assert.equal(resolveOllamaUrl(undefined, {}), "http://localhost:11434");
  assert.equal(resolveOllamaUrl(undefined, { OLLAMA_HOST: "0.0.0.0:9999" }), "http://0.0.0.0:9999");
  assert.equal(resolveOllamaUrl("https://box:1/", { OLLAMA_HOST: "x:2" }), "https://box:1");
});

test("buildPrompt includes path, exports, imports and snippets, and respects the size cap", () => {
  const web = mods().find((m) => m.name === "web");
  const p = buildPrompt(BASIC, web, 6_000);
  assert.match(p, /Module path: web/);
  assert.match(p, /Imports from modules: core, packages\/util/);
  assert.match(p, /--- web\/main\.ts ---/);
  assert.ok(buildPrompt(BASIC, web, 300).length <= 300);
});

test("cleanSummary collapses whitespace, strips think blocks and caps length", () => {
  assert.equal(cleanSummary("<think>x</think>\n Parses\n  input. "), "Parses input.");
  assert.equal(cleanSummary("a".repeat(500)).length, 400);
});

test("success: one stream:false request per module, summaries keyed by module", async () => {
  const mock = await mockOllama();
  try {
    const r = await summarizeModules(BASIC, mods(), opts(mock.url, { model: "tiny" }));
    assert.equal(r.warning, undefined);
    assert.equal(r.summaries.get("core"), "Summary of core.");
    assert.equal(r.summaries.size, mods().length);
    assert.equal(mock.requests.length, mods().length);
    assert.equal(mock.requests[0].method, "POST");
    assert.equal(mock.requests[0].body.stream, false);
    assert.equal(mock.requests[0].body.model, "tiny");
  } finally { await mock.close(); }
});

test("module cap: only the first N modules are sent", async () => {
  const mock = await mockOllama();
  try {
    const r = await summarizeModules(BASIC, mods(), opts(mock.url, { maxModules: 1 }));
    assert.equal(mock.requests.length, 1);
    assert.equal(r.summaries.size, 1);
    assert.equal(r.capped.length, mods().length - 1);
  } finally { await mock.close(); }
});

test("unreachable host: one warning, no summaries, no throw", async () => {
  const r = await summarizeModules(BASIC, mods(), opts(await deadUrl()));
  assert.equal(r.summaries.size, 0);
  assert.match(r.warning, /cannot reach Ollama/);
  assert.match(r.warning, /static map/);
});

test("timeout: request is aborted, AI pass is skipped after the first module", async () => {
  const mock = await mockOllama(() => { /* never answers */ });
  try {
    const t0 = Date.now();
    const r = await summarizeModules(BASIC, mods(), opts(mock.url, { timeoutMs: 150 }));
    assert.match(r.warning, /did not answer within 150 ms/);
    assert.equal(r.summaries.size, 0);
    assert.equal(mock.requests.length, 1);
    assert.ok(Date.now() - t0 < 1_500);
  } finally { await mock.close(); }
});

test("missing model (404): clear warning that names ollama pull", async () => {
  const mock = await mockOllama((body, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` }));
  });
  try {
    const r = await summarizeModules(BASIC, mods(), opts(mock.url, { model: "nope" }));
    assert.equal(r.summaries.size, 0);
    assert.match(r.warning, /model "nope" not found.*ollama pull nope/);
    assert.equal(mock.requests.length, 1);
  } finally { await mock.close(); }
});

test("per-module failure skips only that module", async () => {
  const mock = await mockOllama((body, res) => {
    if (body.prompt.includes("Module path: core")) { res.writeHead(500).end("boom"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ response: "ok summary" }));
  });
  try {
    const r = await summarizeModules(BASIC, mods(), opts(mock.url));
    assert.equal(r.warning, undefined);
    assert.equal(r.summaries.has("core"), false);
    assert.equal(r.summaries.get("web"), "ok summary");
    assert.deepEqual(r.failed.map((f) => f.module), ["core"]);
    assert.match(r.failed[0].reason, /HTTP 500/);
  } finally { await mock.close(); }
});

test("generate works with an injected fetch and rejects empty responses", async () => {
  const fake = async () => new Response(JSON.stringify({ response: "  hi " }), { status: 200 });
  assert.equal(await generate("p", opts("http://x", { fetchImpl: fake })), "  hi ");
  const empty = async () => new Response(JSON.stringify({ response: "" }), { status: 200 });
  await assert.rejects(generate("p", opts("http://x", { fetchImpl: empty })), (e) => e instanceof OllamaError && e.kind === "bad-response");
});
