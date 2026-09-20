import { describe, expect, it } from "vitest";
import { BLACKLIST, QUOTE_NOTE, explainFabricated, findFabricated, inQuote, stripFabricated, stripNote } from "../blacklist";
import { EVIDENCE_DAILY_LIMIT, EVIDENCE_DEGRADED_LIMIT, EVIDENCE_GLOBAL_BUDGET, allFlagged, byCitations, byRelevance, fallbackTerms, fieldIdFor, flagsFor, insertText, lastDays, queryKey, quotaState, resetLabel, resetPhrase, significantTokens } from "../evidence";
import seed from "@/data/research-library-seed-v2.json";

describe("fabricated-stat blacklist", () => {
  it("every entry compiles, carries a why and a say-instead, and never blocks in silence", () => {
    expect(BLACKLIST.length).toBe(12);
    for (const e of BLACKLIST) {
      expect(() => new RegExp(e.pattern, "i")).not.toThrow();
      expect(e.why.length, e.id).toBeGreaterThan(20);
      expect(e.sayInstead.length, e.id).toBeGreaterThan(5);
    }
  });
  it("matches loosely and case-insensitively, and explains with the why and the say-instead", () => {
    const m = findFabricated("Everyone knows it takes 21 DAYS to form a habit.");
    expect(m.map((x) => x.entry.id)).toEqual(["b02"]);
    const why = explainFabricated(m);
    expect(why).toMatch(/^This one doesn't hold up: "It takes 21 days to form a habit"\n\nFrom Maxwell Maltz's Psycho-Cybernetics/);
    expect(why).toContain("\n\nSay this instead: Habits take longer than people expect");
    expect(findFabricated("A famous Harvard study on goals")).toHaveLength(1);
    expect(findFabricated("People are different, and I ask before I advise.")).toHaveLength(0);
  });
  it("strips only the sentences carrying a fabricated claim from generated copy and says what went", () => {
    const r = stripFabricated("Most plans fail by week three.\nIt takes 21 days to build a habit. So I plan for twelve weeks.\nWhat would you try first?");
    expect(r.text).toBe("Most plans fail by week three.\nSo I plan for twelve weeks.\nWhat would you try first?");
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].entry.id).toBe("b02");
    expect(stripNote(r.removed)).toBe(`This one doesn't hold up, so it came out of the draft:\n\n"It takes 21 days to build a habit."\n\n${r.removed[0].entry.why}\n\nSay this instead: ${r.removed[0].entry.sayInstead}`);
    expect(stripNote([])).toBeNull();
  });
});

