#!/usr/bin/env node
/** codebase-map CLI: writes <repo>/docs/CODEBASE_MAP.md from static analysis. */
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { analyze } from "./analyze.js";
import { findAgentFiles } from "./agents.js";
import { mergeIntoFile } from "./markers.js";
import { OLLAMA_DEFAULTS, resolveOllamaUrl, summarizeModules } from "./ollama.js";
import { render, sortModules } from "./render.js";
import { gitChurn, rankRisk } from "./risk.js";
import { scanFiles } from "./scan.js";

const USAGE = `Usage: codebase-map [repo-path] [options]

Writes <repo>/docs/CODEBASE_MAP.md (default repo: current directory).
Text outside the codebase-map markers is preserved.

Options:
  --stdout                  print the generated block instead of writing the file
  --llm                     add an "AI summary" per module from a local Ollama (optional;
                            if Ollama is unreachable, times out or lacks the model, prints
                            one warning and writes the static map, exit code 0)
  --llm-model <name>        Ollama model (default: ${OLLAMA_DEFAULTS.model})
  --ollama-url <url>        Ollama base URL (default: $OLLAMA_HOST, else ${OLLAMA_DEFAULTS.url})
  --llm-timeout <ms>        per-request timeout (default: ${OLLAMA_DEFAULTS.timeoutMs})
  --llm-max-modules <n>     summarize at most n modules (default: ${OLLAMA_DEFAULTS.maxModules})
  --help                    show this help`;

const BOOL = ["--llm", "--stdout", "--help"];
const VALUE = ["--llm-model", "--ollama-url", "--llm-timeout", "--llm-max-modules"];

interface Parsed { args: string[]; flags: Set<string>; values: Map<string, string>; error?: string }

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { args: [], flags: new Set(), values: new Map() };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { p.args.push(a); continue; }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (BOOL.includes(name) && eq < 0) p.flags.add(name);
    else if (VALUE.includes(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined || v === "" || (eq < 0 && v.startsWith("--"))) { p.error = `Missing value for ${name}`; return p; }
      p.values.set(name, v);
    } else unknown.push(a);
  }
  if (unknown.length) p.error = `Unknown flag(s): ${unknown.join(", ")}`;
  return p;
}

function positiveInt(v: string | undefined, def: number, name: string): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${v}"`);
  return n;
}

export async function main(argv: string[]): Promise<number> {
  const p = parseArgs(argv);
  if (p.flags.has("--help")) { console.log(USAGE); return 0; }
  if (p.error) { console.error(`${p.error}\n\n${USAGE}`); return 2; }
  let timeoutMs: number, maxModules: number;
  try {
    timeoutMs = positiveInt(p.values.get("--llm-timeout"), OLLAMA_DEFAULTS.timeoutMs, "--llm-timeout");
    maxModules = positiveInt(p.values.get("--llm-max-modules"), OLLAMA_DEFAULTS.maxModules, "--llm-max-modules");
  } catch (e) { console.error(`${(e as Error).message}\n\n${USAGE}`); return 2; }

  const root = resolve(p.args[0] ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`Not a directory: ${root}`); return 1; }

  const files = scanFiles(root);
  const analysis = analyze(root, files);
  const churn = gitChurn(root);

  let ai: { model: string; summaries: Map<string, string> } | undefined;
  if (p.flags.has("--llm")) {
    const model = p.values.get("--llm-model") ?? OLLAMA_DEFAULTS.model;
    const url = resolveOllamaUrl(p.values.get("--ollama-url"));
    const log = p.flags.has("--stdout") ? console.error : console.log;
    log(`codebase-map: asking Ollama (${model} at ${url}) for module summaries...`);
    const r = await summarizeModules(root, sortModules(analysis), { ...OLLAMA_DEFAULTS, url, model, timeoutMs, maxModules });
    if (r.warning) console.error(`codebase-map: warning: ${r.warning}`);
    else {
      if (r.failed.length) console.error(`codebase-map: warning: no AI summary for ${r.failed.length} module(s): ${r.failed.map((f) => `${f.module} (${f.reason})`).join("; ")}`);
      if (r.capped.length) log(`codebase-map: --llm-max-modules ${maxModules} reached; ${r.capped.length} module(s) keep only the static purpose.`);
      log(`codebase-map: ${r.summaries.size} AI summaries.`);
      if (r.summaries.size) ai = { model, summaries: r.summaries };
    }
  }

  const body = render({
    repoName: basename(root),
    analysis,
    risks: rankRisk(files, churn, analysis.fanIn),
    hasGit: churn !== null,
    agentFiles: findAgentFiles(files),
    fileCount: files.length,
    ai,
  });
  if (p.flags.has("--stdout")) { console.log(body); return 0; }
  const out = join(root, "docs", "CODEBASE_MAP.md");
  const how = mergeIntoFile(out, body);
  console.log(`codebase-map: ${how} ${out} (${analysis.modules.size} modules, ${files.length} files)`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
