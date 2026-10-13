"use server";

/**
 * The Magic funnel's setup (revs 812, 815; rev 837's answers): Coach → Webinars → Magic funnel per webinar, the preview, the
 * member's funnel domains in Settings, and the coach's switch and daily cap for each client (off until Danno turns it on).
 */
import { and, desc, eq, isNotNull, or, sql, type AnyColumn } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { composePage, mfAvailable, setupFor } from "@/lib/mf/data";
import { DAILY_CAP_DEFAULT, DEFAULT_PROMPT, EMPTY_DEFAULTS, MF_MAX, SECTION_MAX, clip, cleanDomain, cleanFirstName, type MfDefaults, type MfPitch, type MfProfile, type MfSection, type SectionSource } from "@/lib/engine/magic-funnel";

const line = (fd: FormData, key: string, max: number) => clip(str(fd, key), max);
const list = (fd: FormData, key: string, max: number, most: number) =>
  str(fd, key)
    .split("\n")
    .map((l) => clip(l, max))
    .filter(Boolean)
    .slice(0, most);

/** The webinar, the member's own; anything else goes back to Webinars. */
async function ownWebinar(m: { workspaceId: string; userId: string }, id: string) {
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.workspaceId, m.workspaceId), eq(schema.webinars.userId, m.userId)) });
  if (!w) redirect("/webinars");
  return w!;
}

