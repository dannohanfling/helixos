/**
 * Buyer avatars' reads and writes (rev 501, built by Body at rev 508). Every read and write is scoped to one member: the
 * workspace and the user together, the same rule as rev 511's fix, so an avatar or a link never crosses to another member.
 * The page's actions and the connector's tools both go through here.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { AVATAR_FIELDS, type Avatar, type AvatarField } from "@/db/schema";
import { avatarBrief, avatarForDraft, copyName, importPlan, parentProblem, type LinkRow, type OfferRef } from "@/lib/engine/avatars";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

export type Member = { workspaceId: string; userId: string };
const mine = (m: Member) => and(eq(schema.avatars.workspaceId, m.workspaceId), eq(schema.avatars.userId, m.userId));
const myLinks = (m: Member) => and(eq(schema.avatarOffers.workspaceId, m.workspaceId), eq(schema.avatarOffers.userId, m.userId));

export type AvatarData = { rows: Avatar[]; links: LinkRow[]; offers: OfferRef[] };

/** The member's avatars (archived ones too), their links, and their offers in the order the Offers page makes them. */
export async function avatarData(m: Member): Promise<AvatarData> {
  const [rows, links, offers] = await Promise.all([
    db.query.avatars.findMany({ where: mine(m), orderBy: asc(schema.avatars.createdAt) }),
    db.query.avatarOffers.findMany({ where: myLinks(m) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, m.workspaceId), eq(schema.offers.userId, m.userId)), orderBy: asc(schema.offers.createdAt), columns: { id: true, name: true, avatar: true, status: true } }),
  ]);
  return { rows, links: links.map((l) => ({ avatarId: l.avatarId, offerId: l.offerId, main: l.main })), offers };
}

/** The first visit's import: each distinct free-text avatar on the member's offers, once, only if they've never had an avatar. */
export async function importFromOffers(m: Member): Promise<number> {
  const had = await db.query.avatars.findFirst({ where: mine(m), columns: { id: true } });
  if (had) return 0;
  const offers = await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, m.workspaceId), eq(schema.offers.userId, m.userId)), orderBy: asc(schema.offers.createdAt), columns: { id: true, name: true, avatar: true } });
  const plan = importPlan(offers, false);
  for (const p of plan) {
    const id = newId();
    await db.insert(schema.avatars).values({ id, ...m, name: p.name, who: p.who, imported: true });
    await db.insert(schema.avatarOffers).values(p.offerIds.map((offerId) => ({ id: newId(), ...m, avatarId: id, offerId, main: true }))).onConflictDoNothing();
  }
  return plan.length;
}

async function own(m: Member, id: string): Promise<Avatar> {
  const a = await db.query.avatars.findFirst({ where: and(mine(m), eq(schema.avatars.id, id)) });
  if (!a) throw new Error("That avatar isn't yours or isn't there any more.");
  return a;
}
async function ownOffer(m: Member, id: string) {
  const o = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, id), eq(schema.offers.workspaceId, m.workspaceId), eq(schema.offers.userId, m.userId)), columns: { id: true, name: true } });
  if (!o) throw new Error("That offer isn't yours or isn't there any more.");
  return o;
}

export type AvatarInput = { name?: string; oneLine?: string | null; parentId?: string | null; primary?: boolean } & Partial<Record<AvatarField, string | null>>;

/**
 * Adds an avatar, or saves one: only the fields given are written, so a tool that names two fields leaves the rest. Saving an
 * imported one clears its "please review". Primary moves: one per member. Returns an error in words instead of throwing for
 * what the member can fix.
 */
