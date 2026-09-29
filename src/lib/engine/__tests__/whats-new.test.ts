import { describe, expect, it } from "vitest";
import { WHATS_NEW, type WhatsNewEntry } from "@/content/whats-new";
import { buildInfo, versionLabel } from "@/lib/build-info";
import { byWeek, changelogCheck, entryProblems, isUserFacing, newestSeenable, unseenCount, visibleEntries, weekOfEntry } from "../whats-new";

const e = (n: number, audience: WhatsNewEntry["audience"], date = "2026-09-29"): WhatsNewEntry => ({ n, date, title: `Entry ${n}`, lines: ["A line."], audience });

describe("the version shown in the app (rev 193)", () => {
  it("is the build's own commit and the build day in Pacific time", () => {
    const b = buildInfo({ VERCEL_GIT_COMMIT_SHA: "BCE8863F00D1234567890abcdef0123456789abc" }, new Date("2026-09-30T05:00:00Z"));
    expect(b).toEqual({ date: "2026.09.29", sha: "bce8863" });
    expect(versionLabel(b)).toBe("HelixOS 2026.09.29 · bce8863");
  });
  it("uses the checkout's HEAD off Vercel, and never makes one up", () => {
    expect(buildInfo({}, new Date("2026-09-29T18:00:00Z"), () => "7fa6b38aaaa\n").sha).toBe("7fa6b38");
    expect(buildInfo({}, new Date("2026-09-29T18:00:00Z"), () => null).sha).toBe("dev");
    expect(buildInfo({ VERCEL_GIT_COMMIT_SHA: "not-a-sha" }, new Date()).sha).toBe("dev");
  });
});

describe("who sees which entry, and the dot", () => {
  const entries = [e(3, "coach"), e(2, "everyone"), e(1, "everyone")];
  it("hides coach entries from members, newest first", () => {
    expect(visibleEntries(entries, "client").map((x) => x.n)).toEqual([2, 1]);
    expect(visibleEntries(entries, "coach").map((x) => x.n)).toEqual([3, 2, 1]);
  });
  it("counts what's newer than the last visit; never opened counts everything; a coach entry never dots a member", () => {
    expect(unseenCount(entries, "client", null)).toBe(2);
    expect(unseenCount(entries, "client", 2)).toBe(0);
    expect(unseenCount(entries, "coach", 2)).toBe(1);
    expect(newestSeenable(entries, "client")).toBe(2);
    expect(newestSeenable([], "client")).toBe(0);
  });
  it("groups by the Monday of each week", () => {
    expect(weekOfEntry("2026-09-28")).toBe("2026-09-28");
    expect(weekOfEntry("2026-10-04")).toBe("2026-09-28");
    expect(byWeek([e(2, "everyone", "2026-09-29"), e(1, "everyone", "2026-09-25")]).map((w) => w.week)).toEqual(["2026-09-28", "2026-09-21"]);
  });
});

describe("the entries as shipped", () => {
  it("are sound: numbering, dates, audience, and no rev numbers or hashes in the words", () => {
    expect(entryProblems(WHATS_NEW)).toEqual([]);
    expect(entryProblems([e(1, "everyone"), e(1, "everyone")]).join(" ")).toMatch(/used twice/);
    expect(entryProblems([{ ...e(1, "everyone"), lines: ["Shipped in rev 193 as 7fa6b38."] }]).join(" ")).toMatch(/no rev numbers/);
  });
});

describe("the gate's rule: a visible change comes with its entry", () => {
  it("fails a page or component change with no entry, and passes with one or with [no-changelog]", () => {
    expect(changelogCheck(["src/app/(app)/today/page.tsx"])).toEqual({ ok: false, files: ["src/app/(app)/today/page.tsx"] });
    expect(changelogCheck(["src/components/nav.tsx", "src/content/whats-new.ts"]).ok).toBe(true);
    expect(changelogCheck(["src/components/nav.tsx"], "Tidy the nav\n\n[no-changelog]").ok).toBe(true);
  });
  it("leaves out what nobody sees: API routes, tests, library code, scripts", () => {
    expect(changelogCheck(["src/app/api/cron/reminders/route.ts", "src/lib/community.ts", "scripts/smoke.ts", "src/lib/engine/__tests__/x.test.ts"]).ok).toBe(true);
    expect(isUserFacing("src/app/(app)/whats-new/page.tsx")).toBe(true);
    expect(isUserFacing("src/app/globals.css")).toBe(true);
  });
});
