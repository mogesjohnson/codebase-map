import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "vendor", "coverage", ".next", ".nuxt",
  ".turbo", ".cache", "target", "__pycache__", ".venv", "venv", ".idea", ".vscode", "tmp",
]);

export const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|md|json|ya?ml|py|go|rs|sh|ps1|css|scss|html|toml|txt)$/;

export interface FileInfo {
  path: string; // repo-relative, forward slashes
  lines: number;
  isCode: boolean;
}

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Walk the repo and return every non-ignored file with its line count. */
export function scanFiles(root: string): FileInfo[] {
  const out: FileInfo[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries.sort()) {
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name)) continue;
        walk(abs);
      } else if (st.isFile()) {
        const rel = toPosix(relative(root, abs));
        if (rel === "docs/CODEBASE_MAP.md") continue;
        let lines = 0;
        if (TEXT_EXT.test(name) && st.size < 2_000_000) {
          lines = readFileSync(abs, "utf8").split("\n").length;
        }
        out.push({ path: rel, lines, isCode: CODE_EXT.test(name) });
      }
    }
  };
  walk(root);
  return out;
}

export function readText(root: string, rel: string): string {
  const abs = join(root, rel);
  if (!existsSync(abs)) return "";
  try { return readFileSync(abs, "utf8"); } catch { return ""; }
}

export function readJson(root: string, rel: string): Record<string, unknown> | null {
  const t = readText(root, rel);
  if (!t) return null;
  try { return JSON.parse(t) as Record<string, unknown>; } catch { return null; }
}
