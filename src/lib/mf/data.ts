/**
 * The Magic funnel (revs 812, 815; rev 837's answers), the database side: a webinar's setup, the writer that makes one
 * prospect's page (profile first, then every section, checked, regenerated once, each failure falling back alone), mf_prepare
 * for the member's bot, and what the public read gives a page. Everything is scoped to one member. Nothing here logs what a
 * prospect said or what their page says.
 */
import { randomBytes } from "node:crypto";
import { siteUrl } from "@/lib/app-url";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { magicFunnelCall, magicFunnelKey } from "@/lib/ai";
import { allow } from "@/lib/rate-limit";
import { nowIso, todayInTz, wallTimeToUtc } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { PAGE_CODE_BYTES, whenLine } from "@/lib/engine/bot-mcp";
import {
  DAILY_CAP_DEFAULT,
  DEFAULT_PROMPT,
  MF_MAX,
  PROFILE_SYSTEM,
  allDefault,
  assemble,
  checkSections,
  clip,
  customerWordsFrom,
  defaultPitch,
  factNumbers,
  fillPrompt,
  originAllowed,
  parseObject,
  SECTIONS,
  personalUrl,
  pickHero,
  pitchInput,
  pitchRules,
  profileInput,
  publicBody,
  rankProof,
  readPitch,
  readProfile,
  stateFor,
  type CheckContext,
  type MfFacts,
  type MfPitch,
  type MfProfile,
  type MfSection,
  type SectionSource,
} from "@/lib/engine/magic-funnel";
import { countRegistered, personInDms, upcoming, type BotMember } from "@/lib/bot-mcp/data";
import { hostedUrl } from "@/lib/hermes/settings";

type Member = { workspaceId: string; userId: string };
const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T, m: Member) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

/** The coach's own funnel is always available; a client's only once Danno turns their switch on (rev 812 §8). */
export const mfAvailable = (membership: { role: string; mfEnabled: boolean }) => membership.role === "coach" || membership.mfEnabled;

export async function setupFor(m: Member, webinarId: string): Promise<schema.MfSetup | null> {
  return (await db.query.mfSetups.findFirst({ where: and(mine(schema.mfSetups, m), eq(schema.mfSetups.webinarId, webinarId)) })) ?? null;
}

export function factsFor(w: schema.Webinar, tz: string): MfFacts {
  const startsAt = w.scheduledAt ? wallTimeToUtc(w.scheduledAt, tz) : null;
  return { title: w.title, startsAt, when: startsAt ? whenLine(startsAt, tz) : null, promise: w.promise?.trim() || w.desiredResult?.trim() || "", learn: (w.outcomes ?? []).filter(Boolean), whoFor: w.audience?.trim() || "" };
}

/* ───────────────────────── the daily cap ───────────────────────── */

const capKey = (m: Member, tz: string) => `mf:day:${m.workspaceId}:${m.userId}:${todayInTz(tz)}`;
/** Counts one page against today's cap; false when the cap is reached. */
const withinCap = (m: Member, tz: string, cap: number) => allow(capKey(m, tz), cap, 2 * 86_400_000);
export async function pagesToday(m: Member, tz: string): Promise<number> {
  const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, capKey(m, tz)) });
  return row && Date.now() - Number(row.windowStart) < 2 * 86_400_000 ? row.count : 0;
}

/* ───────────────────────── the writer ───────────────────────── */

type Proofish = { id: string; who: string; quote: string; tags: string[]; status: string; permissionAt: string | null };
async function proofsFor(m: Member): Promise<Proofish[]> {
  const rows = await db.query.proofs.findMany({ where: and(mine(schema.proofs, m), eq(schema.proofs.status, "approved")), columns: { id: true, who: true, name: true, quote: true, shortVersion: true, resultAfter: true, tags: true, status: true, permissionAt: true } });
  // Word for word (rev 812 §3): the transcript's own quote, else the member's short version; never rewritten here.
  return rows.map((r) => ({ id: r.id, who: r.who?.trim() || r.name, quote: (r.quote ?? r.shortVersion ?? r.resultAfter ?? "").trim(), tags: r.tags ?? [], status: r.status, permissionAt: r.permissionAt })).filter((r) => r.quote);
}

