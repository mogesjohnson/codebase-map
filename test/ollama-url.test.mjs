import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { analyze } from "../dist/analyze.js";
import { OLLAMA_DEFAULTS, OllamaError, generate, resolveOllamaUrl, summarizeModules } from "../dist/ollama.js";
import { scanFiles } from "../dist/scan.js";
import { FIXTURES } from "./helpers.mjs";

const BASIC = join(FIXTURES, "basic");
const mods = () => [...analyze(BASIC, scanFiles(BASIC)).modules.values()];
const env = (OLLAMA_HOST) => ({ OLLAMA_HOST });

/** A server where every route is answered by `routes[path]` (status, body), else 404 "404 page not found". */
async function server(routes) {
  const hits = [];
  const s = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits.push(`${req.method} ${req.url}`);
      const r = routes[req.url];
      if (!r) { res.writeHead(404, { "content-type": "text/plain" }).end("404 page not found"); return; }
      res.writeHead(r[0], { "content-type": "application/json" }).end(JSON.stringify(r[1]));
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${s.address().port}`, hits, close: () => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }) };
}
const opts = (url, model = "llama3.2") => ({ ...OLLAMA_DEFAULTS, url, model, timeoutMs: 2_000 });
const kindOf = async (p) => { try { await p; return "ok"; } catch (e) { assert.ok(e instanceof OllamaError); return e; } };

test("resolveOllamaUrl defaults the port to 11434 when none is given", () => {
  assert.equal(resolveOllamaUrl(undefined, env("127.0.0.1")), "http://127.0.0.1:11434");
  assert.equal(resolveOllamaUrl(undefined, env("0.0.0.0")), "http://0.0.0.0:11434");
  assert.equal(resolveOllamaUrl(undefined, env("myhost")), "http://myhost:11434");
  assert.equal(resolveOllamaUrl("http://host"), "http://host:11434");
  assert.equal(resolveOllamaUrl("http://host/"), "http://host:11434");
  assert.equal(resolveOllamaUrl(undefined, env("[::1]")), "http://[::1]:11434");
  assert.equal(resolveOllamaUrl(undefined, env(" ")), "http://localhost:11434");
});

test("resolveOllamaUrl keeps an explicit port, https default and a path", () => {
  assert.equal(resolveOllamaUrl(undefined, env("127.0.0.1:9999")), "http://127.0.0.1:9999");
  assert.equal(resolveOllamaUrl("http://host:80"), "http://host:80");
  assert.equal(resolveOllamaUrl("https://ollama.example"), "https://ollama.example");
  assert.equal(resolveOllamaUrl("https://ollama.example:8443/proxy/"), "https://ollama.example:8443/proxy");
  assert.equal(resolveOllamaUrl("http://[::1]:5000"), "http://[::1]:5000");
  assert.equal(resolveOllamaUrl("http://flag:1", env("env:2")), "http://flag:1");
});

test("404 with Ollama's model error is reported as a missing model", async () => {
  const s = await server({ "/api/generate": [404, { error: 'model "ghost" not found, try pulling it first' }] });
  try {
    const e = await kindOf(generate("p", opts(s.url, "ghost")));
    assert.equal(e.kind, "model");
    assert.match(e.message, /ollama pull ghost/);
    assert.ok(!s.hits.includes("GET /api/version"));
  } finally { await s.close(); }
});

test("404 from a non-Ollama server is reported as a wrong URL, not a missing model", async () => {
  const s = await server({});
  try {
    const e = await kindOf(generate("p", opts(s.url)));
    assert.equal(e.kind, "not-ollama");
    assert.match(e.message, /no Ollama API at .*check --ollama-url or OLLAMA_HOST/);
    assert.ok(!/ollama pull/.test(e.message));
    assert.deepEqual(s.hits, ["POST /api/generate", "GET /api/version"]);
  } finally { await s.close(); }
});

test("a wrong URL skips the whole AI pass with one warning after one probe", async () => {
  const s = await server({});
  try {
    const r = await summarizeModules(BASIC, mods(), opts(s.url));
    assert.equal(r.summaries.size, 0);
    assert.match(r.warning, /no Ollama API/);
    assert.equal(s.hits.length, 2);
  } finally { await s.close(); }
});

test("404 from a real Ollama without a model error is an HTTP error, not 'pull the model'", async () => {
  const s = await server({ "/api/generate": [404, { error: "something else" }], "/api/version": [200, { version: "0.5.0" }] });
  try {
    const e = await kindOf(generate("p", opts(s.url)));
    assert.equal(e.kind, "http");
    assert.match(e.message, /answered 404 for \/api\/generate: something else/);
  } finally { await s.close(); }
});
