/**
 * The Evolve Omega pass on the server (H-622): the coach's own program (a leaderboard feed row on a coach's membership in the
 * workspace, with its sealed eLoyalty key and its template), and creating one member's pass on it. Creating a pass is a
 * write to eLoyalty: it happens only on the member's own press of "Get my pass", once per member, and for clients only after
 * the coach has switched "Issue passes" on. Logs carry outcomes and statuses only, never a key, a name or an id.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { address, parseCreatedPass } from "@/lib/engine/eloyalty";
import { type PassProgram, passNames, safePassUrl } from "@/lib/engine/eo-pass";
import { statusWords } from "@/lib/leaderboard";
import { postJson } from "@/lib/points-outbox";

/** The coach's own program in this workspace: the feed on a coach's membership that has a key and a template. */
export async function ownProgram(workspaceId: string): Promise<schema.LeaderboardFeed | null> {
  const coaches = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "coach")) });
  if (!coaches.length) return null;
  const feeds = await db.query.leaderboardFeeds.findMany({ where: inArray(schema.leaderboardFeeds.membershipId, coaches.map((c) => c.id)) });
  return feeds.find((f) => f.keyEncrypted && f.templateId) ?? null;
}

/** The program as the Rewards card needs it: ready means connected, checked and with a template. */
export const programState = (f: schema.LeaderboardFeed | null): PassProgram => (f ? { ready: Boolean(f.keyEncrypted && f.templateId && f.lastCheckOk), issuePasses: f.issuePasses } : null);

/**
 * Create this member's pass on the coach's own program, once. Returns what to tell them, in words. The answer's customer id,
 * serial and Pass Type ID are stored on the membership (the points and push address), with the add-to-wallet link.
 */
export async function createMemberPass(m: schema.Membership, user: { name: string; email: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  if (m.eoCustomerId) return { ok: true };
  const feed = await ownProgram(m.workspaceId);
  const program = programState(feed);
  if (!feed || !program?.ready) return { ok: false, why: "The Evolve Omega program is not ready yet." };
  if (m.role !== "coach" && !program.issuePasses) return { ok: false, why: "Passes are not open to members yet." };
  const key = open(feed.keyEncrypted);
  if (!key) return { ok: false, why: "The Evolve Omega program is not ready yet." };
  const { firstName, lastName } = passNames(user.name);
  const a = address("createPass", {}, { templateId: feed.templateId ?? "", email: user.email, firstName, lastName, externalId: m.id });
  if (!a.ok) return { ok: false, why: "The Evolve Omega program is not ready yet." };
  const r = await postJson(feed.host, key, a.path, a.body);
  if (r.status < 200 || r.status >= 300) {
    console.log(`[eo-pass] create answered ${r.status}`);
    return { ok: false, why: `Your pass could not be made just now (${statusWords(r.status)}). Try again in a minute.` };
  }
  const parsed = parseCreatedPass(r.json);
  if (!parsed.ok) {
    console.log("[eo-pass] create answered 2xx without the ids a pass needs");
    return { ok: false, why: "Your pass came back incomplete, so it was not kept. Your coach has been told in the log." };
  }
  const res = await db
    .update(schema.memberships)
    .set({ eoCustomerId: parsed.pass.customerId, eoPassSerial: parsed.pass.serial, eoPassTypeId: parsed.pass.passTypeId, eoPassUrl: safePassUrl(parsed.pass.downloadUrl) })
    .where(and(eq(schema.memberships.id, m.id), isNull(schema.memberships.eoCustomerId)));
  if ((res.rowsAffected ?? 0) === 0) console.log("[eo-pass] a second pass was created for a member who already had one: look in eLoyalty");
  console.log(`[eo-pass] pass created (${safePassUrl(parsed.pass.downloadUrl) ? "with" : "without"} a wallet link)`);
  return { ok: true };
}
