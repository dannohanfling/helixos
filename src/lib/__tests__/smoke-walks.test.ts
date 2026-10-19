import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The walk list (scripts/smoke-walks.txt, H-1163) and smoke.sh's planned fresh servers. The list is written by hand, so it is
 * checked against the scripts on disk: every name has its walk, and every walk script is listed or named below with why not.
 */
const ROOT = join(__dirname, "../../..");
const LIST = join(ROOT, "scripts/smoke-walks.txt");

/** smoke-*.ts scripts that `smoke.sh all` does not run, each with the reason. Adding a walk to `all` is a line in the list. */
const NOT_IN_ALL: Record<string, string> = {
  warm: "the warm-up smoke.sh runs before the first walk, not a walk",
  ambience: "not in the all list on main when the list moved to its own file (19 Oct); run by name",
  legal: "not in the all list on main when the list moved to its own file (19 Oct); run by name",
  welcome: "not in the all list on main when the list moved to its own file (19 Oct); run by name",
};

const listed = () =>
  readFileSync(LIST, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);

describe("the walk list and smoke.sh's fresh servers (H-1163)", () => {
  it("lists each walk once, and every name has its script", () => {
    const walks = listed();
    expect(walks.length).toBeGreaterThan(50);
    expect(new Set(walks).size).toBe(walks.length);
    for (const w of walks) expect(existsSync(join(ROOT, "scripts", w === "base" ? "smoke.ts" : `smoke-${w}.ts`)), w).toBe(true);
  });

  it("every smoke-*.ts walk is in the list or named with why not", () => {
    const walks = new Set(listed());
    const scripts = readdirSync(join(ROOT, "scripts"))
      .map((f) => f.match(/^smoke-(.+)\.ts$/)?.[1])
      .filter((x): x is string => Boolean(x));
    expect(scripts.length).toBeGreaterThan(50);
    const missing = scripts.filter((w) => !walks.has(w) && !(w in NOT_IN_ALL));
    expect(missing, `walks neither in scripts/smoke-walks.txt nor named in NOT_IN_ALL: ${missing.join(", ")}`).toEqual([]);
    for (const w of Object.keys(NOT_IN_ALL)) expect(existsSync(join(ROOT, "scripts", `smoke-${w}.ts`)), `${w} is gone; drop it from NOT_IN_ALL`).toBe(true);
    for (const w of Object.keys(NOT_IN_ALL)) expect(walks.has(w), `${w} is in the list now; drop it from NOT_IN_ALL`).toBe(false);
  });

  it("smoke.sh no longer carries its own copy of the list", () => {
    expect(readFileSync(join(ROOT, "scripts/smoke.sh"), "utf8")).not.toMatch(/ALL=\([a-z]/);
  });

  it("plans a fresh server every 10 walks and before tenancy and team, in the list's order", () => {
    const out = execFileSync("bash", ["scripts/smoke.sh", "--plan", "all"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SMOKE_FRESH_EVERY: "10" } });
    const rows = out.trim().split("\n").map((l) => l.split("\t"));
    expect(rows.map((r) => r[0])).toEqual(listed());
    rows.forEach(([w, mark], i) => {
      const due = w === "tenancy" || w === "team" || (i > 0 && i % 10 === 0);
      expect(Boolean(mark), `${i} ${w}`).toBe(due);
    });
    expect(rows.filter((r) => r[1]).length).toBeGreaterThanOrEqual(Math.floor((rows.length - 1) / 10));
  });

  it("SMOKE_FRESH_EVERY=0 keeps only the two named fresh servers", () => {
    const out = execFileSync("bash", ["scripts/smoke.sh", "--plan", "all"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SMOKE_FRESH_EVERY: "0" } });
    expect(out.split("\n").filter((l) => l.includes("\tfresh")).map((l) => l.split("\t")[0])).toEqual(["tenancy", "team"]);
  });
});
