/** Optional Ollama client for --llm: one short AI summary per module via the local /api/generate API. */
import { Module } from "./analyze.js";
import { CODE_EXT, readText } from "./scan.js";

export interface OllamaOptions {
  url: string;
  model: string;
  /** Per-request timeout in milliseconds, enforced with AbortController. */
  timeoutMs: number;
  /** At most this many modules are summarized; the rest keep only their static purpose. */
  maxModules: number;
  /** Hard cap on the characters in one prompt. */
  maxPromptChars: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export const OLLAMA_DEFAULTS = {
  url: "http://localhost:11434",
  model: "llama3.2",
  timeoutMs: 60_000,
  maxModules: 30,
  maxPromptChars: 6_000,
} as const;

export type OllamaErrorKind = "unreachable" | "timeout" | "model" | "not-ollama" | "http" | "bad-response";

export class OllamaError extends Error {
  constructor(public kind: OllamaErrorKind, message: string) { super(message); this.name = "OllamaError"; }
}

/** Errors that will fail for every module, so the whole AI pass is skipped after the first one. */
const FATAL: OllamaErrorKind[] = ["unreachable", "timeout", "model", "not-ollama"];

/**
 * --ollama-url wins, then OLLAMA_HOST, then the default. Like Ollama's own client, a value without a
 * scheme gets http:// and a value without a port gets 11434. Unlike Ollama (which uses 80 there),
 * http:// without a port also gets 11434, since Ollama practically never listens on 80; https://
 * without a port keeps 443. An explicit port is always kept.
 */
export function resolveOllamaUrl(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
  let raw = flag?.trim() || env.OLLAMA_HOST?.trim() || OLLAMA_DEFAULTS.url;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "http://" + raw;
  let u: URL;
  try { u = new URL(raw); } catch { return raw.replace(/\/+$/, ""); }
  // URL drops a default port (":80"), so read the explicit port from the text itself.
  const explicit = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(?:\[[^\]]*\]|[^/:?#]*)(:\d+)/i)?.[1] ?? "";
  const port = explicit || (u.protocol === "http:" ? ":11434" : "");
  return `${u.protocol}//${u.hostname}${port}${u.pathname.replace(/\/+$/, "")}`;
}

/** GET <url>/api/version once; true when the answer looks like Ollama's ({"version": "..."}). */
async function looksLikeOllama(opts: OllamaOptions): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs, 5_000));
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${opts.url}/api/version`, { signal: ctrl.signal });
    const data = JSON.parse(await res.text());
    return res.ok && typeof data?.version === "string";
  } catch { return false; } finally { clearTimeout(timer); }
}

/** Tell a missing model apart from a wrong URL or a server that is not Ollama. */
async function diagnose404(raw: string, opts: OllamaOptions): Promise<OllamaError> {
  let msg = "";
  try { const e = JSON.parse(raw)?.error; if (typeof e === "string") msg = e; } catch { /* not JSON */ }
  if (msg && (/model\b.*not found/i.test(msg) || msg.includes(opts.model))) {
    return new OllamaError("model", `model "${opts.model}" not found at ${opts.url}; run \`ollama pull ${opts.model}\``);
  }
  if (await looksLikeOllama(opts)) {
    return new OllamaError("http", `Ollama at ${opts.url} answered 404 for /api/generate: ${(msg || raw).slice(0, 200)}`);
  }
  return new OllamaError("not-ollama", `no Ollama API at ${opts.url} (POST /api/generate returned 404 and /api/version did not answer like Ollama); check --ollama-url or OLLAMA_HOST`);
}

