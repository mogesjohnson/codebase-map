import { FileInfo } from "./scan.js";

const AGENT_FILE = /(^|\/)(AGENTS\.md|CLAUDE\.md|CLAUDE\.local\.md|GEMINI\.md|HOWTOTALKTOCLAUDE\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.aider\.conf\.yml|CONVENTIONS\.md|copilot-instructions\.md)$/i;
const AGENT_DIR = /(^|\/)(\.cursor\/rules|\.windsurf\/rules|\.clinerules|\.github\/instructions|\.claude|\.gemini|\.codex)\//;

/** Agent and assistant context files, e.g. AGENTS.md, CLAUDE.md, .cursor/rules/**. */
export function findAgentFiles(files: FileInfo[]): string[] {
  return files.map((f) => f.path).filter((p) => AGENT_FILE.test(p) || AGENT_DIR.test(p));
}