/** The member's pictures a hero may come from: photos and graphics with tags. */
async function heroCandidates(m: Member): Promise<{ id: string; kind: string; tags: string[] }[]> {
  const rows = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, m.workspaceId), eq(schema.deckImages.userId, m.userId)), columns: { id: true, kind: true, tags: true } });
  return rows.filter((r) => (r.kind === "photo" || r.kind === "graphic") && r.tags.length);
}

/**
 * The hero picture for one page, by its code (GET /api/mf/<code>/hero): only while the page is live and personal or
 * registered, only the picture its pitch chose, and only one of that member's own. The code is the only key: an <img> sends no
 * origin, and the picture is one the member chose to show on their public page.
 */
export async function heroFor(code: string): Promise<{ url: string; mime: string } | null> {
  const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code) });
  const id = s?.pitch?.hero_image_id;
  if (!s || !id) return null;
  const m = { workspaceId: s.workspaceId, userId: s.userId };
  const [setup, membership, img] = await Promise.all([
    setupFor(m, s.webinarId),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, m.userId)) }),
    db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, m.workspaceId), eq(schema.deckImages.userId, m.userId)) }),
  ]);
  if (!setup?.live || !membership || membership.removedAt || !mfAvailable(membership) || !img) return null;
  return { url: img.blobUrl, mime: img.mime };
}

export type Written = { profile: MfProfile | null; pitch: MfPitch; sources: Record<MfSection, SectionSource>; status: "personal" | "partial" | "default"; note: string | null; failed: Partial<Record<MfSection, string>> };

/**
 * One prospect's page. No key, the cap reached, or no usable profile: the whole page is the default copy. Otherwise every
 * section is checked; the failures are written once more, and whatever still fails takes its default alone.
 */
export async function composePage(o: { member: Member; tz: string; cap: number; webinar: schema.Webinar; setup: schema.MfSetup; firstName: string; said: { pain: string; industry: string; summary: string }; custom: Record<string, string> }): Promise<Written> {
  const facts = factsFor(o.webinar, o.tz);
  const proofs = await proofsFor(o.member);
  const fallback = (profile: MfProfile | null) =>
    defaultPitch({ defaults: o.setup.defaults, pillars: o.setup.pillars, agenda: o.setup.agenda, proofIds: (o.setup.proofIds.length || o.setup.proofAny ? rankProof(proofs, o.setup.proofIds, profile) : []).map((p) => p.id), firstName: o.firstName, facts });
  const plain = (note: string, profile: MfProfile | null = null): Written => ({ profile, pitch: fallback(profile), sources: allDefault(), status: "default", note, failed: {} });

  const writer = await magicFunnelKey(o.member);
  if (!writer.key) return plain("no key");
  if (!(await withinCap(o.member, o.tz, o.cap))) return plain("daily cap");

  const prof = await magicFunnelCall(writer.key, "profile", PROFILE_SYSTEM, profileInput({ ...o.said, custom: o.custom }), 600);
  const profile = readProfile(parseObject(prof.text));
  if (!profile) return plain(prof.why ? `no profile: ${prof.why}` : "no profile: no JSON in the reply");

  // Proof on the page (H-9): the chosen items, else any with the permission tick when the setup allows it, else none.
  const pool = o.setup.proofIds.length || o.setup.proofAny ? rankProof(proofs, o.setup.proofIds, profile) : [];
  const ranked = pool.slice(0, 8);
  const ctx: CheckContext = {
    pillarIds: o.setup.pillars.map((p) => p.id),
    agendaIds: o.setup.agenda.map((a) => a.id),
    proofIds: ranked.map((p) => p.id),
    urgency: o.setup.urgency,
    allowedNumbers: factNumbers(facts, o.setup.urgency),
    raw: [o.said.pain, o.said.industry, o.said.summary, ...Object.values(o.custom)].filter(Boolean),
    customerWords: customerWordsFrom(profile),
  };
  const system = `${pitchRules({ pillarIds: ctx.pillarIds, agendaIds: ctx.agendaIds, proofIds: ctx.proofIds, urgency: o.setup.urgency })}\n\n<voice>\n${fillPrompt(o.setup.prompt ?? DEFAULT_PROMPT, o.firstName, profile.main_pain)}\n</voice>`;
  const input = pitchInput({ facts, pillars: o.setup.pillars, agenda: o.setup.agenda, objections: o.setup.objections, proofs: ranked.map((p) => ({ id: p.id, who: p.who, tags: p.tags, line: p.quote.slice(0, 400) })), profile, firstName: o.firstName });

  // The page (H-11): one call; a reply that was cut, refused or never came gets one plain second try (a bigger limit when
  // it was cut, a pause when Anthropic was busy), never a "you broke the rules" retry against a reply nobody read.
  let r = await magicFunnelCall(writer.key, "pitch", system, input, 2000);
  if (!r.text) {
    if (/429|overloaded/.test(r.why ?? "")) await new Promise((res) => setTimeout(res, 2500));
    r = await magicFunnelCall(writer.key, "pitch", system, input, /cut at/.test(r.why ?? "") ? 3500 : 2000);
  }
  let firstRaw = parseObject(r.text);
  if (r.text && !firstRaw) r = { ...(await magicFunnelCall(writer.key, "pitch", system, `${input}\n\nReply with the JSON object only.`, 2000)) };
  if (r.text && !firstRaw) firstRaw = parseObject(r.text);
  const writerWhy = !r.text ? r.why : !firstRaw ? "no JSON in the reply" : null;
  if (writerWhy) return { ...plain(writerWhy, profile), failed: Object.fromEntries(SECTIONS.map((s) => [s, `writer: ${writerWhy}`])) as Partial<Record<MfSection, string>> };
  const first = readPitch(firstRaw);
  const firstCheck = checkSections(first, ctx);
  const failing = (Object.keys(firstCheck) as MfSection[]).filter((s) => firstCheck[s]);
  let retry: MfPitch | null = null;
  let retryCheck: Record<MfSection, string | null> | null = null;
  if (failing.length) {
    const why = failing.map((s) => `${s}: ${firstCheck[s]}`).join("; ");
    const again = await magicFunnelCall(writer.key, "pitch", system, `${input}\n\nYour last version broke the rules in these sections (${why}). Write the whole JSON again and fix them.`, 2500);
    retry = again.text ? readPitch(parseObject(again.text)) : null;
    retryCheck = retry ? checkSections(retry, ctx) : null;
  }
  const { pitch, sources } = assemble(first, firstCheck, retry, retryCheck, fallback(profile));
  // The hero picture (Magic funnel C): one of their own Images tagged for this industry, or none.
  pitch.hero_image_id = pickHero(await heroCandidates(o.member), profile);
  const personal = Object.values(sources).filter((x) => x === "personal").length;
  const failed = Object.fromEntries(failing.filter((s) => sources[s] === "default").map((s) => [s, retryCheck?.[s] ?? firstCheck[s]!])) as Partial<Record<MfSection, string>>;
  return { profile, pitch, sources, status: personal === 0 ? "default" : personal === Object.keys(sources).length ? "personal" : "partial", note: personal === 0 ? "failed" : null, failed };
}

