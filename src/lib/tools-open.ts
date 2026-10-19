/**
 * Tools open as a client reaches them (H-164 §12, plan H-209): the highest My Helix phase a member has reached opens the menu's
 * pages up to it, and it only ever rises, so a page never closes again. Read from My Helix after Today shows (never in the way
 * of the page) and on My Helix itself; the share of rungs done goes on the progress line under the logo.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { helixFor, type Helix } from "@/lib/my-helix";
import { toolsOpenedAt, type NavItem } from "@/components/nav-groups";

type Member = { workspace: { id: string }; user: { id: string }; membership: { id: string; helixPaused: boolean; helixSeen: string[]; toolsPhase: number; helixPct: number } };

/** The phase a member is working in: the next rung's, or the last phase once every rung is built. */
export const phaseReached = (h: Pick<Helix, "next" | "phases">): number => h.next?.phase ?? Math.max(0, h.phases.length - 1);

/** Store what My Helix says: the phase reached (never lowered) and the share done. A member's own row only. */
export async function syncTools(m: Member, h: Pick<Helix, "next" | "phases" | "pct">): Promise<void> {
  const phase = Math.max(m.membership.toolsPhase, phaseReached(h));
  if (phase === m.membership.toolsPhase && h.pct === m.membership.helixPct) return;
  await db.update(schema.memberships).set({ toolsPhase: phase, helixPct: h.pct }).where(eq(schema.memberships.id, m.membership.id));
}

/** Read My Helix and store it: after Today has shown, so the page never waits on it. */
export async function refreshTools(m: Member): Promise<void> {
  await syncTools(m, await helixFor(m));
}

/** The pages opened since Today last said so, for "New: Offers is open" (none with Show all tools on, where nothing was shut). */
export function newlyOpen(m: { toolsPhase: number; toolsAnnounced: number; showAllTools: boolean }): NavItem[] {
  if (m.showAllTools || m.toolsPhase <= m.toolsAnnounced) return [];
  const out: NavItem[] = [];
  for (let p = m.toolsAnnounced + 1; p <= m.toolsPhase; p++) out.push(...toolsOpenedAt(p));
  return out;
}

/** Each opening is announced once. */
export async function markAnnounced(membershipId: string, phase: number): Promise<void> {
  await db.update(schema.memberships).set({ toolsAnnounced: phase }).where(eq(schema.memberships.id, membershipId));
}
