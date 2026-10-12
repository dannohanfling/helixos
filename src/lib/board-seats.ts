/**
 * My Board's seat library and councils (rev 756, Danno's answers at rev 766), the database side. The library is the coach
 * workspace's own, seeded the first time it's read: the 62 approved expert seats word for word from the library file and the four
 * archetypes from board-profile.md, each added once by slug and never overwritten (an edit of the coach's is theirs to keep).
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BoardSeat } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { BOARD_PROFILE_MD } from "@/content/board-spec";
import { BOARD_SEAT_LIBRARY_MD } from "@/content/board-seat-library";
import { EDGE_SEATS, SEATS, type Seat } from "@/lib/engine/board";
import { DEFAULT_COUNCIL, effectiveCouncil, parseArchetypes, parseSeatLibrary, personKey, profileBlock, type CouncilChair, type CouncilRow, type LibrarySeat } from "@/lib/engine/board-seats";

let seeded = new Set<string>();
const LIBRARY: LibrarySeat[] = [...parseArchetypes(BOARD_PROFILE_MD), ...parseSeatLibrary(BOARD_SEAT_LIBRARY_MD)];
/** The Edge Preset's three style advisors now use their library profiles (rev 756 §4). */
export const EDGE_LIBRARY: Record<string, string> = { tony: "tony-robbins", dean: "dean-graziosi", igor: "igor-pogany" };

/** The library in the workspace, seeded on first read: every approved seat once, by slug. */
export async function ensureSeatLibrary(workspaceId: string): Promise<void> {
  if (seeded.has(workspaceId)) return;
  const have = new Set((await db.select({ slug: schema.boardSeats.slug }).from(schema.boardSeats).where(eq(schema.boardSeats.workspaceId, workspaceId))).map((r) => r.slug));
  const missing = LIBRARY.filter((s) => !have.has(s.slug));
  if (missing.length)
    await db
      .insert(schema.boardSeats)
      .values(missing.map((s) => ({ id: newId(), workspaceId, slug: s.slug, name: s.name, kind: s.kind, areas: s.areas, card: s.card, profile: s.profile, isOperator: s.operator })))
      .onConflictDoNothing();
  seeded.add(workspaceId);
}
/** For tests and the walks: forget which workspaces were seeded in this process. */
export const forgetSeeded = () => (seeded = new Set());

/** Every seat in the workspace's library a viewer may see: the library, and their own custom seats (a coach sees all). */
export async function librarySeats(workspaceId: string, opts: { userId?: string; coach?: boolean } = {}): Promise<BoardSeat[]> {
  await ensureSeatLibrary(workspaceId);
  const own = opts.coach ? undefined : or(isNull(schema.boardSeats.userId), eq(schema.boardSeats.userId, opts.userId ?? "-"));
  return db.query.boardSeats.findMany({ where: and(eq(schema.boardSeats.workspaceId, workspaceId), own), orderBy: schema.boardSeats.name });
}

const rowOf = (r: BoardSeat): CouncilRow => ({ id: r.id, slug: r.slug, name: r.name, kind: r.kind, areas: r.areas, card: r.card, isOperator: r.isOperator, enabled: r.enabled, version: r.version, profile: r.profile, sourcesGiven: r.kind !== "custom" || !r.realPerson || r.profile.sources.length > 0 });

/** A chair's seat as the engine and the room use it. */
function seatOf(c: CouncilChair): Seat {
  const archetype = SEATS.find((s) => s.key === c.slug);
  // An archetype the coach has edited (version 2 on) answers from its edited profile; untouched, from the spec word for word.
  if (archetype) return { ...archetype, id: c.id, version: c.version, paused: c.paused || undefined, ...(c.version > 1 ? { profile: profileBlock({ name: c.name, kind: c.kind, profile: c.profile, operator: c.isOperator }) } : {}) };
  return {
    key: c.slug,
    name: c.name,
    short: c.name,
    role: c.isOperator ? "OPERATOR" : (c.areas[0] ?? "Custom seat").toUpperCase(),
    emoji: "",
    icon: null,
    job: c.card,
    kind: c.kind,
    operator: c.isOperator,
    id: c.id,
    version: c.version,
    retired: c.retired || undefined,
    profile: profileBlock({ name: c.name, kind: c.kind, profile: c.profile, operator: c.isOperator, myRead: c.myRead }),
  };
}

/** The four chairs for a member: their picks (or the archetypes), with the switch's pauses applied. */
export async function councilChairs(workspaceId: string, picked: string[] | null, live: boolean): Promise<CouncilChair[]> {
  const rows = await librarySeats(workspaceId, { coach: true });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const archetypes = rows.filter((r) => r.kind === "archetype").map(rowOf);
  const chosen = [0, 1, 2, 3].map((i) => {
    const r = picked?.[i] ? byId.get(picked[i]) : undefined;
    return r ? rowOf(r) : (archetypes.find((a) => a.slug === DEFAULT_COUNCIL[i]) ?? null);
  });
  return effectiveCouncil(chosen, live, archetypes);
}