export async function saveAvatar(m: Member, id: string | null, input: AvatarInput): Promise<{ avatar: Avatar } | { error: string; field?: string }> {
  const rows = await db.query.avatars.findMany({ where: mine(m) });
  const before = id ? rows.find((a) => a.id === id) : undefined;
  if (id && !before) return { error: "That avatar isn't yours or isn't there any more." };
  const name = input.name === undefined ? before?.name : input.name.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the avatar a name.", field: "name" };
  if (name.length > 80) return { error: "Keep the name under 80 characters.", field: "name" };
  if (input.parentId !== undefined) {
    const p = parentProblem(rows, id, input.parentId || null);
    if (p) return { error: p, field: "parentId" };
  }
  const fields: Partial<Record<AvatarField, string | null>> = {};
  // A textarea sends its line breaks as \r\n: kept as \n, so a drafter's list and the page read them the same.
  for (const f of AVATAR_FIELDS) if (input[f] !== undefined) fields[f] = input[f]?.replace(/\r\n?/g, "\n").trim() || null;
  const values = {
    name,
    ...(input.oneLine !== undefined ? { oneLine: input.oneLine?.trim() || null } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
    ...(input.primary !== undefined ? { primary: input.primary } : {}),
    ...fields,
  };
  const saved = before ? before.id : newId();
  if (before) await db.update(schema.avatars).set({ ...values, imported: false, updatedAt: nowIso() }).where(and(mine(m), eq(schema.avatars.id, saved)));
  else await db.insert(schema.avatars).values({ id: saved, ...m, ...values, primary: input.primary ?? !rows.some((a) => a.primary && !a.archivedAt) });
  if (input.primary) await db.update(schema.avatars).set({ primary: false }).where(and(mine(m), ne(schema.avatars.id, saved)));
  return { avatar: await own(m, saved) };
}

/** The Pathway's "Define Your Buyer Avatar": writes into the Primary, making one when there's none yet. */
export async function savePrimary(m: Member, input: AvatarInput) {
  const p = await db.query.avatars.findFirst({ where: and(mine(m), eq(schema.avatars.primary, true)) });
  return saveAvatar(m, p && !p.archivedAt ? p.id : null, { name: input.name || p?.name || "My buyer", ...input, primary: true });
}

/** A copy with every field and every offer link, never Primary, never a main, never imported. */
export async function duplicateAvatar(m: Member, id: string): Promise<Avatar> {
  const a = await own(m, id);
  const rows = await db.query.avatars.findMany({ where: mine(m), columns: { name: true } });
  const copy = newId();
  const fields = Object.fromEntries(AVATAR_FIELDS.map((f) => [f, a[f]]));
  await db.insert(schema.avatars).values({ id: copy, ...m, parentId: a.parentId, name: copyName(a.name, rows.map((r) => r.name)), oneLine: a.oneLine, ...fields });
  const links = await db.query.avatarOffers.findMany({ where: and(myLinks(m), eq(schema.avatarOffers.avatarId, id)) });
  if (links.length) await db.insert(schema.avatarOffers).values(links.map((l) => ({ id: newId(), ...m, avatarId: copy, offerId: l.offerId, main: false })));
  return own(m, copy);
}

/** Archive or bring back. An archived avatar stops being Primary and stops counting on its offers; its links stay. */
export async function archiveAvatar(m: Member, id: string, back = false): Promise<Avatar> {
  await own(m, id);
  await db.update(schema.avatars).set(back ? { archivedAt: null } : { archivedAt: nowIso(), primary: false }).where(and(mine(m), eq(schema.avatars.id, id)));
  return own(m, id);
}

/**
 * Links or unlinks an avatar and an offer, both the member's. `main` makes it the offer's main avatar (the one drafts write to),
 * taking it from any other. The first avatar linked to an offer is its main.
 */
export async function linkOffer(m: Member, avatarId: string, offerId: string, opts: { linked: boolean; main?: boolean }): Promise<{ avatar: Avatar; offer: { id: string; name: string }; main: boolean }> {
  const [avatar, offer] = await Promise.all([own(m, avatarId), ownOffer(m, offerId)]);
  const pair = and(myLinks(m), eq(schema.avatarOffers.avatarId, avatarId), eq(schema.avatarOffers.offerId, offerId));
  if (!opts.linked) {
    await db.delete(schema.avatarOffers).where(pair);
    return { avatar, offer, main: false };
  }
  const others = await db.query.avatarOffers.findMany({ where: and(myLinks(m), eq(schema.avatarOffers.offerId, offerId)) });
  const live = others.length ? await db.query.avatars.findMany({ where: and(mine(m), inArray(schema.avatars.id, others.map((o) => o.avatarId))), columns: { id: true, archivedAt: true } }) : [];
  const hasMain = others.some((o) => o.main && o.avatarId !== avatarId && live.some((a) => a.id === o.avatarId && !a.archivedAt));
  const main = opts.main ?? (others.find((o) => o.avatarId === avatarId)?.main || !hasMain);
  if (main) await db.update(schema.avatarOffers).set({ main: false }).where(and(myLinks(m), eq(schema.avatarOffers.offerId, offerId)));
  const at = others.find((o) => o.avatarId === avatarId);
  if (at) await db.update(schema.avatarOffers).set({ main }).where(pair);
  else await db.insert(schema.avatarOffers).values({ id: newId(), ...m, avatarId, offerId, main });
  return { avatar, offer, main };
}

/** The avatar a draft for this offer writes to (the offer's main, else the Primary), or null. */
export async function draftAvatar(m: Member, offerId: string | null | undefined): Promise<Avatar | null> {
  const [rows, links] = await Promise.all([db.query.avatars.findMany({ where: mine(m) }), db.query.avatarOffers.findMany({ where: myLinks(m) })]);
  const live = rows.filter((a) => !a.archivedAt);
  return (avatarForDraft(live, links, offerId) as Avatar | null) ?? null;
}

/** That avatar as the drafters read it, with its parent named; empty when there's none or nothing past its name is written. */
export async function draftAvatarBrief(m: Member, offerId: string | null | undefined): Promise<string> {
  const a = await draftAvatar(m, offerId);
  if (!a) return "";
  const parent = a.parentId ? await db.query.avatars.findFirst({ where: and(mine(m), eq(schema.avatars.id, a.parentId)) }) : null;
  return avatarBrief(a, parent);
}

/** An avatar by its exact name, or words only one live avatar's name contains; for the connector. */
export function byName(rows: Avatar[], words: string): Avatar {
  const w = words.trim().toLowerCase();
  const live = rows.filter((a) => !a.archivedAt);
  const exact = live.filter((a) => a.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const some = live.filter((a) => a.name.toLowerCase().includes(w));
  if (some.length === 1) return some[0];
  if (!some.length) throw new Error(`No avatar is called "${words}". The member's avatars: ${live.map((a) => a.name).join("; ") || "none yet"}.`);
  throw new Error(`"${words}" fits ${some.length} avatars: ${some.map((a) => a.name).join("; ")}. Say which.`);
}
