/**
 * The gate's What's new check (rev 193), run by scripts/verify.sh:
 *  1. the entries themselves are sound (numbering, dates, audience, words meant for members);
 *  2. a change to what people see (pages and components) adds its entry in src/content/whats-new.ts in the same commit.
 *
 * Before a commit (changes in the working tree) it reads those changes. A change nobody would notice (a refactor, a fix with
 * no visible difference) runs the gate as `NO_CHANGELOG=1 scripts/release.sh` and carries [no-changelog] in its commit
 * message. On a clean tree it reads the last commit and its message, so the same rule holds after the fact.
 */
import { execSync } from "node:child_process";
import { WHATS_NEW } from "@/content/whats-new";
import { NO_CHANGELOG, changelogCheck, entryProblems } from "@/lib/engine/whats-new";

const git = (args: string): string => execSync(`git ${args}`, { encoding: "utf8" }).trim();

const problems = entryProblems(WHATS_NEW);
if (problems.length) {
  console.error(`What's new: the entries need fixing:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const dirty = git("status --porcelain -uall")
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""));
const changed = dirty.length ? dirty : git("diff --name-only HEAD~1 HEAD").split("\n").filter(Boolean);
const message = dirty.length ? (process.env.NO_CHANGELOG === "1" ? NO_CHANGELOG : "") : git("log -1 --format=%B");
const r = changelogCheck(changed, message);
if (!r.ok) {
  console.error(
    `What's new: these change what people see, but src/content/whats-new.ts has no new entry:\n- ${r.files.join("\n- ")}\n` +
      `Add an entry in plain words (who it's for, 1 to 3 lines). If nobody would notice the change, run the gate with ` +
      `NO_CHANGELOG=1 and put ${NO_CHANGELOG} in the commit message.`,
  );
  process.exit(1);
}
console.log(`What's new: ${WHATS_NEW.length} entries sound; ${dirty.length ? "this change" : "the last commit"} ${changed.includes("src/content/whats-new.ts") ? "adds its entry" : "changes nothing people see, or says " + NO_CHANGELOG}.`);