/** Write (or rewrite) one sign-up's page and keep it on the row. Runs after the bot's reply, so the bot never waits. */
export async function writeForSignup(signupId: string): Promise<void> {
  const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.id, signupId) });
  if (!s) return;
  const m = { workspaceId: s.workspaceId, userId: s.userId };
  const [w, setup, membership, ws] = await Promise.all([
    db.query.webinars.findFirst({ where: and(mine(schema.webinars, m), eq(schema.webinars.id, s.webinarId)) }),
    setupFor(m, s.webinarId),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, m.userId)) }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId), columns: { timezone: true } }),
  ]);
  if (!w || !setup || !membership) return;
  const tz = membership.timezone ?? ws?.timezone ?? "UTC";
  try {
    const r = await composePage({ member: m, tz, cap: membership.mfDailyCap ?? DAILY_CAP_DEFAULT, webinar: w, setup, firstName: s.firstName, said: s.said ?? { pain: "", industry: "", summary: "" }, custom: s.custom });
    await db.update(schema.webinarSignups).set({ profile: r.profile, pitch: r.pitch, pitchSources: r.sources, pitchStatus: r.status, pitchNote: r.note, pitchAt: nowIso() }).where(eq(schema.webinarSignups.id, s.id));
  } catch (e) {
    // The reason stays on the row for the coach's page (H-15), the error's name in the log, never the prospect's words.
    const name = (e as { name?: string; status?: number })?.name ?? "error";
    console.error("[mf] write failed", JSON.stringify({ name, status: (e as { status?: number })?.status ?? null }));
    await db.update(schema.webinarSignups).set({ pitchStatus: "default", pitchNote: `write failed: ${name}`, pitchAt: nowIso() }).where(eq(schema.webinarSignups.id, s.id));
  }
}

