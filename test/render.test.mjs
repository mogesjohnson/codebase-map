import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze } from "../dist/analyze.js";
import { findAgentFiles } from "../dist/agents.js";
import { render } from "../dist/render.js";
import { rankRisk } from "../dist/risk.js";
import { scanFiles } from "../dist/scan.js";
import { FIXTURES } from "./helpers.mjs";

const BASIC = join(FIXTURES, "basic");

function renderBasic(hasGit = false) {
  const files = scanFiles(BASIC);
  const analysis = analyze(BASIC, files);
  return render({ repoName: "basic", analysis, risks: rankRisk(files, null, analysis.fanIn), hasGit, agentFiles: findAgentFiles(files), fileCount: files.length });
}

test("render emits a mermaid graph with one edge per module dependency", () => {
  const out = renderBasic();
  const graph = out.split("```mermaid\n")[1].split("```")[0];
  assert.match(graph, /^graph LR\n/);
  assert.ok(graph.includes('m_web["web"] --> m_core["core"]'));
  assert.ok(graph.includes('m_web["web"] --> m_packages_util["packages/util"]'));
  assert.equal(graph.split("\n").filter((l) => l.includes("-->")).length, 2);
});

test("render lists modules, purposes and agent files", () => {
  const out = renderBasic();
  assert.match(out, /\| `core` \| Core holds the shared parsing helpers\. \|/);
  assert.match(out, /├── core\/  \(3 files\)/);
  assert.ok(out.includes("- `AGENTS.md`"));
  assert.ok(out.includes("- `.cursor/rules/style.mdc`"));
  assert.ok(out.includes("No git history found"));
});

test("render without cross-module imports lists nodes and says so", () => {
  const out = render({
    repoName: "x", analysis: { modules: new Map([[".", { name: ".", purpose: "p", files: ["a.ts"], entryPoints: [], exports: [], deps: new Set() }]]), fanIn: new Map() },
    risks: [], hasGit: true, agentFiles: [], fileCount: 1,
  });
  assert.ok(out.includes('  m_root["(root)"]'));
  assert.ok(out.includes("_No cross-module relative imports found._"));
  assert.ok(out.includes("_None found"));
});

test("findAgentFiles matches agent files and rule dirs only", () => {
  const files = ["AGENTS.md", "pkg/CLAUDE.md", "GEMINI.md", ".cursorrules", ".cursor/rules/a.mdc",
    ".github/copilot-instructions.md", ".claude/settings.json", "README.md", "src/agents.ts", "docs/MYAGENTS.md"]
    .map((path) => ({ path, lines: 1, isCode: false }));
  assert.deepEqual(findAgentFiles(files), ["AGENTS.md", "pkg/CLAUDE.md", "GEMINI.md", ".cursorrules", ".cursor/rules/a.mdc",
    ".github/copilot-instructions.md", ".claude/settings.json"]);
});
