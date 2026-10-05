import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHealthPost, savedLine, whenOf } from "@/lib/engine/body-health-ingest";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const TODAY = "2026-10-05";

describe("weigh-ins from Apple Health (rev 508 §4)", () => {
  it("one post: masses to lb, body fat as a percent (a fraction too), lean body mass as fat-free mass, the phone's own minute", () => {
    const r = parseHealthPost({ weight: "82,7", weight_unit: "kg", body_fat: 0.221, lean_mass: "64.4 kg", bmi: "25.3", at: "2026-10-05T07:12:41-07:00" }, TODAY);
    expect(r).toEqual({ readings: [{ date: "2026-10-05", time: "07:12", values: { weight: 182.3, bf: 22.1, ffm: 142, bmi: 25.3 } }], skipped: [] });
    expect(parseHealthPost({ weight: "182", weight_unit: "", lean_mass: "66 kg", lean_unit: "" }, TODAY)).toMatchObject({ readings: [{ values: { weight: 182, ffm: 145.5 } }] });
    const lb = parseHealthPost({ weight: 182.4, weight_unit: "lb", body_fat: "22.1%", at: "2026-10-04 06:58" }, TODAY);
    expect(lb).toEqual({ readings: [{ date: "2026-10-04", time: "06:58", values: { weight: 182.4, bf: 22.1 } }], skipped: [] });
  });

  it("empty fields are left out; a number out of range is named and skipped; no weight is no save", () => {
    const r = parseHealthPost({ weight: 180, weight_unit: "lb", body_fat: "", lean_mass: "", bmi: 300 }, TODAY);
    expect(r).toEqual({ readings: [{ date: TODAY, time: null, values: { weight: 180 } }], skipped: ["BMI 300 is outside 10 to 80"] });
    expect(parseHealthPost({ body_fat: 22 }, TODAY)).toEqual({ error: "No weight to save: the Shortcut sent none. Is there a weight in Health from the last day?" });
    expect(parseHealthPost({ weight: 80, weight_unit: "grams" }, TODAY)).toEqual({ error: `No weight to save (weight: a mass in "grams" isn't one this knows (lb, kg or st)).` });
    expect(parseHealthPost(null, TODAY)).toMatchObject({ error: expect.stringMatching(/no JSON/) });
    expect(parseHealthPost({ readings: Array(32).fill({ weight: 180 }) }, TODAY)).toEqual({ error: "At most 31 readings in one post." });
  });

  it("a date the Shortcut didn't format, or one after today, is refused in words", () => {
    expect(whenOf("Oct 5, 2026 at 7:12 AM", TODAY)).toMatchObject({ error: expect.stringMatching(/ISO 8601/) });
    expect(whenOf("2026-10-06T07:00:00Z", TODAY)).toEqual({ error: '"at" is 2026-10-06, after today (2026-10-05)' });
    expect(whenOf(undefined, TODAY)).toEqual({ date: TODAY, time: null });
  });

  it("the Shortcut's notification says what was saved, in the member's unit, or that it was in already", () => {
    const readings = [{ date: "2026-10-05", time: "07:12", values: { weight: 182.3, bf: 22.1, ffm: 142 } }, { date: "2026-10-04", time: null, values: { weight: 183 } }];
    expect(savedLine(readings, ["new", "already"], "kg")).toBe("Saved to HumanOS. 2026-10-05 07:12: 82.7 kg, 22.1% body fat, 64.4 kg lean. 2026-10-04: already in HumanOS.");
    expect(savedLine([readings[1]], ["filled"], "lb")).toBe("Saved to HumanOS. 2026-10-04: 183 lb (added to the reading already there).");
  });

  it("the key: only its hash is stored, one live key per member, the endpoint is public, rate-limited and logs nothing", () => {
    const lib = read("src/lib/body-health.ts");
    expect(lib).toMatch(/tokenHash: hashKey\(key\)/);
    expect(lib).toMatch(/set\(\{ revokedAt: nowIso\(\) \}\)[^\n]+isNull\(schema\.bodyIngestTokens\.revokedAt\)/);
    expect(lib).toMatch(/saveReadings\(key\.workspaceId, key\.userId, parsed\.readings, "health"\)/);
    const route = read("src/app/api/body/health-weigh-in/route.ts");
    expect(route).toMatch(/allow\(`health-ingest-ip:/);
    expect(route).toMatch(/allow\(`health-ingest:\$\{found\.id\}`/);
    for (const f of [lib, route, read("src/components/body/health-connect.tsx"), read("src/lib/engine/body-health-ingest.ts")]) expect(f).not.toMatch(/console\.|logSync|syncEvents/);
    expect(read("src/proxy.ts")).toMatch(/"\/api\/body\/health-weigh-in"/);
    // Shown once, from the action's answer: never in an address.
    expect(read("src/lib/actions/body.ts")).toMatch(/export async function makeHealthKeyAction\(\): Promise<\{ key: string \} \| \{ error: string \}>/);
    expect(read("src/components/body/health-connect.tsx")).not.toMatch(/searchParams|router\.push|\?key=/);
  });
});
