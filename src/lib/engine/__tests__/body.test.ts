import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bodyAccessFor, bodyAiAllowedFor, capUse, formatBodyForAi, dayMarks, dayTypeIdFor, hasBands, markFor, nextRefeed, portionMacros, summaryLine, sumMacros, whatFits, worstMark, type Band, type Macro, type Macros, type WeekPattern } from "@/lib/engine/body";
// Danno's protocol is test data only (rev 192): the app ships no preset, and the last describe below holds that.
import { PHASE2_V4 } from "./fixtures/body-phase2v4";
import { NAV, navVisible } from "@/components/nav-groups";

const V4 = PHASE2_V4;
const food = (key: string) => V4.foods.find((f) => f.key === key)!;
const bandsOf = (key: string): Record<Macro, Band> => {
  const d = V4.dayTypes.find((t) => t.key === key)!;
  return { cal: { min: d.cal[0], max: d.cal[1] }, p: { min: d.p[0], max: d.p[1] }, f: { min: d.f[0], max: d.f[1] }, c: { min: d.c[0], max: d.c[1] } };
};
const mealTotals = (name: string): Macros => sumMacros(V4.meals.find((m) => m.name === name)!.items.map((i) => portionMacros({ ...food(i.food), qty: i.qty })));
const opts = { floors: V4.floors, overOk: ["p" as const] };

describe("macro math against Danno's staples (seed table, rev 184)", () => {
  it("the saved meals add up from the foods", () => {
    expect(mealTotals("Office Carne Asada Power Lunch")).toEqual({ cal: 783, p: 87, f: 47, c: 1 });
    expect(mealTotals("Lean Recovery Dinner")).toEqual({ cal: 395, p: 63, f: 13, c: 2.5 });
    // The skill's rounding says 921 / 140 / 39.5 / 4; three slices of the per-slice row are 921 / 141 / 39 / 3.
    expect(mealTotals("Pizza V4 3-slice")).toEqual({ cal: 921, p: 141, f: 39, c: 3 });
  });
  it("Office Carne Asada lunch + a lean steak dinner = 1,408 / 200 P / 61 F: a lift day, ✅ on every macro", () => {
    const dinner = sumMacros([portionMacros({ ...food("lean-steak"), qty: 10 }), portionMacros({ ...food("egg-whites-cup"), qty: 1 })]);
    const day = sumMacros([mealTotals("Office Carne Asada Power Lunch"), dinner]);
    expect(day).toEqual({ cal: 1408, p: 200, f: 61, c: 3 });
    const marks = dayMarks(day, bandsOf("lift"), { ...opts, final: true });
    expect(marks).toEqual({ cal: "in", p: "in", f: "in", c: "in" });
    expect(worstMark(marks)).toBe("in");
  });
  it("quantities multiply per unit and sums round to one decimal", () => {
    expect(portionMacros({ ...food("egg-white"), qty: 3 })).toEqual({ cal: 51, p: 10.2, f: 0, c: 0.9 });
    expect(sumMacros([{ cal: 0.1, p: 0.2, f: 0, c: 0 }, { cal: 0.2, p: 0.1, f: 0, c: 0 }])).toEqual({ cal: 0.3, p: 0.3, f: 0, c: 0 });
  });
});