/** What still stops the switch going on: the switch for this member, a registration page, three pillars, the hero's default copy. */
function liveProblems(o: { available: boolean; registrationUrl: string | null; pillars: number; defaults: MfDefaults; when: string | null }): string[] {
  const out: string[] = [];
  if (!o.available) out.push("the Magic funnel isn't switched on for you yet");
  if (!o.registrationUrl || !/^https:\/\//.test(o.registrationUrl)) out.push("a registration page starting with https:// (Run it)");
  if (!o.when) out.push("a date and time (Run it)");
  if (o.pillars !== 3) out.push("three pillars");
  if (!o.defaults.header || !o.defaults.subheader || !o.defaults.emotional || !o.defaults.logical) out.push("default copy for the header, subheader, emotional and logical parts");
  return out;
}

export async function saveMfSetupAction(fd: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const m = { workspaceId, userId };
  const w = await ownWebinar(m, str(fd, "webinarId"));
  const pillars = [1, 2, 3]
    .map((i) => ({ id: `p${i}`, title: line(fd, `pillar_${i}_title`, MF_MAX.pillarTitle), copy: line(fd, `pillar_${i}_copy`, MF_MAX.pillarCopy) }))
    .filter((p) => p.title);
  const agenda = list(fd, "agenda", MF_MAX.agendaLine, MF_MAX.agendaItems).map((l, i) => ({ id: `a${i + 1}`, line: l }));
  const objections = Array.from({ length: MF_MAX.objections }, (_, i) => ({ objection: line(fd, `obj_${i}_q`, MF_MAX.objection), answer: line(fd, `obj_${i}_a`, MF_MAX.answer) })).filter((o) => o.objection && o.answer);
  const cap = Number(str(fd, "seatCap"));
  const deadline = str(fd, "bonusDeadline");
  const urgency = { seatCap: Number.isInteger(cap) && cap > 0 && cap < 100000 ? cap : null, bonusDeadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null, bonusLine: line(fd, "bonusLine", MF_MAX.bonusLine), liveOnly: str(fd, "liveOnly") === "1" };
  const defaults: MfDefaults = {
    header: line(fd, "d_header", SECTION_MAX.header),
    subheader: line(fd, "d_subheader", SECTION_MAX.subheader),
    ctaLabel: line(fd, "d_ctaLabel", SECTION_MAX.ctaLabel) || EMPTY_DEFAULTS.ctaLabel,
    whyYou: list(fd, "d_whyYou", SECTION_MAX.bullet, 3),
    exampleTitle: line(fd, "d_exampleTitle", SECTION_MAX.exampleTitle),
    example: line(fd, "d_example", SECTION_MAX.example),
    objection: { objection: line(fd, "d_objection", SECTION_MAX.objection), answer: line(fd, "d_answer", SECTION_MAX.answer) },
    urgency: line(fd, "d_urgency", SECTION_MAX.urgency),
    emotional: line(fd, "d_emotional", SECTION_MAX.emotional),
    logical: line(fd, "d_logical", SECTION_MAX.logical),
    ticketTitle: line(fd, "d_ticketTitle", SECTION_MAX.ticketTitle),
    bring: list(fd, "d_bring", SECTION_MAX.bring, 3),
  };
  // A textarea posts its line breaks as CRLF: the default comes back unchanged only once they are LF again.
  const prompt = str(fd, "prompt").replace(/\r\n?/g, "\n").slice(0, MF_MAX.prompt).trim();
  const proofIds = fd.getAll("proofIds").map(String).filter(Boolean).slice(0, 40);
  const wantLive = str(fd, "live") === "1";
  const problems = wantLive ? liveProblems({ available: mfAvailable(v.membership), registrationUrl: w.registrationUrl, pillars: pillars.length, defaults, when: w.scheduledAt }) : [];
  const values = { pillars, agenda, objections, urgency, defaults, proofIds, prompt: !prompt || prompt === DEFAULT_PROMPT ? null : prompt, live: wantLive && !problems.length, updatedAt: nowIso() };
  const had = await setupFor(m, w.id);
  if (had) await db.update(schema.mfSetups).set(values).where(eq(schema.mfSetups.id, had.id));
  else await db.insert(schema.mfSetups).values({ id: newId(), workspaceId, userId, webinarId: w.id, ...values });
  refresh();
  redirect(`/webinars/${w.id}/magic-funnel?${problems.length ? `held=${encodeURIComponent(problems.join("; "))}` : "saved=1"}`);
}

export type MfProofHit = { id: string; label: string; tags: string[] };

/**
 * The proof picker's search (H-7): this member's approved proof with the permission tick, matched by name, tag or a few words
 * of the proof, 20 at a time. The page never lists the whole Proof Bank, and Save sends only the chosen ids.
 */
export async function searchMfProofsAction(q: string, offset: number): Promise<{ hits: MfProofHit[]; more: boolean }> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "noop" });
  const words = String(q ?? "").toLowerCase().trim().slice(0, 100);
  const like = `%${words.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const has = (col: AnyColumn) => sql`lower(coalesce(${col}, '')) like ${like} escape '\\'`;
  const P = schema.proofs;
  const rows = await db.query.proofs.findMany({
    where: and(eq(P.workspaceId, workspaceId), eq(P.userId, userId), eq(P.status, "approved"), isNotNull(P.permissionAt), words ? or(has(P.name), has(P.who), has(P.tags), has(P.quote), has(P.shortVersion)) : undefined),
    orderBy: desc(P.createdAt),
    columns: { id: true, name: true, who: true, tags: true },
    limit: 21,
    offset: Math.max(0, Math.min(Number(offset) || 0, 100000)),
  });
  return { hits: rows.slice(0, 20).map((r) => ({ id: r.id, label: r.who || r.name, tags: r.tags })), more: rows.length > 20 };
}

export type PreviewResult = { ok: true; profile: MfProfile | null; pitch: MfPitch; sources: Record<MfSection, SectionSource>; status: string; note: string | null; failed: Partial<Record<MfSection, string>> } | { ok: false; error: string };

/** Preview (rev 815 §4): a sample conversation, the whole page that person would get, section by section. Nothing is stored. */
export async function previewMfAction(_prev: PreviewResult | null, fd: FormData): Promise<PreviewResult> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "noop" });
  const m = { workspaceId, userId };
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, str(fd, "webinarId")), eq(schema.webinars.workspaceId, workspaceId), eq(schema.webinars.userId, userId)) });
  if (!w) return { ok: false, error: "That webinar isn't yours." };
  const setup = await setupFor(m, w.id);
  if (!setup) return { ok: false, error: "Save the setup first, then preview it." };
  const pain = clip(str(fd, "pain"), MF_MAX.pain);
  const industry = clip(str(fd, "industry"), MF_MAX.industry);
  const summary = clip(str(fd, "summary"), MF_MAX.summary);
  if (!pain && !summary) return { ok: false, error: "Type their biggest pain or a sample conversation." };
  const r = await composePage({ member: m, tz: v.tz, cap: v.membership.mfDailyCap ?? DAILY_CAP_DEFAULT, webinar: w, setup, firstName: cleanFirstName(str(fd, "firstName")) || "Sam", said: { pain, industry, summary }, custom: {} });
  return { ok: true, ...r };
}

/** The hosts the member's GoHighLevel pages are on (Settings): the only origins the public read answers. */
export async function saveMfDomainsAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Funnel domains are {first}'s own setting." });
  const raw = str(fd, "domains").split(/[\s,]+/).filter(Boolean);
  const domains = Array.from(new Set(raw.map(cleanDomain).filter((d): d is string => Boolean(d)))).slice(0, MF_MAX.domains);
  const bad = raw.filter((d) => !cleanDomain(d));
  const cap = Number(str(fd, "dailyCap"));
  const own = v.membership.role === "coach" && Number.isInteger(cap) && cap >= 0 && cap <= 5000 ? { mfDailyCap: cap } : {};
  await db.update(schema.memberships).set({ mfDomains: domains, ...own }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  redirect(`/settings?${bad.length ? `mfError=${encodeURIComponent(`Not a domain: ${bad.slice(0, 3).join(", ")}. Use the host only, like go.yourdomain.com.`)}` : "mf=saved"}#magic-funnel`);
}

/** The coach's switch and daily cap for one client (rev 812 §8): off until Danno turns it on for that client. */
export async function setMfClientAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(fd, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) redirect("/coach");
  const cap = Number(str(fd, "dailyCap"));
  await db
    .update(schema.memberships)
    .set({ mfEnabled: str(fd, "enabled") === "1", ...(Number.isInteger(cap) && cap >= 0 && cap <= 5000 ? { mfDailyCap: cap } : {}) })
    .where(eq(schema.memberships.id, m!.id));
  refresh();
  redirect(`/coach/${m!.id}/bot#magic-funnel`);
}
