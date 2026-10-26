#!/usr/bin/env node
/** codebase-map CLI: writes <repo>/docs/CODEBASE_MAP.md from static analysis. */
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { analyze } from "./analyze.js";
import { findAgentFiles } from "./agents.js";
import { mergeIntoFile } from "./markers.js";
import { render } from "./render.js";
import { gitChurn, rankRisk } from "./risk.js";
import { scanFiles } from "./scan.js";

const USAGE = `Usage: codebase-map [repo-path] [--llm] [--stdout]

Writes <repo>/docs/CODEBASE_MAP.md. Text outside the codebase-map markers is preserved.
  --llm     (stub) Ollama summaries; not implemented yet, falls back to static analysis
  --stdout  print the generated block instead of writing the file`;

export function main(argv: string[]): number {
  const flags = argv.filter((a) => a.startsWith("--"));
  const args = argv.filter((a) => !a.startsWith("--"));
  if (flags.includes("--help")) { console.log(USAGE); return 0; }
  const unknown = flags.filter((f) => !["--llm", "--stdout"].includes(f));
  if (unknown.length) { console.error(`Unknown flag(s): ${unknown.join(", ")}\n\n${USAGE}`); return 2; }
  if (flags.includes("--llm")) console.log("codebase-map: --llm (Ollama summaries) is not implemented yet; using static analysis.");

  const root = resolve(args[0] ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`Not a directory: ${root}`); return 1; }

  const files = scanFiles(root);
  const analysis = analyze(root, files);
  const churn = gitChurn(root);
  const body = render({
    repoName: basename(root),
    analysis,
    risks: rankRisk(files, churn, analysis.fanIn),
    hasGit: churn !== null,
    agentFiles: findAgentFiles(files),
    fileCount: files.length,
  });
  if (flags.includes("--stdout")) { console.log(body); return 0; }
  const out = join(root, "docs", "CODEBASE_MAP.md");
  const how = mergeIntoFile(out, body);
  console.log(`codebase-map: ${how} ${out} (${analysis.modules.size} modules, ${files.length} files)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
