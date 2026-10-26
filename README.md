# codebase-map

`codebase-map` writes `docs/CODEBASE_MAP.md`, a living onboarding and architecture page for a repo.
It uses static analysis only (no LLM, no network) and has zero runtime dependencies.

## What the page contains

1. **Module tree** with a one-line purpose per module, taken from the module README, its
   `package.json` description, or the top-of-file comment of an index/entry file.
2. **What each module owns**: entry points (`package.json` `main`/`bin`/`exports`/scripts, index files)
   and main exports parsed from `export` statements in `.ts/.tsx/.js/.jsx/.mjs/.cjs`.
3. **Module dependency diagram** (mermaid `graph LR`) from relative `import`/`require`,
   resolved to modules (top-level folders, or any directory with its own `package.json`).
4. **Risky files**, top 15, scored from git churn (`git log --name-only`), size in lines and fan-in.
   Without git, churn is skipped and the score uses size and fan-in only.
5. **Agent and context files**: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/**`,
   `.github/copilot-instructions.md`, `.windsurfrules`, `HOWTOTALKTOCLAUDE.md`, `.claude/`, `.codex/` and more.

Ignored: `node_modules`, `.git`, `dist`, `build`, `out`, `vendor`, `coverage`, `.next`, `target` and similar.

## Usage

```sh
npm install
npm run build
node dist/cli.js [repo-path]       # default: current directory
node dist/cli.js ../my-repo --stdout   # print instead of writing
node dist/cli.js ../my-repo --llm      # stub: says Ollama summaries are not implemented, runs static
```

Or link it: `npm link` then `codebase-map [repo-path]`.

### Regeneration in place

The generated block sits between `<!-- codebase-map:start -->` and `<!-- codebase-map:end -->`.
Rerunning replaces only that block; anything you write above or below is kept.
If the file is missing it is created with a short header and the markers.
If the file exists without markers, the block is appended.

## Example

[`examples/BEST-OF-AI-DEV.md`](examples/BEST-OF-AI-DEV.md) is the full output for
[mogesjohnson/BEST-OF-AI-DEV](https://github.com/mogesjohnson/BEST-OF-AI-DEV). Excerpt:

```markdown
| Module | Purpose |
| --- | --- |
| `(root)` | Moges Johnson's template and source of truth for AI-first development: the practices worth keeping, drop-in agent rules for every new repo, and a docs site on why each practice matters. |
| `.claude` | Claude Code settings. |
| `.codex` | Codex CLI settings. |
| `.githooks` | Git hooks run by the repo (core.hooksPath). |
| `.github` | GitHub config: workflows, templates and ownership. |
| `docs` | Documentation. |
| `practices` | I reviewed my own repos to see which habits held up with agents writing most of the code and which ones didn't. |
| `site` | A static Next.js site that renders the Markdown pages in [../docs/why](../docs/why). |
| `template` | BEST-OF-AI-DEV template v1. |

| # | File | Score | Churn | Lines | Fan-in |
| --- | --- | --- | --- | --- | --- |
| 1 | `RULES.md` | 64 | 16 | 135 | 0 |
| 2 | `template/RULES.md` | 57 | 14 | 121 | 0 |
| 3 | `template/scripts/check/pr-size.mjs` | 47 | 5 | 179 | 1 |
| 4 | `template/scripts/test-windows.ps1` | 46 | 4 | 330 | 0 |
| 5 | `template/scripts/test/agent-config.test.mjs` | 45 | 9 | 141 | 0 |
```

## Limits

- Exports and imports are found by regex, not a TypeScript parser; unusual syntax can be missed.
- Only relative imports are graphed; path aliases (`@/foo`) and package imports are not resolved.
- `--llm` is a stub.