describe("the old frames are gone from every surface", () => {
  it("no page, action or component says a claim is not true or not real; the engine's two frames are the only ones", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !p.includes("__tests__")) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const offenders = files.filter((f) => /because it is not true|this statistic is not real|Say instead:/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("a block inside a quote names the situation", () => {
  const said = "“Like that Yale study where the 3% who wrote goals down won,” Jess said.";
  it("sees quotation marks, and an approved proof's words, and says the quote is trimmed, never rewritten", () => {
    const m = findFabricated(said);
    expect(inQuote(said, m[0].matched)).toBe(true);
    expect(explainFabricated(m, { text: said })).toContain(QUOTE_NOTE);
    const bare = "Remember the Yale study on goals.";
    expect(inQuote(bare, findFabricated(bare)[0].matched)).toBe(false);
    expect(explainFabricated(findFabricated(bare), { text: bare })).not.toContain(QUOTE_NOTE);
    // No quotation marks in the post, but the words are an approved proof's: still a quote
    const pasted = "Like that Yale study where the 3% who wrote goals down won. Jess M.";
    expect(inQuote(pasted, findFabricated(pasted)[0].matched, ["Like that Yale study where the 3% who wrote goals down won."])).toBe(true);
  });
});

describe("quota: two counters that must agree, one pool for every client", () => {
  const day = "2026-09-09";
  const rows = (n: number, userId = "u1", extra: Partial<{ day: string; fromCache: boolean }> = {}) => Array.from({ length: n }, () => ({ userId, day, fromCache: false, ...extra }));
  it("counts real calls only, per client and for the pool", () => {
    const q = quotaState([...rows(3), ...rows(2, "u2"), ...rows(4, "u1", { fromCache: true }), ...rows(1, "u1", { day: "2026-09-08" })], "u1", day);
    expect(q.usedToday).toBe(3);
    expect(q.globalToday).toBe(5);
    expect(q.limit).toBe(EVIDENCE_DAILY_LIMIT);
    expect(q.allowed).toBe(true);
    expect(q.refusal).toBeNull();
  });
  it("the per-client limit and the degraded floor are configuration, and the floor is a quarter of the limit", () => {
    expect(EVIDENCE_DAILY_LIMIT).toBe(100);
    expect(EVIDENCE_DEGRADED_LIMIT).toBe(25);
  });
  it("the per-client limit refuses at the limit with a plain reason that derives the number", () => {
    const q = quotaState(rows(EVIDENCE_DAILY_LIMIT), "u1", day);
    expect(q.allowed).toBe(false);
    expect(q.refusal).toContain(`You have used today's ${EVIDENCE_DAILY_LIMIT} searches`);
    expect(quotaState(rows(EVIDENCE_DAILY_LIMIT - 1), "u1", day).allowed).toBe(true);
  });
  it("the reset is said in the member's own clock, never as a unit nobody lives in", () => {
    const septemberNoon = new Date("2026-09-11T12:00:00Z");
    expect(resetLabel("America/Los_Angeles", septemberNoon)).toBe("5pm");
    expect(resetLabel("America/New_York", septemberNoon)).toBe("8pm");
    expect(resetLabel("Asia/Kolkata", septemberNoon)).toBe("5:30am");
    expect(resetLabel("UTC", septemberNoon)).toBe("12am");
    expect(resetLabel("America/Los_Angeles", new Date("2026-01-11T12:00:00Z"))).toBe("4pm");
    const q = quotaState(rows(EVIDENCE_DAILY_LIMIT), "u1", day, null, resetPhrase("America/Los_Angeles", septemberNoon));
    expect(q.refusal).toContain("resets at 5pm your time");
    expect(q.refusal).not.toContain("UTC");
  });
  it("past 70% of the pool everyone drops to the degraded allowance, and the words blame nobody", () => {
    const busy = Math.ceil(EVIDENCE_GLOBAL_BUDGET * 0.7);
    const others = rows(busy, "everyone-else");
    const q = quotaState([...others, ...rows(EVIDENCE_DEGRADED_LIMIT)], "u1", day);
    expect(q.degraded).toBe(true);
    expect(q.limit).toBe(EVIDENCE_DEGRADED_LIMIT);
    expect(q.allowed).toBe(false);
    expect(q.refusal).toContain("Nobody did anything wrong");
    expect(quotaState([...others, ...rows(EVIDENCE_DEGRADED_LIMIT - 1)], "u1", day).allowed).toBe(true);
    // A latecomer still gets in
    expect(quotaState(others, "new", day).allowed).toBe(true);
    // Just under 70%, the full allowance stands
    expect(quotaState(rows(busy - 1, "everyone-else"), "u1", day).degraded).toBe(false);
  });
  it("the pool used up is a hard stop that says so, and OpenAlex's reported balance tightens the local count", () => {
    const q = quotaState(rows(EVIDENCE_GLOBAL_BUDGET, "everyone-else"), "u1", day);
    expect(q.exhausted).toBe(true);
    expect(q.allowed).toBe(false);
    expect(q.refusal).toContain("used up for today");
    // The local counter says 0 used, OpenAlex says 40 credits left: 4 searches, which is degraded territory
    const tight = quotaState([], "u1", day, 40);
    expect(tight.poolLeft).toBe(4);
    expect(tight.degraded).toBe(true);
    expect(quotaState([], "u1", day, 0).exhausted).toBe(true);
    expect(quotaState([], "u1", day, null).poolLeft).toBe(EVIDENCE_GLOBAL_BUDGET);
  });
  it("the last seven days, oldest first, zero-filled", () => {
    const d = lastDays([...rows(2), ...rows(1, "u2", { day: "2026-09-07" }), ...rows(9, "u1", { fromCache: true })], day);
    expect(d).toHaveLength(7);
    expect(d[6]).toEqual({ day, count: 2 });
    expect(d[4]).toEqual({ day: "2026-09-07", count: 1 });
    expect(d[0]).toEqual({ day: "2026-09-03", count: 0 });
  });
});

describe("evidence", () => {
  it("falls back to the claim's own words, and keys the cache by sorted terms", () => {
    expect(fallbackTerms("Hypnotherapy helps people quit smoking.")).toEqual(["hypnotherapy", "quit", "smoking"]);
    expect(queryKey(["Smoking", "hypnotherapy "])).toBe(queryKey(["hypnotherapy", "smoking"]));
  });
  it("flags a year that differs and a title with none of the terms' words; a flag is never a rejection", () => {
    const asked = { claim: "Self-perception theory", terms: ["self-perception", "attitude"], year: 1972 };
    expect(flagsFor(asked, { title: "The Psychology of Change: Social Psychological Intervention", year: 2014 })).toEqual([
      "Year differs: you asked for 1972, this is 2014.",
      "The title has none of your terms' words (self, perception, attitude).",
    ]);
    expect(flagsFor(asked, { title: "Self-perception theory", year: 1972 })).toEqual([]);
  });
  it("the term flag is on words, not phrases: the best result is not flagged for failing to repeat a phrase verbatim", () => {
    const impostor = { claim: "", terms: ["impostor phenomenon", "impostor syndrome prevalence", "impostor phenomenon professionals", "impostorism high achievers"] };
    expect(flagsFor(impostor, { title: "Prevalence, Predictors, and Treatment of Impostor Syndrome: a Systematic Review", year: 2019 })).toEqual([]);
    expect(flagsFor(impostor, { title: "Toys and Tools in Pink", year: 2010 })).toEqual(["The title has none of your terms' words (impostor, phenomenon, syndrome, prevalence)."]);
    const lonely = { claim: "", terms: ["executive loneliness", "leadership isolation", "occupational loneliness leaders vs subordinates", "emotional labor in leadership positions"] };
    // leader, leaders and leadership are one word to the flag
    expect(flagsFor(lonely, { title: "Leader and leadership loneliness: A review-based critique and path to future research", year: 2024 })).toEqual([]);
    expect(significantTokens(["self-concordance", "goal self-concordance attainment"])).toEqual(["self", "concordance", "goal", "attainment"]);
  });
  it("the named author is a flag when absent, on the surname, never a filter that hides results", () => {
    const asked = { claim: "", terms: ["reflection", "performance"], author: "Di Stefano" };
    expect(flagsFor(asked, { title: "Learning by thinking: reflection and performance", year: 2014, authorNames: ["Giada Di Stefano", "Francesca Gino"] })).toEqual([]);
    expect(flagsFor(asked, { title: "Learning by thinking: reflection and performance", year: 2014, authorNames: ["Someone Else"] })).toEqual(["The author you named (Di Stefano) isn't on this one."]);
    expect(flagsFor({ ...asked, author: "" }, { title: "Learning by thinking: reflection and performance", year: 2014, authorNames: ["Someone Else"] })).toEqual([]);
  });
  it("every result flagged is a search that found nothing, and the model's field maps onto OpenAlex's list", () => {
    const asked = { claim: "", terms: ["self-concordance"] };
    expect(allFlagged(asked, [{ title: "A Novel Coronavirus from Patients with Pneumonia in China, 2019", year: 2020 }, { title: "The expression of the emotions in man and animals", year: 1872 }])).toBe(true);
    expect(allFlagged(asked, [{ title: "Self-concordance and goal attainment", year: 1999 }, { title: "The expression of the emotions in man and animals", year: 1872 }])).toBe(false);
    expect(allFlagged(asked, [])).toBe(false);
    expect(fieldIdFor("Psychology")).toBe("32");
    expect(fieldIdFor("psychology — motivation science, specifically self-determination theory")).toBe("32");
    // "management" is distinctive enough: management learning lives in Business, Management and Accounting on OpenAlex
    expect(fieldIdFor("organizational behavior / management learning")).toBe("14");
    expect(fieldIdFor("a field nobody classifies")).toBeNull();
    expect(fieldIdFor("Business, Management and Accounting")).toBe("14");
    expect(fieldIdFor("")).toBeNull();
    expect(byRelevance([{ relevanceScore: 12.5, t: "b" }, { relevanceScore: 91.2, t: "a" }, { relevanceScore: 40.1, t: "c" }]).map((r) => r.t)).toEqual(["a", "c", "b"]);
    expect(byRelevance([{ relevanceScore: null, t: "b" }, { relevanceScore: 91.2, t: "a" }]).map((r) => r.t)).toEqual(["b", "a"]);
  });
  it("inserts the claim and the citation together, and sorts by the one number a client can read", () => {
    expect(insertText({ claim: "A small yes makes a bigger yes easier later.", authors: "Freedman & Fraser", year: 1966, title: "Compliance without pressure: The foot-in-the-door technique.", url: "https://doi.org/10.1037/h0023552" })).toBe(
      "A small yes makes a bigger yes easier later (Freedman & Fraser (1966). Compliance without pressure: The foot-in-the-door technique.. https://doi.org/10.1037/h0023552)",
    );
    expect(byCitations([{ citedByCount: 3 }, { citedByCount: 1624 }, { citedByCount: 1187 }]).map((r) => r.citedByCount)).toEqual([1624, 1187, 3]);
  });
  it("ships the nine-study starter shelf, every one with a DOI resolved and a verified title, year and count", () => {
    expect(seed).toHaveLength(9);
    for (const s of seed) {
      expect(s.doi, s.id).toMatch(/^10\./);
      expect(s.citationQuality, s.id).toMatch(/^verified/);
      expect(s.verifiedTitle.length, s.id).toBeGreaterThan(5);
      expect(s.citedByCount, s.id).toBeGreaterThan(0);
    }
    expect(seed.map((s) => s.id)).not.toContain("s08");
  });
});