/* ───────────────────────── mf_prepare ───────────────────────── */

export type PrepareInput = { contactId: string; firstName: string; lastName: string; email: string; phone: string; pain: string; industry: string; summary: string; custom: Record<string, string> };

/**
 * mf_prepare: the person in this conversation becomes a prospect for the next webinar with a live Magic funnel. They go into
 * DMs as a "webinar" lead; they are not registered until they register. Returns their personal link at once; the page is
 * written after the reply. Someone already registered gets the same link, which shows "You're in".
 */
export async function mfPrepare(m: BotMember, input: PrepareInput): Promise<{ ok: true; signupId: string | null; body: { status: "prepared" | "already registered"; title: string; personal_url: string } } | { ok: false; line: string }> {
  if (!mfAvailable(m.membership)) return { ok: false, line: "The Magic funnel isn't switched on for this business." };
  const w = await upcoming(m);
  if (!w) return { ok: false, line: "There's no webinar scheduled right now." };
  const setup = await setupFor(m, w.id);
  if (!setup?.live) return { ok: false, line: "The next webinar has no Magic funnel live yet." };
  const hosted = await hostedUrl(m, w.id); // Hermes: null unless "Host pages in HelixOS" is on for this webinar
  if (!hosted && (!w.registrationUrl?.trim() || !/^https:\/\//.test(w.registrationUrl.trim()))) return { ok: false, line: "The next webinar has no registration page set yet." };

  const email = input.email.toLowerCase();
  const said = { pain: clip(input.pain, MF_MAX.pain), industry: clip(input.industry, MF_MAX.industry), summary: clip(input.summary, MF_MAX.summary) };
  const had = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, w.id), eq(schema.webinarSignups.email, email)) });
  const url = (code: string) => (hosted ? hosted(code) : personalUrl(w.registrationUrl!.trim(), code));
  const contactId = await personInDms(m, { firstName: input.firstName, email, contactId: input.contactId, note: had?.registeredAt ? `Already signed up for "${w.title}".` : `Sent a Magic funnel page for "${w.title}".` });

  if (had) {
    if (had.registeredAt) return { ok: true, signupId: null, body: { status: "already registered", title: w.title, personal_url: url(had.pageCode) } };
    await db
      .update(schema.webinarSignups)
      .set({ firstName: input.firstName, lastName: input.lastName || had.lastName, phone: input.phone || had.phone, clContactId: input.contactId, contactId, custom: { ...had.custom, ...input.custom }, said, source: "mf", pitchStatus: "writing" })
      .where(eq(schema.webinarSignups.id, had.id));
    return { ok: true, signupId: had.id, body: { status: "prepared", title: w.title, personal_url: url(had.pageCode) } };
  }
  const id = newId();
  const pageCode = randomBytes(PAGE_CODE_BYTES).toString("base64url");
  try {
    await db.insert(schema.webinarSignups).values({ id, workspaceId: m.workspaceId, userId: m.userId, webinarId: w.id, firstName: input.firstName, lastName: input.lastName || null, email, phone: input.phone || null, contactId, clContactId: input.contactId, custom: input.custom, said, pageCode, source: "mf", pitchStatus: "writing" });
  } catch {
    const again = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, w.id), eq(schema.webinarSignups.email, email)), columns: { pageCode: true } });
    if (!again) throw new Error("sign-up not saved");
    return { ok: true, signupId: null, body: { status: "prepared", title: w.title, personal_url: url(again.pageCode) } };
  }
  return { ok: true, signupId: id, body: { status: "prepared", title: w.title, personal_url: url(pageCode) } };
}

/* ───────────────────────── the public read ───────────────────────── */

/** Marks one sign-up registered, once, and counts it (GHL's webhook and the page's own signal, in commit B). */
export async function markRegistered(signupId: string, via: "webhook" | "page" | "helixos"): Promise<boolean> {
  const done = await db
    .update(schema.webinarSignups)
    .set({ registeredAt: nowIso(), registeredVia: via })
    .where(and(eq(schema.webinarSignups.id, signupId), isNull(schema.webinarSignups.registeredAt)))
    .returning({ webinarId: schema.webinarSignups.webinarId });
  if (done[0]) await countRegistered(done[0].webinarId);
  return Boolean(done[0]);
}

