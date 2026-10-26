import { execFileSync } from "node:child_process";
import { FileInfo } from "./scan.js";

export interface Risk { path: string; churn: number; lines: number; fanIn: number; score: number }

/** Commit count per path from git history; null when git or history is unavailable. */
export function gitChurn(root: string): Map<string, number> | null {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--name-only", "--format="], {
      encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    const m = new Map<string, number>();
    for (const line of out.split("\n")) { const p = line.trim(); if (p) m.set(p, (m.get(p) ?? 0) + 1); }
    return m;
  } catch { return null; }
}

/** Fan-in = distinct importing directories. Score = normalized churn + normalized size + normalized fan-in, weights 0.45/0.35/0.20. */
export function rankRisk(files: FileInfo[], churn: Map<string, number> | null, fanIn: Map<string, Set<string>>, top = 15): Risk[] {
  const cand = files.filter((f) => f.lines > 0 && !/(^|\/)package-lock\.json$|\.lock$/.test(f.path));
  const rows = cand.map((f) => ({ path: f.path, churn: churn?.get(f.path) ?? 0, lines: f.lines, fanIn: fanIn.get(f.path)?.size ?? 0, score: 0 }));
  const max = (k: "churn" | "lines" | "fanIn") => Math.max(1, ...rows.map((r) => r[k]));
  const mc = max("churn"), ml = max("lines"), mf = max("fanIn");
  const wc = churn ? 0.45 : 0, wl = churn ? 0.35 : 0.65, wf = churn ? 0.2 : 0.35;
  for (const r of rows) {
    r.score = Math.round(100 * (wc * (r.churn / mc) + wl * Math.log1p(r.lines) / Math.log1p(ml) * (r.lines / ml) ** 0.5 + wf * (r.fanIn / mf)));
  }
  return rows.sort((a, b) => b.score - a.score || b.lines - a.lines).slice(0, top);
}
