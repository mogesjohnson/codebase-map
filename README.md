# codebase-map

`codebase-map` writes `docs/CODEBASE_MAP.md`, a living onboarding and architecture page for a repo.
By default it uses static analysis only (no LLM, no network) and has zero runtime dependencies.
With the optional `--llm` flag it also asks a local [Ollama](https://ollama.com) model for a short,
clearly labeled AI summary of each module.

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

## Setup

Prerequisites: Node.js 20 or newer (`node --version`), npm and git. Ollama is optional.

```sh
git clone https://github.com/mogesjohnson/codebase-map.git
cd codebase-map
npm install          # dev dependencies only: typescript, @types/node
npm run build        # compiles src/ to dist/
npm test             # builds, then runs the node:test suite (mocked Ollama, no network)
```

## Usage

```sh
node dist/cli.js [repo-path] [options]   # repo-path defaults to the current directory
node dist/cli.js ../my-repo              # writes ../my-repo/docs/CODEBASE_MAP.md
node dist/cli.js ../my-repo --stdout     # print the generated block, write nothing
node dist/cli.js ../my-repo --llm        # add AI summaries from a local Ollama
node dist/cli.js --help
```

Or link it: `npm link`, then `codebase-map [repo-path] [options]`.

Output goes to `<repo-path>/docs/CODEBASE_MAP.md` (the `docs/` folder is created if needed).
Nothing else in the target repo is written. The CLI prints one line saying whether the file was
`created`, `updated` or `appended`.

| Flag | Default | What it does |
| --- | --- | --- |
| `--stdout` | off | Print the generated block to stdout instead of writing the file. |
| `--llm` | off | Add an "AI summary" per module from a local Ollama. |
| `--llm-model <name>` | `llama3.2` | Ollama model to use. |
| `--ollama-url <url>` | `$OLLAMA_HOST`, else `http://localhost:11434` | Ollama base URL. `host:port` without a scheme gets `http://`. |
| `--llm-timeout <ms>` | `60000` | Timeout for each request. |
| `--llm-max-modules <n>` | `30` | Summarize at most `n` modules (root first, then by name); the rest keep only the static purpose. |
| `--help` | | Print usage. |

Value flags accept `--flag value` or `--flag=value`. Unknown flags or bad values exit with code 2;
a missing repo directory exits with code 1.

### Optional: AI summaries with Ollama

1. Install Ollama yourself from [ollama.com](https://ollama.com) (codebase-map never downloads it).
2. Pull a model: `ollama pull llama3.2` (or any model, then pass `--llm-model <name>`).
3. Make sure it is running (`ollama serve`, or the desktop app). It listens on `http://localhost:11434`.
   For another host or port, set `OLLAMA_HOST` (for example `OLLAMA_HOST=127.0.0.1:11500`) or pass `--ollama-url`.
4. Run `node dist/cli.js ../my-repo --llm`.

For each module, codebase-map sends one prompt to `POST <url>/api/generate` with `stream: false`, using
Node's built-in `fetch`. The prompt holds the module path, its static purpose, exports, imports and the
first lines of up to six files, capped at 6,000 characters. The answer is written into the "What each
module owns" section as ``- AI summary (AI-generated, Ollama `<model>`): ...``, under a note that says
the summaries come from a local LLM and may be wrong. The static purpose table is unchanged.
Nothing leaves your machine unless `--ollama-url` points elsewhere.

**Without Ollama:** if Ollama is not reachable, a request times out, or the model is not pulled (HTTP 404),
codebase-map prints one warning to stderr, skips all AI summaries, writes the full static map and exits 0.
If a single module fails for another reason (for example HTTP 500), only that module is skipped and a
warning lists it. Without `--llm`, no network request is made and the output is purely static.

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
- AI summaries are model output: they can be wrong, and they change between runs.
  Timeouts and missing models skip all AI summaries rather than waiting on each module.
