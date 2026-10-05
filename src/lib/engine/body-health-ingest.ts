/**
 * Weigh-ins sent in from Apple Health through an iOS Shortcut (rev 508 §4). The Shortcut reads the latest weight, body fat %,
 * lean body mass and BMI from Health and posts them as JSON; this turns that into readings in the stored units (masses in lb).
 * Pure, so the endpoint does nothing with a body's numbers but save them: nothing here or there logs them.
 *
 * The JSON: { weight, weight_unit, body_fat, lean_mass, lean_unit, bmi, at }, or { readings: [ ...the same ] }. Numbers may come
 * as strings with a unit ("182.4 lb", "82,7 kg") or a decimal comma, as Shortcuts sends them in some regions. `at` is the sample's
 * time as the phone formats it in ISO 8601 ("2026-10-05T07:12:00-07:00"): its own local date and minute are the reading's,
 * the same as on the scale. Lean body mass is stored as fat-free mass.
 */
import { parseAmount } from "@/lib/engine/amount";
import { RANGE, type MetricKey, type Reading } from "@/lib/engine/body-scale";

const LB_PER_KG = 2.20462;
const r1 = (n: number) => Math.round(n * 10) / 10;

export type IngestResult = { readings: Reading[]; skipped: string[] } | { error: string };

/** A mass in lb, from a number and a unit (lb, kg, st, or the unit in the number's own text); null when there's none. */
function mass(raw: unknown, unitRaw: unknown): number | null | { error: string } {
  if (raw == null || raw === "") return null;
  const a = parseAmount(String(raw).replace(/(\d),(\d)/g, "$1.$2"));
  if (a == null) return null;
  if ("error" in a) return { error: a.error };
  // A blank unit field (the Shortcut sends "" when Health gave none) leaves the unit in the number's own text, else lb.
  const unit = (String(unitRaw ?? "").trim() || a.unit || "lb").toLowerCase();
  if (/^(kg|kgs|kilo|kilos|kilograms?)$/.test(unit)) return r1(a.value * LB_PER_KG);
  if (/^(st|stone)$/.test(unit)) return r1(a.value * 14);
  if (/^(lb|lbs|pounds?|)$/.test(unit)) return r1(a.value);
  return { error: `a mass in "${unit}" isn't one this knows (lb, kg or st)` };
}

function plain(raw: unknown): number | null | { error: string } {
  if (raw == null || raw === "") return null;
  const a = parseAmount(String(raw).replace(/(\d),(\d)/g, "$1.$2").replace(/%\s*$/, ""));
  if (a == null) return null;
  if ("error" in a) return { error: a.error };
  return a.value;
}

/** The reading's local date and minute, from the phone's ISO time, else today with no time. */
export function whenOf(at: unknown, today: string): { date: string; time: string | null } | { error: string } {
  if (at == null || at === "") return { date: today, time: null };
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(at).trim());
  if (!m) return { error: `"at" should be the sample's date in ISO 8601 (Format Date → ISO 8601 in the Shortcut), not "${String(at).slice(0, 40)}"` };
  if (m[1] > today) return { error: `"at" is ${m[1]}, after today (${today})` };
  return { date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : null };
}

/** One sample set into a reading; `skipped` names what was left out and why, in words for the Shortcut's notification. */
function one(x: Record<string, unknown>, today: string, skipped: string[]): Reading | { error: string } {
  const when = whenOf(x.at ?? x.date, today);
  if ("error" in when) return when;
  const values: Partial<Record<MetricKey, number>> = {};
  const put = (key: MetricKey, v: number | null | { error: string }, label: string) => {
    if (v == null) return;
    if (typeof v === "object") return void skipped.push(`${label}: ${v.error}`);
    const [lo, hi] = RANGE[key];
    if (v < lo || v > hi) return void skipped.push(`${label} ${v} is outside ${lo} to ${hi}`);
    values[key] = v;
  };
  put("weight", mass(x.weight, x.weight_unit), "weight");
  let bf = plain(x.body_fat);
  // Health keeps body fat as a fraction (0.221) when a Shortcut reads the raw value; as a percent it's 22.1.
  if (typeof bf === "number" && bf > 0 && bf < 1) bf = r1(bf * 100);
  put("bf", bf, "body fat");
  put("ffm", mass(x.lean_mass, x.lean_unit), "lean body mass");
  put("bmi", plain(x.bmi), "BMI");
  if (values.weight == null) return { error: skipped.length ? `No weight to save (${skipped.join("; ")}).` : "No weight to save: the Shortcut sent none. Is there a weight in Health from the last day?" };
  return { date: when.date, time: when.time, values };
}

/** The whole post: one reading, or up to 31 under `readings`. */
export function parseHealthPost(body: unknown, today: string): IngestResult {
  if (!body || typeof body !== "object") return { error: "The Shortcut sent no JSON. Set Get Contents of URL's Request Body to JSON." };
  const b = body as Record<string, unknown>;
  const list = Array.isArray(b.readings) ? b.readings : [b];
  if (!list.length) return { error: "No readings in the post." };
  if (list.length > 31) return { error: "At most 31 readings in one post." };
  const skipped: string[] = [];
  const readings: Reading[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") return { error: "Each reading is an object with weight, weight_unit, body_fat, lean_mass, lean_unit, bmi and at." };
    const r = one(x as Record<string, unknown>, today, skipped);
    if ("error" in r) return r;
    readings.push(r);
  }
  return { readings, skipped };
}

/** What the Shortcut shows when it's done: the numbers saved, in the member's unit, or that they were in already. */
export function savedLine(readings: Reading[], outcomes: ("new" | "filled" | "already")[], unit: "lb" | "kg"): string {
  const w = (lb: number) => (unit === "kg" ? `${r1(lb / LB_PER_KG)} kg` : `${r1(lb)} lb`);
  const parts = readings.map((r, i) => {
    const v = r.values;
    const nums = [v.weight != null ? w(v.weight) : "", v.bf != null ? `${v.bf}% body fat` : "", v.ffm != null ? `${w(v.ffm)} lean` : "", v.bmi != null ? `BMI ${v.bmi}` : ""].filter(Boolean).join(", ");
    return outcomes[i] === "already" ? `${r.date}: already in HumanOS` : `${r.date}${r.time ? ` ${r.time}` : ""}: ${nums}${outcomes[i] === "filled" ? " (added to the reading already there)" : ""}`;
  });
  return `Saved to HumanOS. ${parts.join(". ")}.`;
}