/**
 * The five seats a viewer's Board sits with, in speaking order: Danno, then the four chairs. The coach's own Board on the Edge
 * Preset keeps its five, with Tony, Dean and Igor from the library. A coach's own expert picks never pause: the coach always
 * sees everything.
 */
export async function councilFor(v: Viewer): Promise<Seat[]> {
  const preset = v.role === "coach" && !v.switchedInto && v.membership.boardPreset === "edge" ? "edge" : "standard";
  if (preset === "edge") {
    const rows = await librarySeats(v.workspace.id, { coach: true });
    return EDGE_SEATS.map((s) => {
      const r = rows.find((x) => x.slug === EDGE_LIBRARY[s.key]);
      if (!r) return { ...s, kind: "edge" };
      return { ...s, key: s.key, name: r.name, short: r.name, kind: "edge", id: r.id, version: r.version, profile: profileBlock({ name: r.name, kind: r.kind, profile: r.profile, operator: false }) };
    });
  }
  const live = v.role === "coach" || v.workspace.expertSeatsLive;
  const chairs = await councilChairs(v.workspace.id, v.membership.boardCouncil ?? null, live);
  return [SEATS[0], ...chairs.map(seatOf)];
}

/** How many members sit with each seat, for the coach's list. */
export async function seatUse(workspaceId: string): Promise<Map<string, number>> {
  const ms = await db.query.memberships.findMany({ where: eq(schema.memberships.workspaceId, workspaceId), columns: { boardCouncil: true } });
  const n = new Map<string, number>();
  for (const m of ms) for (const id of m.boardCouncil ?? []) n.set(id, (n.get(id) ?? 0) + 1);
  return n;
}

/** One seat as the member's picker shows it (rev 756 §2): what the card and the detail need, never an Edge-preset source. */
export type PickerSeat = {
  id: string;
  slug: string;
  person: string;
  name: string;
  kind: "expert" | "archetype" | "custom";
  areas: string[];
  card: string;
  operator: boolean;
  /** Shown in the library (on, and open to this member); a chair can still hold a paused or retired pick that isn't. */
  listed: boolean;
  paused: boolean;
  retired: boolean;
  myRead: boolean;
  realPerson: boolean;
  purpose: string;
  questions: string[];
  frameworks: { name: string; text: string }[];
  sources: { label: string; url: string | null }[];
  voice: string;
};

/**
 * The picker's seats for a member: the library they may choose from (every archetype, the expert seats while "Expert seats
 * live" is on, or always for the coach, and their own custom seats), plus whatever their chairs already hold that isn't
 * listed (a paused or retired pick), and their four chairs in order.
 */
export async function pickerFor(v: Viewer): Promise<{ seats: PickerSeat[]; chairs: string[]; live: boolean; chose: boolean }> {
  const live = v.role === "coach" || v.workspace.expertSeatsLive;
  const rows = await librarySeats(v.workspace.id, { userId: v.user.id });
  const archetypes = rows.filter((r) => r.kind === "archetype");
  const picked = v.membership.boardCouncil ?? null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chairs = [0, 1, 2, 3].map((i) => (picked?.[i] && byId.has(picked[i]) ? picked[i] : (archetypes.find((a) => a.slug === DEFAULT_COUNCIL[i])?.id ?? "")));
  const seats = rows
    .map((r): PickerSeat => {
      const listed = r.enabled && (r.kind !== "expert" || live);
      return {
        id: r.id,
        slug: r.slug,
        person: personKey(r),
        name: r.name,
        kind: r.kind,
        areas: r.areas,
        card: r.card,
        operator: r.isOperator,
        listed,
        paused: r.kind === "expert" && !live,
        retired: !r.enabled,
        myRead: r.kind === "custom" && r.realPerson && !r.profile.sources.length,
        realPerson: r.kind === "expert" || r.realPerson,
        purpose: r.profile.purpose,
        questions: r.profile.questions,
        frameworks: r.profile.frameworks.map((f) => ({ name: f.name, text: f.text })),
        sources: r.profile.sources,
        voice: r.kind === "custom" ? r.profile.voice : "",
      };
    })
    .filter((s) => s.listed || chairs.includes(s.id));
  return { seats, chairs, live, chose: Boolean(picked) };
}

/** A member's own custom seats. */
export async function customSeatsOf(workspaceId: string, userId: string): Promise<BoardSeat[]> {
  return db.query.boardSeats.findMany({ where: and(eq(schema.boardSeats.workspaceId, workspaceId), eq(schema.boardSeats.userId, userId), eq(schema.boardSeats.kind, "custom")), orderBy: schema.boardSeats.createdAt });
}