describe("the status marks (confirmed at rev 184)", () => {
  const lift = bandsOf("lift");
  it("protein over the top is 🟢, not a problem", () => {
    expect(markFor("p", 215, lift.p, { overOk: true, final: true })).toBe("over_ok");
    expect(markFor("f", 70, lift.f, { final: true })).not.toBe("over_ok");
  });
  it("over the fat top by less than 5 g is 🟡; further is ⚠️, then ❌", () => {
    expect(markFor("f", 69, lift.f, { final: true })).toBe("slight");
    expect(markFor("f", 70, lift.f, { final: true })).toBe("slight");
    expect(markFor("f", 76, lift.f, { final: true })).toBe("significant");
    expect(markFor("f", 85, lift.f, { final: true })).toBe("out");
  });
  it("under the calorie floor by less than 50 is 🟡; further under a floor is ❌, never ⚠️", () => {
    expect(markFor("cal", 1360, lift.cal, { floor: 1400, final: true })).toBe("slight");
    expect(markFor("cal", 1340, lift.cal, { floor: 1400, final: true })).toBe("out");
    // Without a floor the band's own rule applies: 5% (70 cal) is slight, 15% significant.
    expect(markFor("cal", 1340, lift.cal, { final: true })).toBe("slight");
    expect(markFor("cal", 1320, lift.cal, { final: true })).toBe("significant");
  });
  it("the carb minimum: on a 0–5 g band, 6 g is 🟡, not ⚠️", () => {
    expect(markFor("c", 6, lift.c, { final: true })).toBe("slight");
    expect(markFor("c", 8, lift.c, { final: true })).toBe("slight");
    expect(markFor("c", 12, lift.c, { final: true })).toBe("significant");
    expect(markFor("c", 20, lift.c, { final: true })).toBe("out");
  });
  it("the fat floor sits under the band: above the floor a miss is judged from the band; below it, more than 5 g short is ❌", () => {
    expect(markFor("f", 48, bandsOf("off").f, { floor: 46, final: true })).toBe("slight");
    expect(markFor("f", 47, lift.f, { floor: 46, final: true })).toBe("significant");
    expect(markFor("f", 44, bandsOf("off").f, { floor: 46, final: true })).toBe("out");
  });
  it("a day still in progress is ⏳ below its band, but over the top is judged at once", () => {
    expect(markFor("cal", 780, lift.cal, { floor: 1400, final: false })).toBe("open");
    expect(markFor("c", 20, lift.c, { final: false })).toBe("out");
  });
});

describe("day-type rotation and the refeed rule", () => {
  const pattern: WeekPattern = { "0": "lift", "1": "lift", "2": "off", "3": "lift", "4": "off", "5": "lift", "6": "lift" };
  const noRefeed = { dayTypeId: "refeed", anchor: null, everyDays: 14 };
  it("the weekly pattern: Sun, Mon, Wed, Fri, Sat lift; Tue, Thu off", () => {
    // 2026-10-04 is a Sunday.
    const week = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d) => dayTypeIdFor(d, pattern, noRefeed));
    expect(week).toEqual(["lift", "lift", "off", "lift", "off", "lift", "lift"]);
  });
  it("with no anchor set, no refeed days are generated", () => {
    expect(dayTypeIdFor("2026-10-10", pattern, noRefeed)).toBe("lift");
    expect(nextRefeed("2026-10-01", noRefeed)).toBeNull();
  });
  it("every other Saturday from the anchor replaces that Saturday's lift day; never before the anchor", () => {
    const rule = { dayTypeId: "refeed", anchor: "2026-10-10", everyDays: 14 };
    expect(dayTypeIdFor("2026-09-26", pattern, rule)).toBe("lift");
    expect(dayTypeIdFor("2026-10-10", pattern, rule)).toBe("refeed");
    expect(dayTypeIdFor("2026-10-17", pattern, rule)).toBe("lift");
    expect(dayTypeIdFor("2026-10-24", pattern, rule)).toBe("refeed");
    expect(dayTypeIdFor("2026-11-07", pattern, rule)).toBe("refeed");
    expect(nextRefeed("2026-10-01", rule)).toBe("2026-10-10");
    expect(nextRefeed("2026-10-11", rule)).toBe("2026-10-24");
    expect(nextRefeed("2026-10-24", rule)).toBe("2026-10-24");
  });
  it("a member's override for a date wins over both", () => {
    const rule = { dayTypeId: "refeed", anchor: "2026-10-10", everyDays: 14 };
    expect(dayTypeIdFor("2026-10-10", pattern, rule, "off")).toBe("off");
  });
});

describe("what fits tonight", () => {
  it("after the carne asada lunch on a lift day, the steak dinner fits and pizza doesn't", () => {
    const eaten = mealTotals("Office Carne Asada Power Lunch");
    const meals = V4.meals.map((m, i) => ({ id: String(i), name: m.name, totals: mealTotals(m.name) }));
    const fits = whatFits(eaten, bandsOf("lift"), meals, opts);
    const names = fits.map((f) => f.name);
    expect(names).toContain("Steak + Eggs Dinner");
    // 66.8 g of fat is over the 65 g top by less than 5 g: offered, with its 🟡 shown.
    expect(fits.find((f) => f.name === "Steak + Eggs Dinner")!.marks.f).toBe("slight");
    expect(names).not.toContain("Pizza V4 3-slice");
    expect(names).not.toContain("Office Carne Asada Power Lunch");
    for (const f of fits) for (const m of ["cal", "f", "c"] as const) expect(["in", "open", "slight"]).toContain(f.marks[m]);
  });
});

