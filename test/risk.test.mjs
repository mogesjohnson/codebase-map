import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitChurn, rankRisk } from "../dist/risk.js";
import { tmpTree } from "./helpers.mjs";

const f = (path, lines) => ({ path, lines, isCode: true });

test("rankRisk orders by churn, size and fan-in and drops lockfiles and empty files", () => {
  const files = [f("big.ts", 400), f("hot.ts", 50), f("hub.ts", 50), f("cold.ts", 50), f("package-lock.json", 9000), f("yarn.lock", 9000), f("bin.png", 0)];
  const churn = new Map([["hot.ts", 20], ["big.ts", 1], ["hub.ts", 1], ["cold.ts", 1]]);
  const fanIn = new Map([["hub.ts", new Set(["a", "b", "c"])]]);
  const ranked = rankRisk(files, churn, fanIn);
  assert.deepEqual(ranked.map((r) => r.path), ["hot.ts", "big.ts", "hub.ts", "cold.ts"]);
  assert.equal(ranked[0].churn, 20);
  assert.equal(ranked[2].fanIn, 3);
  assert.ok(ranked.every((r, i) => i === 0 || ranked[i - 1].score >= r.score));
});

test("rankRisk without git ignores churn and respects top", () => {
  const files = [f("a.ts", 10), f("b.ts", 300), f("c.ts", 100)];
  const ranked = rankRisk(files, null, new Map(), 2);
  assert.deepEqual(ranked.map((r) => r.path), ["b.ts", "c.ts"]);
  assert.ok(ranked.every((r) => r.churn === 0));
});

test("gitChurn counts commits per file in a real tmp repo", () => {
  const root = tmpTree({ "a.ts": "1\n", "b.ts": "1\n" });
  const git = (...a) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", "."); git("commit", "-q", "-m", "one");
  for (const n of [2, 3]) { writeFileSync(join(root, "a.ts"), `${n}\n`); git("commit", "-qam", `edit ${n}`); }
  const churn = gitChurn(root);
  assert.equal(churn.get("a.ts"), 3);
  assert.equal(churn.get("b.ts"), 1);
});

test("gitChurn returns null outside a git repo (no-git fallback)", () => {
  const root = tmpTree({ "a.ts": "1\n" });
  assert.equal(gitChurn(root), null);
});

test("gitChurn on a subdirectory reports paths relative to that subdirectory", () => {
  const root = tmpTree({ "pkg/a.ts": "1\n", "other.ts": "1\n" });
  const git = (...a) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", "."); git("commit", "-q", "-m", "one");
  writeFileSync(join(root, "pkg", "a.ts"), "2\n"); git("commit", "-qam", "two");
  const churn = gitChurn(join(root, "pkg"));
  assert.deepEqual([...churn], [["a.ts", 2]]);
});