/** POST one prompt to <url>/api/generate with stream:false and return the response text. */
export async function generate(prompt: string, opts: OllamaOptions): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await doFetch(`${opts.url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, prompt, stream: false, options: { temperature: 0.2 } }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new OllamaError("timeout", `Ollama did not answer within ${opts.timeoutMs} ms at ${opts.url}`);
    throw new OllamaError("unreachable", `cannot reach Ollama at ${opts.url} (${(e as Error).message})`);
  }
  try {
    const raw = await res.text();
    if (res.status === 404) throw await diagnose404(raw, opts);
    if (!res.ok) throw new OllamaError("http", `Ollama returned HTTP ${res.status}: ${raw.slice(0, 200)}`);
    let data: { response?: unknown; error?: unknown };
    try { data = JSON.parse(raw); } catch { throw new OllamaError("bad-response", "Ollama returned invalid JSON"); }
    if (typeof data.error === "string") throw new OllamaError("http", `Ollama error: ${data.error}`);
    if (typeof data.response !== "string" || !data.response.trim()) throw new OllamaError("bad-response", "Ollama returned an empty response");
    return data.response;
  } catch (e) {
    if (e instanceof OllamaError) throw e;
    if (ctrl.signal.aborted) throw new OllamaError("timeout", `Ollama did not answer within ${opts.timeoutMs} ms at ${opts.url}`);
    throw new OllamaError("bad-response", `could not read Ollama response (${(e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
}

const label = (m: string) => (m === "." ? "(root)" : m);

/** Package (non-relative) import specifiers in a file, for prompt context. */
function packageImports(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:from\s*|require\(\s*|import\s*\(?\s*)['"]([^'".][^'"]*)['"]/g)) out.add(m[1]);
  return [...out];
}

/** A short prompt: module path, static purpose, exports, imports and capped file snippets. */
export function buildPrompt(root: string, mod: Module, maxChars: number): string {
  const code = mod.files.filter((f) => CODE_EXT.test(f));
  const pkgs = new Set<string>();
  for (const f of code.slice(0, 20)) for (const p of packageImports(readText(root, f))) pkgs.add(p);
  const head = [
    "You are documenting a codebase for a new contributor.",
    `In one or two plain sentences (at most 50 words, no markdown, no preamble), say what the module \`${label(mod.name)}\` does.`,
    "",
    `Module path: ${label(mod.name)}`,
    `Static purpose: ${mod.purpose}`,
    `Exports: ${mod.exports.slice(0, 30).join(", ") || "none detected"}`,
    `Imports from modules: ${[...mod.deps].sort().map(label).join(", ") || "none"}`,
    `Imports from packages: ${[...pkgs].slice(0, 20).join(", ") || "none"}`,
    `Files (${mod.files.length}): ${mod.files.slice(0, 25).join(", ")}${mod.files.length > 25 ? ", ..." : ""}`,
    "",
    "Snippets:",
  ].join("\n");
  let out = head.slice(0, maxChars);
  const perFile = 1_200;
  for (const f of [...code, ...mod.files.filter((x) => /readme/i.test(x))].slice(0, 6)) {
    const snippet = `\n--- ${f} ---\n${readText(root, f).slice(0, perFile)}\n`;
    if (out.length + snippet.length > maxChars) { out += snippet.slice(0, Math.max(0, maxChars - out.length)); break; }
    out += snippet;
  }
  return out.slice(0, maxChars);
}

/**
 * One line, at most 400 characters, safe to write between the map markers: marker names are removed
 * and every < and > is escaped, so a reply can never open an HTML comment or fake a marker.
 */
export function cleanSummary(s: string): string {
  const one = s.replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/codebase-map:(start|end)/gi, "")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\s+/g, " ").trim();
  return truncateWords(one, 400);
}

/** Cut at a word boundary at or before max characters (including the ellipsis) and add "…". */
export function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  // never leave half an escape such as "&l"
  cut = cut.replace(/&[a-z]*$/i, "").replace(/[\s,;:.\-]+$/, "");
  return cut + "…";
}

export interface SummaryResult {
  summaries: Map<string, string>;
  /** Set when the whole AI pass was skipped (Ollama unreachable, timeout, missing model). */
  warning?: string;
  /** Modules skipped by a per-module failure, with the reason. */
  failed: { module: string; reason: string }[];
  /** Modules over the --llm-max-modules cap. */
  capped: string[];
  /** Set when the pass stopped early after repeated per-module failures; summaries so far are kept. */
  stopped?: string;
}

/** Stop asking after this many per-module request failures in a row. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Summarize modules in order, one request at a time. Never throws. */
export async function summarizeModules(root: string, modules: Module[], opts: OllamaOptions): Promise<SummaryResult> {
  const result: SummaryResult = { summaries: new Map(), failed: [], capped: modules.slice(opts.maxModules).map((m) => m.name) };
  const todo = modules.slice(0, opts.maxModules);
  let streak = 0;
  for (const mod of todo) {
    try {
      const text = cleanSummary(await generate(buildPrompt(root, mod, opts.maxPromptChars), opts));
      streak = 0;
      if (text) result.summaries.set(mod.name, text);
      else result.failed.push({ module: mod.name, reason: "reply was empty after removing <think> blocks" });
    } catch (e) {
      const err = e instanceof OllamaError ? e : new OllamaError("bad-response", String(e));
      if (FATAL.includes(err.kind)) {
        return { summaries: new Map(), failed: [], capped: result.capped, warning: `${err.message}. Skipping AI summaries; writing the static map.` };
      }
      result.failed.push({ module: mod.name, reason: err.message });
      if (++streak >= MAX_CONSECUTIVE_FAILURES) {
        const left = todo.length - todo.indexOf(mod) - 1;
        result.stopped = `stopped after ${streak} failed requests in a row (last: ${err.message}); ${left} more module(s) not asked`;
        break;
      }
    }
  }
  return result;
}