describe("caps", () => {
  it("1 oz of cheese is fine, 2 oz is the flex top, more is flagged", () => {
    const cap = V4.caps;
    expect(capUse(cap, [{ capTag: "cheese", qty: 1 }])[0].state).toBe("ok");
    expect(capUse(cap, [{ capTag: "cheese", qty: 1 }, { capTag: "cheese", qty: 1 }])[0].state).toBe("flex");
    expect(capUse(cap, [{ capTag: "cheese", qty: 2.5 }, { capTag: null, qty: 9 }])[0]).toMatchObject({ used: 2.5, state: "over" });
  });
});

describe("the Phase 2 V4 fixture is well-formed", () => {
  it("every pattern day, refeed, meal item and cap tag points at something in the fixture", () => {
    const types = new Set(V4.dayTypes.map((d) => d.key));
    const foods = new Set(V4.foods.map((f) => f.key));
    for (const d of [0, 1, 2, 3, 4, 5, 6]) expect(types.has(V4.pattern[d]), `day ${d}`).toBe(true);
    expect(types.has(V4.refeedDayType)).toBe(true);
    for (const m of V4.meals) for (const i of m.items) expect(foods.has(i.food), `${m.name}: ${i.food}`).toBe(true);
    for (const f of V4.foods) if (f.capTag) expect(V4.caps.some((c) => c.tag === f.capTag)).toBe(true);
    for (const d of V4.dayTypes) for (const k of ["cal", "p", "f", "c"] as const) expect(d[k][0]).toBeLessThanOrEqual(d[k][1]);
  });
  it("it holds Danno's numbers exactly as in rev 179", () => {
    expect(V4.dayTypes).toEqual([
      { key: "lift", name: "Lift day", cal: [1400, 1500], p: [180, 200], f: [55, 65], c: [0, 5] },
      { key: "off", name: "Off day", cal: [1400, 1500], p: [150, 180], f: [50, 60], c: [0, 5] },
      { key: "refeed", name: "Refeed", cal: [2200, 2500], p: [180, 200], f: [50, 70], c: [200, 300] },
    ]);
    expect(V4.floors).toEqual({ cal: 1400, f: 46 });
    expect(V4.foods).toHaveLength(21);
  });
});

describe("a blank start: bands are optional, one macro at a time (rev 192)", () => {
  const totals = { cal: 900, p: 70, f: 30, c: 12 };
  const opts2 = { floors: { cal: null, f: null }, overOk: ["p" as const], final: true };
  it("no bands: no marks, nothing to fit, no worst mark", () => {
    expect(hasBands({})).toBe(false);
    expect(dayMarks(totals, {}, opts2)).toEqual({});
    expect(worstMark({})).toBeNull();
    expect(whatFits(totals, {}, [{ id: "m", name: "Anything", totals: { cal: 100, p: 10, f: 1, c: 1 } }], opts2)).toEqual([]);
  });
  it("calories and protein only: marks for those two, and carbs never block a fit", () => {
    const bands = { cal: { min: 1800, max: 2000 }, p: { min: 140, max: 160 } };
    expect(hasBands(bands)).toBe(true);
    expect(Object.keys(dayMarks(totals, bands, opts2)).sort()).toEqual(["cal", "p"]);
    const fits = whatFits(totals, bands, [{ id: "rice", name: "Big rice bowl", totals: { cal: 900, p: 75, f: 10, c: 150 } }], opts2);
    expect(fits.map((f) => f.name)).toEqual(["Big rice bowl"]);
    expect(Object.keys(fits[0].marks).sort()).toEqual(["cal", "p"]);
  });
});

describe("Today's one line", () => {
  it("the brief's shape mid-day: \"780 of 1,400–1,500 cal · 110 of 180–200 P\", no marks while still to go", () => {
    const lift = bandsOf("lift");
    const totals = { cal: 780, p: 110, f: 30, c: 1 };
    const marks = dayMarks(totals, lift, { ...opts, final: false });
    expect(summaryLine(totals, lift, marks)).toBe("780 of 1,400–1,500 cal · 110 of 180–200 P");
  });
  it("marks show once a band is reached, and a member with only fat and carbs set sees those", () => {
    const lift = bandsOf("lift");
    const totals = { cal: 1408, p: 200, f: 61, c: 3 };
    expect(summaryLine(totals, lift, dayMarks(totals, lift, { ...opts, final: false }))).toBe("1,408 of 1,400–1,500 cal ✅ · 200 of 180–200 P ✅");
    expect(summaryLine(totals, { f: lift.f, c: lift.c }, null)).toBe("61 of 55–65 F · 3 of 0–5 C");
  });
});

