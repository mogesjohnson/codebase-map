import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { CODE_EXT, FileInfo, readJson, readText, toPosix } from "./scan.js";

export interface Module {
  name: string; // "." for root files, else top-level folder or package dir
  purpose: string;
  files: string[];
  entryPoints: string[];
  exports: string[];
  deps: Set<string>;
}

export interface Analysis {
  modules: Map<string, Module>;
  /** file -> set of modules (other than its own) that import it */
  fanIn: Map<string, Set<string>>;
}

const README_RE = /^readme(\.md|\.txt)?$/i;

/** Package dirs (nested package.json) become modules; otherwise the top-level folder. */
export function moduleOf(file: string, pkgDirs: string[]): string {
  for (const d of pkgDirs) if (file.startsWith(d + "/")) return d;
  const i = file.indexOf("/");
  return i < 0 ? "." : file.slice(0, i);
}

function firstSentence(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  const m = one.match(/^(.{20,200}?[.!?])(\s|$)/);
  return (m ? m[1] : one.slice(0, 160)).trim();
}

/** First prose paragraph of a README, skipping headings, badges, html and comments. */
export function readmePurpose(text: string): string {
  const noComments = text.replace(/<!--[\s\S]*?-->/g, "");
  for (const para of noComments.split(/\n\s*\n/)) {
    const lines = para.split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("[![") && !l.startsWith("<") && !l.startsWith("```") && !/^[-=|]+$/.test(l));
    const joined = lines.join(" ").replace(/[*_`]/g, "");
    if (joined.length > 15) return firstSentence(joined);
  }
  return "";
}

/** Top-of-file block or line comment. */
export function headerComment(text: string): string {
  const t = text.replace(/^#!.*\n/, "").trimStart();
  let m = t.match(/^\/\*\*?([\s\S]*?)\*\//);
  if (m) return firstSentence(m[1].replace(/^\s*\*\s?/gm, " "));
  m = t.match(/^((?:\/\/.*\n)+)/);
  if (m) return firstSentence(m[1].replace(/^\s*\/\/\s?/gm, " "));
  return "";
}

const EXPORT_RES: RegExp[] = [
  /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
  /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/g,
  /exports\.([A-Za-z_$][\w$]*)\s*=/g,
];

export function parseExports(text: string): string[] {
  const names = new Set<string>();
  for (const re of EXPORT_RES) for (const m of text.matchAll(re)) names.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n.replace(/^type\s+/, ""));
    }
  }
  if (/module\.exports\s*=/.test(text)) names.add("module.exports");
  if (/export\s+default\s/.test(text) && ![...names].length) names.add("default");
  return [...names];
}

const IMPORT_RES: RegExp[] = [
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function parseImports(text: string): string[] {
  const out = new Set<string>();
  for (const re of IMPORT_RES) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out].filter((s) => s.startsWith("."));
}

const RESOLVE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.mjs"];

/** Resolve a relative specifier to a repo-relative file, tolerating .js -> .ts. */
export function resolveImport(root: string, fromFile: string, spec: string, known: Set<string>): string | null {
  const base = toPosix(normalize(join(dirname(fromFile), spec)));
  if (base.startsWith("..")) return null;
  const stems = [base, base.replace(/\.(m|c)?js$/, "")];
  for (const stem of stems) for (const ext of RESOLVE_EXT) {
    const cand = stem + ext;
    if (known.has(cand)) return cand;
  }
  return existsSync(join(root, base)) ? base : null;
}

function pkgEntries(pkg: Record<string, unknown>, prefix: string): string[] {
  const out: string[] = [];
  const add = (v: unknown, label: string) => { if (typeof v === "string") out.push(`${label}: \`${join(prefix, v)}\``); };
  add(pkg.main, "main");
  add(pkg.module, "module");
  if (typeof pkg.bin === "string") add(pkg.bin, "bin");
  else if (pkg.bin && typeof pkg.bin === "object") for (const [k, v] of Object.entries(pkg.bin)) add(v, `bin ${k}`);
  const ex = pkg.exports;
  if (typeof ex === "string") add(ex, "exports");
  else if (ex && typeof ex === "object") for (const [k, v] of Object.entries(ex)) {
    if (typeof v === "string") add(v, `exports ${k}`);
    else if (v && typeof v === "object") { const o = v as Record<string, unknown>; add(o.import ?? o.default ?? o.require, `exports ${k}`); }
  }
  if (pkg.scripts && typeof pkg.scripts === "object") {
    const names = Object.keys(pkg.scripts).slice(0, 6);
    if (names.length) out.push(`scripts: ${names.map((n) => `\`${n}\``).join(", ")}`);
  }
  return out;
}

export function analyze(root: string, files: FileInfo[]): Analysis {
  const pkgDirs = files.map((f) => f.path).filter((p) => p.endsWith("/package.json"))
    .map((p) => p.slice(0, -"/package.json".length)).sort((a, b) => b.length - a.length);
  const known = new Set(files.map((f) => f.path));
  const modules = new Map<string, Module>();
  const get = (name: string): Module => {
    let m = modules.get(name);
    if (!m) { m = { name, purpose: "", files: [], entryPoints: [], exports: [], deps: new Set() }; modules.set(name, m); }
    return m;
  };
  for (const f of files) get(moduleOf(f.path, pkgDirs)).files.push(f.path);

  const fanIn = new Map<string, Set<string>>();
  for (const mod of modules.values()) {
    const prefix = mod.name === "." ? "" : mod.name + "/";
    // purpose: README, package.json description, index file, then any top-of-file comment
    const readme = mod.files.find((f) => README_RE.test(f.slice(prefix.length)));
    const pkg = readJson(root, prefix + "package.json");
    if (readme) mod.purpose = readmePurpose(readText(root, readme));
    if (!mod.purpose && pkg && typeof pkg.description === "string") mod.purpose = pkg.description;
    const codeFiles = mod.files.filter((f) => CODE_EXT.test(f));
    const indexes = codeFiles.filter((f) => /(^|\/)(index|main|cli|mod)\.[cm]?[jt]sx?$/.test(f));
    if (!mod.purpose) for (const f of [...indexes, ...codeFiles]) {
      const c = headerComment(readText(root, f));
      if (c) { mod.purpose = c; break; }
    }
    if (!mod.purpose) mod.purpose = mod.files.some((f) => f.endsWith(".md")) ? "Documentation." : "_(no purpose found)_";

    if (pkg) mod.entryPoints.push(...pkgEntries(pkg, mod.name === "." ? "" : mod.name));
    for (const f of indexes.slice(0, 5)) mod.entryPoints.push(`\`${f}\``);

    const exp = new Set<string>();
    for (const f of codeFiles) {
      const text = readText(root, f);
      for (const e of parseExports(text)) if (exp.size < 40) exp.add(e);
      for (const spec of parseImports(text)) {
        const target = resolveImport(root, f, spec, known);
        if (!target) continue;
        const tm = moduleOf(target, pkgDirs);
        if (tm !== mod.name) {
          mod.deps.add(tm);
          if (!fanIn.has(target)) fanIn.set(target, new Set());
          fanIn.get(target)!.add(mod.name);
        }
      }
    }
    mod.exports = [...exp];
  }
  return { modules, fanIn };
}
