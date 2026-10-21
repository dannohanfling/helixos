/**
 * The Community Loyalty PARTNER bot's lead webhook (H-1361 PR B, Mercator's spec H-1352): when an owner finishes the bot's
 * flow, the bot posts the business, its type, the city, a reviews bucket, the one thing to fix, the demo time and the source.
 * HelixOS creates or matches the restaurant, never moves one backwards in the pipeline, keeps the bot's answers in `extra`,
 * and logs a touch (who bot, channel bot, first conversation) with the demo as the next step. No owner name, email or phone
 * comes through here; the contact record stays in the bot.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { RESTAURANT_STAGES } from "@/lib/engine/partner";
import { addTouch, restaurantByRef, upsertRestaurant } from "@/lib/partner";

export type LeadBody = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** The bot's type buttons to the program's list. */
export function leadType(raw: string): string {
  const t = raw.toLowerCase();
  if (/truck/.test(t)) return "food truck";
  if (/bakery/.test(t) && !/cafe/.test(t)) return "bakery";
  if (/cafe|coffee/.test(t)) return "cafe";
  if (/\bbar\b|pub/.test(t)) return "bar";
  if (/cater/.test(t)) return "caterer";
  if (/restaurant/.test(t)) return "restaurant";
  return raw ? "other" : "restaurant";
}

/** The bot's source words to the program's list: a taste bud's nomination, else the group. */
export function leadSource(raw: string): string {
  const t = raw.toLowerCase();
  if (/nominat|taste/.test(t)) return "nominated";
  if (/refer/.test(t)) return "referred by partner";
  if (/outreach|dm/.test(t)) return "outreach";
  return "in the group";
}

/** A demo time as the bot sends it: a date to keep, when there is one in it. */
export function leadDemoDate(raw: string): string | null {
  const m = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const t = Date.parse(raw);
  return Number.isFinite(t) && raw.length >= 8 ? new Date(t).toISOString().slice(0, 10) : null;
}

const stageIndex = (stage: string) => RESTAURANT_STAGES.indexOf(stage as (typeof RESTAURANT_STAGES)[number]);

export type LeadResult = { ok: true; restaurantId: string; created: boolean; stage: string } | { ok: false; error: string };

/** The lead into the program: create or match by business name, move forward only, keep the answers, log the touch. */
export async function recordLead(workspaceId: string, body: LeadBody): Promise<LeadResult> {
  const business = s(body.business ?? body.business_name ?? body.name);
  if (!business) return { ok: false, error: "business is required" };
  const demo = s(body.demo_time ?? body.demo ?? body.demoTime);
  const source = leadSource(s(body.source));
  const wanted = demo ? "demo booked" : "talking";
  const existing = await restaurantByRef(workspaceId, business);
  const fields: Record<string, unknown> = {
    // A matched restaurant keeps its own spelling, type and source; a new one takes the bot's.
    ...(existing ? {} : { business, type: leadType(s(body.type)), source, firstContactAt: nowIso().slice(0, 10) }),
    ...(s(body.city) ? { city: s(body.city) } : {}),
  };
  // Forward only: a restaurant already past talking or demo booked keeps its stage and its own dates.
  if (!existing || stageIndex(existing.stage) < stageIndex(wanted)) fields.stage = wanted;
  if (demo && (!existing || !existing.demoAt)) fields.demoAt = leadDemoDate(demo);
  const r = await upsertRestaurant(workspaceId, { ...fields, ...(existing ? { id: existing.id } : {}) });
  const row = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, r.id) }))!;
  const answers: Record<string, string> = {};
  for (const [k, label] of [["google_reviews_bucket", "reviews bucket"], ["pain", "one thing to fix"], ["demo_time", "demo time"], ["who", "who answered"], ["spot", "spot named"]] as const) if (s(body[k])) answers[label] = s(body[k]);
  if (Object.keys(answers).length) await db.update(schema.partnerRestaurants).set({ extra: { ...row.extra, ...answers }, updatedAt: nowIso() }).where(eq(schema.partnerRestaurants.id, r.id));
  const parts = [answers["reviews bucket"] ? `reviews: ${answers["reviews bucket"]}` : "", answers["one thing to fix"] ? `wants: ${answers["one thing to fix"]}` : "", demo ? `demo: ${demo}` : ""].filter(Boolean);
  await addTouch(workspaceId, r.id, { who: "bot", channel: "bot", firstConversation: !existing, note: `PARTNER bot${parts.length ? `: ${parts.join("; ")}` : ""}`, ...(demo ? { nextStep: "Demo walkthrough", nextStepDate: leadDemoDate(demo) } : {}) });
  return { ok: true, restaurantId: r.id, created: r.created, stage: row.stage };
}

/** The workspace a lead lands in: the one named by PARTNER_LEAD_WORKSPACE (a slug), else the only workspace there is. */
export async function leadWorkspace(): Promise<string | null> {
  const slug = (process.env.PARTNER_LEAD_WORKSPACE ?? "").trim();
  if (slug) return (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, slug), columns: { id: true } }))?.id ?? null;
  const all = await db.query.workspaces.findMany({ columns: { id: true }, limit: 2 });
  return all.length === 1 ? all[0].id : null;
}