describe("privacy: a coach can't read Body data unless the member shares", () => {
  const base = { viewerUserId: "coach", viewerRole: "coach" as const, viewerWorkspaceId: "w1", memberUserId: "maya", memberWorkspaceId: "w1", memberRemoved: false, memberEnabled: true, shared: false };
  it("the member always sees their own", () => expect(bodyAccessFor({ ...base, viewerUserId: "maya", viewerRole: "client" })).toBe("self"));
  it("the coach sees nothing until the member shares, and nothing again once revoked", () => {
    expect(bodyAccessFor(base)).toBeNull();
    expect(bodyAccessFor({ ...base, shared: true })).toBe("coach");
    expect(bodyAccessFor({ ...base, shared: false })).toBeNull();
  });
  it("sharing never reaches another client, another workspace's coach or a removed member", () => {
    expect(bodyAccessFor({ ...base, viewerRole: "client", shared: true })).toBeNull();
    expect(bodyAccessFor({ ...base, viewerWorkspaceId: "w2", shared: true })).toBeNull();
    expect(bodyAccessFor({ ...base, memberRemoved: true, shared: true })).toBeNull();
    expect(bodyAccessFor({ ...base, memberWorkspaceId: null, shared: true })).toBeNull();
  });
});

describe("Body ships dark: a member without the flag sees none of it (rev 195)", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("no access at all while a member's Body is off: not the member, not their coach, shared or not", () => {
    const base = { viewerUserId: "maya", viewerRole: "client" as const, viewerWorkspaceId: "w1", memberUserId: "maya", memberWorkspaceId: "w1", memberRemoved: false, memberEnabled: false, shared: true };
    expect(bodyAccessFor(base)).toBeNull();
    expect(bodyAccessFor({ ...base, viewerUserId: "coach", viewerRole: "coach" })).toBeNull();
    expect(bodyAccessFor({ ...base, memberEnabled: true })).toBe("self");
  });
  it("no Body entry in the nav or on the More page without the flag", () => {
    const body = NAV.filter((n) => n.href === "/body");
    expect(body).toHaveLength(1);
    for (const role of ["client", "coach"] as const) {
      expect(navVisible(body[0], { role, passEnabled: true, bodyEnabled: false })).toBe(false);
      expect(navVisible(body[0], { role, passEnabled: false, bodyEnabled: true })).toBe(true);
    }
    // The side menu and the More page both filter through navVisible, so neither can show Body on a rule of its own.
    for (const f of ["src/components/nav.tsx", "src/app/(app)/more/page.tsx"]) expect(read(f)).toMatch(/navVisible\(n, \{[^}]*bodyEnabled/);
  });
  it("every Body page 404s first, the coach's view 404s for a client whose Body is off, and so does the Body export", () => {
    const pages = ["src/app/(app)/body/page.tsx", "src/app/(app)/body/foods/page.tsx", "src/app/(app)/body/settings/page.tsx", "src/app/(app)/body/training/page.tsx", "src/app/(app)/body/training/routines/page.tsx", "src/app/(app)/body/training/[exerciseId]/page.tsx", "src/app/(app)/body/weight/page.tsx", "src/app/(app)/body/pantry/page.tsx", "src/app/(app)/body/week/page.tsx", "src/app/(app)/body/import/page.tsx", "src/app/(app)/body/practices/page.tsx", "src/app/(app)/body/sleep/page.tsx", "src/app/(app)/body/training/health/page.tsx"];
    for (const f of pages) expect(read(f), f).toMatch(/const v = await requireViewer\(\);\n  requireBodyEnabled\(v\);/);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    const routed = walk(join(process.cwd(), "src/app/(app)/body")).filter((f) => f.endsWith("page.tsx")).map((f) => f.slice(process.cwd().length + 1)).sort();
    expect(routed).toEqual([...pages].sort());
    expect(read("src/app/(app)/coach/[clientId]/body/page.tsx")).toMatch(/const client = await sharedClient\(v, clientId\);\n  if \(!client\) notFound\(\);/);
    expect(read("src/lib/queries/body.ts")).toMatch(/if \(!m \|\| !m\.bodyEnabled\) return null;/);
    expect(read("src/app/api/export/route.ts")).toMatch(/if \(bodyOnly && !v\.membership\.bodyEnabled\) return NextResponse\.json\(\{ error: "not found" \}, \{ status: 404 \}\);/);
    expect(read("src/lib/queries/body.ts")).toMatch(/export async function todayBody\(v: Viewer\) \{\n  if \(!v\.membership\.bodyEnabled\) return null;/);
  });
  it("every Body action but delete-all refuses a member whose Body is off", () => {
    const src = read("src/lib/actions/body.ts");
    const actions = [...src.matchAll(/export async function (\w+Action)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1], body: m[2] }));
    expect(actions.length).toBeGreaterThanOrEqual(15);
    const gated = (b: string) => /await setUp\(v\)|\n  enabled\(v\);|bodyAccess\(v, /.test(b);
    expect(actions.filter((a) => !gated(a.body)).map((a) => a.name).sort()).toEqual(["eraseBodyAction", "setBodyBetaAction"]);
  });
  it("the beta switch (rev 209) is the workspace owner's, for their own membership only, and logged", () => {
    const src = read("src/lib/actions/body.ts");
    const beta = src.slice(src.indexOf("export async function setBodyBetaAction"), src.indexOf("/* ───────── Setup ───────── */"));
    expect(beta).toMatch(/const v = await requireCoach\(\);\n  if \(!\(await isWorkspaceOwner\(v\)\)\) redirect/);
    expect(beta).toMatch(/\.where\(and\(eq\(schema\.memberships\.id, v\.membership\.id\)/);
    expect(beta).not.toMatch(/formData, "(id|membershipId|userId)"/);
    expect(beta).toMatch(/await logSync\(/);
    expect(read("src/app/(app)/settings/page.tsx")).toMatch(/\{bodyOwner \? \(/);
  });
});

describe("AI and Body data (rev 219)", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("only the member's own session, with Body on and the AI switch on", () => {
    const base = { viewerUserId: "maya", memberUserId: "maya", memberEnabled: true, aiUse: true };
    expect(bodyAiAllowedFor(base)).toBe(true);
    expect(bodyAiAllowedFor({ ...base, aiUse: false })).toBe(false);
    expect(bodyAiAllowedFor({ ...base, memberEnabled: false })).toBe(false);
    // A coach, or a coach switched into the client's HelixOS, is never the member's own session.
    expect(bodyAiAllowedFor({ ...base, viewerUserId: "coach" })).toBe(false);
  });
  it("what AI is given is numbers and short text, with no place for photos, notes or a coach's comments", () => {
    const lift = bandsOf("lift");
    const text = formatBodyForAi({
      today: "2026-09-29",
      dayTypes: [{ name: "Lift day", bands: lift }],
      days: [{ date: "2026-09-29", dayType: "Lift day", totals: { cal: 1408, p: 200, f: 61, c: 3 }, logged: 3 }, { date: "2026-09-28", dayType: "Off day", totals: { cal: 0, p: 0, f: 0, c: 0 }, logged: 0 }],
      todayEntries: [{ slot: "Lunch", name: "Office Carne Asada Power Lunch", items: [{ name: "Carne asada", qty: 8, unit: "oz" }], totals: { cal: 783, p: 87, f: 47, c: 1 } }],
      meals: ["Steak + Eggs Dinner"],
    });
    for (const want of ["1,400–1,500 cal", "1,408 cal, 200 P, 61 F, 3 C", "nothing logged", "Office Carne Asada Power Lunch (8 oz Carne asada) = 783 cal", "Steak + Eggs Dinner"]) expect(text).toContain(want);
    const type = read("src/lib/engine/body.ts").match(/export type BodyAiInput = \{[\s\S]*?\n\};/)![0];
    expect(type).not.toMatch(/photo|note|comment|blob|image/i);
  });
  it("Body data reaches AI only through bodyAiContext, which checks canAiUseBody first", () => {
    const q = read("src/lib/queries/body.ts");
    expect(q).toMatch(/export async function bodyAiContext\(v: Viewer\): Promise<string \| null> \{\n  if \(!\(await canAiUseBody\(v, v\.user\.id\)\)\) return null;/);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    const files = walk(join(process.cwd(), "src")).filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"));
    const aiCallers = files.filter((f) => /from "@\/lib\/ai"/.test(readFileSync(f, "utf8")));
    expect(aiCallers.length).toBeGreaterThan(3);
    for (const f of aiCallers) {
      const imports = [...readFileSync(f, "utf8").matchAll(/import \{([^}]*)\} from "@\/lib\/queries\/body"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter(Boolean));
      expect(imports.filter((n) => n !== "bodyAiContext"), f).toEqual([]);
    }
    expect(read("src/lib/actions/body.ts")).toMatch(/insert\(schema\.bodyShareEvents\)\.values\(\{ id: newId\(\), workspaceId, userId, shared: on, kind: "ai" \}\)/);
  });
});

describe("Body tables are read in one place, and no Body value reaches a log", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const files = walk(join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
  const ALLOWED = ["src/db/schema.ts", "src/lib/queries/body.ts", "src/lib/actions/body.ts", "src/lib/mcp/tools/body.ts", "src/lib/body-pantry.ts", "src/lib/body-import.ts", "src/lib/member-data.ts", "src/lib/export.ts"];
  it("nothing of Danno's protocol ships as app data: no app module imports the fixture or carries its names (rev 192)", () => {
    expect(files.length).toBeGreaterThan(100);
    const names = ["body-phase2v4", "Phase 2 V4", ...V4.meals.map((m) => m.name), ...V4.foods.map((f) => f.name)];
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return names.filter((n) => text.includes(n)).map((n) => `${f.slice(process.cwd().length + 1)}: ${n}`);
    });
    expect(hits).toEqual([]);
  });
  it("only the Body query and action modules touch a Body table (plus the schema and the export/deletion registry)", () => {
    const touching = files.filter((f) => /schema\.body[A-Z]|db\.query\.body[A-Z]/.test(readFileSync(f, "utf8"))).map((f) => f.slice(process.cwd().length + 1));
    expect(touching.length).toBeGreaterThan(1);
    expect(touching.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });
  it("the Body modules never write to the console", () => {
    const body = files.filter((f) => /[/\\]body[^/\\]*\.tsx?$|[/\\]body[/\\]/.test(f));
    expect(body.length).toBeGreaterThan(3);
    for (const f of body) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.(log|error|warn|info|debug)/);
  });
});

describe("the unit dropdown (rev 229)", async () => {
  const { convertQty, loggableUnits, readUnit, storedUnit, UNITS } = await import("@/lib/engine/body-units");
  it("free-text units saved before the list read onto it, case and plurals aside; anything else is Other with its text kept", () => {
    for (const [typed, want] of [["oz", "oz"], ["Ounces", "oz"], ["ounce", "oz"], ["G", "g"], ["grams", "g"], ["lbs", "lb"], ["Cup", "cup"], ["Tablespoons", "tbsp"], ["2 tbsp", null], ["egg", null], ["strip", null], ["slices", "slice"], ["Scoop", "scoop"]] as const) {
      expect(readUnit(typed).unit, typed).toBe(want);
    }
    expect(readUnit("egg white")).toEqual({ unit: null, other: "egg white" });
    expect(storedUnit("Ounces")).toBe("oz");
    expect(storedUnit("  strip ")).toBe("strip");
    // Every listed unit reads as itself.
    for (const g of UNITS) for (const u of g.units) expect(readUnit(u.unit).unit).toBe(u.unit);
  });
  it("converts within weight and within volume", () => {
    expect(convertQty(1, "lb", "oz")).toBeCloseTo(16, 6);
    expect(convertQty(100, "g", "oz")).toBeCloseTo(3.5274, 3);
    expect(convertQty(1, "kg", "lb")).toBeCloseTo(2.20462, 4);
    expect(convertQty(1, "cup", "tbsp")).toBeCloseTo(16, 6);
    expect(convertQty(3, "tsp", "tbsp")).toBeCloseTo(1, 6);
    expect(convertQty(8, "fl oz", "cup")).toBeCloseTo(1, 6);
    expect(convertQty(2, "Ounces", "oz")).toBe(2);
  });
  it("never across groups, and never for count units or Other", () => {
    expect(convertQty(1, "cup", "oz")).toBeNull();
    expect(convertQty(1, "g", "ml")).toBeNull();
    expect(convertQty(2, "slice", "piece")).toBeNull();
    expect(convertQty(1, "strip", "oz")).toBeNull();
    expect(convertQty(3, "egg", "egg")).toBe(3);
    expect(loggableUnits("oz")).toEqual(["oz", "g", "lb", "kg"]);
    expect(loggableUnits("tbsp")).toEqual(["fl oz", "ml", "cup", "tbsp", "tsp"]);
    expect(loggableUnits("slice")).toEqual(["slice"]);
    expect(loggableUnits("egg white")).toEqual(["egg white"]);
  });
});
