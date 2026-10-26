import { Analysis } from "./analyze.js";
import { Risk } from "./risk.js";

export interface RenderInput {
  repoName: string;
  analysis: Analysis;
  risks: Risk[];
  hasGit: boolean;
  agentFiles: string[];
  fileCount: number;
}

const id = (m: string) => "m_" + (m === "." ? "root" : m.replace(/[^A-Za-z0-9_]/g, "_"));
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function render(inp: RenderInput): string {
  const mods = [...inp.analysis.modules.values()].sort((a, b) => (a.name === "." ? -1 : b.name === "." ? 1 : a.name.localeCompare(b.name)));
  const o: string[] = [];
  o.push(`_Static map of **${inp.repoName}**: ${mods.length} modules, ${inp.fileCount} files._`, "");

  o.push("## Module tree", "", "```text", `${inp.repoName}/`);
  mods.forEach((m, i) => {
    const branch = i === mods.length - 1 ? "└── " : "├── ";
    o.push(`${branch}${m.name === "." ? "(root files)" : m.name + "/"}  (${m.files.length} files)`);
  });
  o.push("```", "", "| Module | Purpose |", "| --- | --- |");
  for (const m of mods) o.push(`| \`${m.name === "." ? "(root)" : m.name}\` | ${cell(m.purpose)} |`);

  o.push("", "## What each module owns", "");
  for (const m of mods) {
    o.push(`### \`${m.name === "." ? "(root)" : m.name}\``, "");
    o.push(`- Entry points: ${m.entryPoints.length ? m.entryPoints.join("; ") : "_none detected_"}`);
    const ex = m.exports.slice(0, 20).map((e) => `\`${e}\``).join(", ");
    o.push(`- Main exports: ${ex || "_none detected_"}${m.exports.length > 20 ? ` and ${m.exports.length - 20} more` : ""}`);
    if (m.deps.size) o.push(`- Depends on: ${[...m.deps].sort().map((d) => `\`${d}\``).join(", ")}`);
    o.push("");
  }

  o.push("## Module dependencies", "", "```mermaid", "graph LR");
  let edges = 0;
  for (const m of mods) for (const d of [...m.deps].sort()) {
    o.push(`  ${id(m.name)}["${m.name === "." ? "(root)" : m.name}"] --> ${id(d)}["${d === "." ? "(root)" : d}"]`);
    edges++;
  }
  if (!edges) for (const m of mods) o.push(`  ${id(m.name)}["${m.name === "." ? "(root)" : m.name}"]`);
  o.push("```", "");
  if (!edges) o.push("_No cross-module relative imports found._", "");

  o.push("## Risky files", "");
  o.push(inp.hasGit ? "Score combines git churn (45%), size in lines (35%) and fan-in, the number of other directories importing the file (20%)."
    : "_No git history found; score uses size (65%) and fan-in (35%) only._", "");
  o.push("| # | File | Score | Churn | Lines | Fan-in |", "| --- | --- | --- | --- | --- | --- |");
  inp.risks.forEach((r, i) => o.push(`| ${i + 1} | \`${r.path}\` | ${r.score} | ${inp.hasGit ? r.churn : "n/a"} | ${r.lines} | ${r.fanIn} |`));

  o.push("", "## Agent and context files", "");
  if (inp.agentFiles.length) for (const f of inp.agentFiles) o.push(`- \`${f}\``);
  else o.push("_None found (looked for AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .cursor/rules/, copilot-instructions.md, .windsurfrules)._");
  o.push("");
  return o.join("\n");
}