export type PublicRead = { status: number; origin: string | null; body: unknown; member: Member | null; webinarId: string | null; outcome: string };

/**
 * GET /api/mf/<code>. Only that person's page, and only to the member's funnel domains. The prefill (first and last name,
 * email, phone) comes back until they register or the webinar starts; after that only "You're in" or the generic state.
 */
export async function publicRead(code: string, origin: string | null, now = new Date()): Promise<PublicRead> {
  const generic: PublicRead = { status: 200, origin: null, body: { state: "generic" }, member: null, webinarId: null, outcome: "unknown code" };
  const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code) });
  if (!s) return generic;
  const m = { workspaceId: s.workspaceId, userId: s.userId };
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, m.userId)) });
  const domains = membership?.mfDomains ?? [];
  if (!membership || membership.removedAt || !originAllowed(origin, domains)) return { status: 403, origin: null, body: { state: "generic" }, member: m, webinarId: s.webinarId, outcome: "origin refused" };
  const base = { origin, member: m, webinarId: s.webinarId };
  const [w, setup, ws] = await Promise.all([
    db.query.webinars.findFirst({ where: and(mine(schema.webinars, m), eq(schema.webinars.id, s.webinarId)) }),
    setupFor(m, s.webinarId),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId), columns: { timezone: true } }),
  ]);
  if (!w || !setup?.live || !mfAvailable(membership)) return { ...base, status: 200, body: { state: "generic" }, outcome: "not live" };
  const facts = factsFor(w, membership.timezone ?? ws?.timezone ?? "UTC");
  const state = stateFor({ registeredAt: s.registeredAt, startsAt: facts.startsAt }, now);
  if (!s.openedAt) await db.update(schema.webinarSignups).set({ openedAt: now.toISOString() }).where(eq(schema.webinarSignups.id, s.id));
  if (state === "personal" && !s.pitch) return { ...base, status: 200, body: { state, ready: false, webinar: { title: facts.title, starts_at: facts.startsAt, when: facts.when }, prefill: { first_name: s.firstName, last_name: s.lastName ?? "", email: s.email, phone: s.phone ?? "" } }, outcome: "writing" };
  const proofRows = s.pitch?.proof_ids.length ? await proofsFor(m) : [];
  const proofs = (s.pitch?.proof_ids ?? []).map((id) => proofRows.find((p) => p.id === id && p.permissionAt)).filter((p): p is Proofish => Boolean(p)).map((p) => ({ id: p.id, who: p.who, quote: p.quote }));
  const heroUrl = s.pitch?.hero_image_id ? `${siteUrl()}/api/mf/${code}/hero` : null;
  const body = publicBody({ state, pitch: s.pitch, facts, proofs, prefill: state === "personal" ? { first_name: s.firstName, last_name: s.lastName ?? "", email: s.email, phone: s.phone ?? "" } : null, heroUrl });
  return { ...base, status: 200, body: state === "personal" ? { ...body, ready: true } : body, outcome: state };
}

/** The page's own signal (the backup): her funnel domain only; marks the person registered once. */
export async function pageRegistered(code: string, origin: string | null): Promise<{ ok: boolean; member: Member | null; outcome: string }> {
  const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code), columns: { id: true, workspaceId: true, userId: true, registeredAt: true } });
  if (!s) return { ok: false, member: null, outcome: "unknown code" };
  const m = { workspaceId: s.workspaceId, userId: s.userId };
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, m.userId)), columns: { mfDomains: true } });
  if (!originAllowed(origin, membership?.mfDomains ?? [])) return { ok: false, member: m, outcome: "origin refused" };
  if (s.registeredAt) return { ok: true, member: m, outcome: "already registered" };
  return { ok: await markRegistered(s.id, "page"), member: m, outcome: "registered" };
}

/** GoHighLevel's workflow webhook (the source of truth): a Magic funnel code in the form's mf_code field marks them registered. */
export async function webhookRegistered(workspaceId: string, code: string): Promise<string> {
  const s = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.pageCode, code), eq(schema.webinarSignups.workspaceId, workspaceId)), columns: { id: true, registeredAt: true } });
  if (!s) return "Magic funnel: unknown code";
  if (s.registeredAt) return "Magic funnel: already registered";
  return (await markRegistered(s.id, "webhook")) ? "Magic funnel: registered" : "Magic funnel: already registered";
}
