/**
 * Moving a program's members to its new pass on the server (H-1859, plan H-1861 approved in H-1868). The coach makes a
 * member's private link by their email; the member opens it and presses Get my new pass: their pass is made once on the
 * feed's second template (templateIdAlt), their old level is written on it before they add it, and their old balance is
 * carried with one outbox add. Nothing is ever sent to the old pass from here. Logs carry outcomes and counts only: never a
 * key, a name, an email, a token or an id.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { address, parseCreatedPass } from "@/lib/engine/eloyalty";
import { safePassUrl } from "@/lib/engine/eo-pass";
import { type MoveCounts, type SwitchCode, isStuck, moveCounts, readOldMember, sameEmail } from "@/lib/engine/pass-move";
import { customers, getJson } from "@/lib/leaderboard";
import { recordRateLimit } from "@/lib/loyalty-rate";
import { drainFeed, postJson, queueMove } from "@/lib/points-outbox";
import { putField } from "@/lib/points-sync";

/** Ready for a move: key, a passed connection check, a passed points check (adds proven on this program) and the new template. */
export const moveReady = (f: schema.LeaderboardFeed) => Boolean(f.keyEncrypted && f.lastCheckOk && f.deskCheckOk && f.templateIdAlt?.trim());
const busyNow = (f: schema.LeaderboardFeed) => Boolean(f.refreshAfter && Date.parse(f.refreshAfter) > Date.now());

/** The private link's path for a switch row. */
export const switchPath = (token: string) => `/pass/new/${token}`;

/**
 * Make (or find) the private link for the member on the old template with this email. Reads the old template's members
 * (GET only) to find them; stores only their id on the service. Returns the token, or a code for the coach's words.
 */
export async function makeSwitchLink(feed: schema.LeaderboardFeed, email: string, byUserId: string): Promise<{ ok: true; token: string } | { ok: false; code: "notready" | "nomember" | "busy" | "noanswer" }> {
  if (!moveReady(feed)) return { ok: false, code: "notready" };
  if (busyNow(feed)) return { ok: false, code: "busy" };
  const key = open(feed.keyEncrypted);
  if (!key) return { ok: false, code: "notready" };
  const got = await customers(feed.host, key, { templateId: feed.templateId, templateIdAlt: null });
  if (!got.ok) {
    if (got.status === 429) await recordRateLimit(feed.id);
    return { ok: false, code: got.status === 429 ? "busy" : "noanswer" };
  }
  const member = got.list.find((c) => sameEmail(email, c.email));
  const customerId = member && typeof member.id === "string" ? member.id : "";
  if (!customerId) return { ok: false, code: "nomember" };
  await db
    .insert(schema.passSwitches)
    .values({ id: newId(), feedId: feed.id, workspaceId: feed.workspaceId, token: randomBytes(24).toString("base64url"), fromCustomerId: customerId, byUserId })
    .onConflictDoNothing();
  const row = await db.query.passSwitches.findFirst({ where: and(eq(schema.passSwitches.feedId, feed.id), eq(schema.passSwitches.fromCustomerId, customerId)) });
  console.log("[pass-move] link ready");
  return { ok: true, token: row!.token };
}

/** The switch row and its program for a link, or null when the token is unknown. */
export async function switchByToken(token: string): Promise<{ row: schema.PassSwitch; feed: schema.LeaderboardFeed } | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const row = await db.query.passSwitches.findFirst({ where: eq(schema.passSwitches.token, token) });
  if (!row) return null;
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, row.feedId) });
  return feed ? { row, feed } : null;
}

/**
 * The member's press: make their new pass once, write their old level on it, and carry their old balance with one add.
 * Pressing again (or two presses at once) never makes a second pass or a second add.
 */
export async function makeNewPass(token: string): Promise<SwitchCode> {
  const found = await switchByToken(token);
  if (!found) return "invalid";
  const { row, feed } = found;
  if (row.status === "made") return "made";
  if (!moveReady(feed)) return "notready";
  if (busyNow(feed)) return "busy";
  const key = open(feed.keyEncrypted);
  if (!key) return "notready";
  // Claim the make: only one press moves the row from link (or a make that died) to making.
  const claimFrom = row.status === "making" && isStuck(row.updatedAt) ? "making" : "link";
  const claimed = await db
    .update(schema.passSwitches)
    .set({ status: "making", updatedAt: nowIso() })
    .where(and(eq(schema.passSwitches.id, row.id), eq(schema.passSwitches.status, claimFrom)));
  if ((claimed.rowsAffected ?? 0) === 0) return "making";
  const release = async (code: SwitchCode, note: string) => {
    await db.update(schema.passSwitches).set({ status: "link", lastNote: note, updatedAt: nowIso() }).where(eq(schema.passSwitches.id, row.id));
    console.log(`[pass-move] not made: ${note}`);
    return code;
  };

  const c = address("customer", { customerId: row.fromCustomerId });
  if (!c.ok) return release("refused", "no old member id");
  const old = await getJson(feed.host, key, c.path);
  if (old.status === 429) {
    await recordRateLimit(feed.id);
    return release("busy", "429 reading the old member");
  }
  if (old.status < 200 || old.status >= 300) return release(old.status === 0 ? "noanswer" : "refused", `${old.status || "no answer"} reading the old member`);
  const m = readOldMember(old.json, row.fromCustomerId);
  if (!m.email) return release("noemail", "the old member has no email");

  const a = address("createPass", {}, { templateId: feed.templateIdAlt ?? "", email: m.email, firstName: m.firstName, lastName: m.lastName, externalId: m.memberId });
  if (!a.ok) return release("notready", "no new template");
  const r = await postJson(feed.host, key, a.path, a.body);
  if (r.status === 429) {
    await recordRateLimit(feed.id);
    return release("busy", "429 making the pass");
  }
  if (r.status < 200 || r.status >= 300) return release(r.status === 0 ? "noanswer" : "refused", `${r.status || "no answer"} making the pass`);
  const made = parseCreatedPass(r.json);
  if (!made.ok) return release("refused", "the made pass came back without its ids");
  const p = made.pass;
  const carry = m.balance ?? 0;
  await db
    .update(schema.passSwitches)
    .set({ status: "made", toCustomerId: p.customerId, toSerial: p.serial, toPassTypeId: p.passTypeId, toPassUrl: safePassUrl(p.downloadUrl), carryPoints: carry, madeAt: nowIso(), lastNote: null, updatedAt: nowIso() })
    .where(eq(schema.passSwitches.id, row.id));

  // The old level goes on before the member adds the pass, so no installed pass is ever rewritten from here.
  if (m.level) {
    const lv = address("passField", { serial: p.serial, passTypeId: p.passTypeId }, { field: "Level", value: m.level });
    const status = lv.ok ? await putField(feed.host, key, lv.path, lv.body) : 0;
    console.log(`[pass-move] level written (${status})`);
  }
  // The carry: one add of the old available balance, through the outbox (one per switch, however often it is retried).
  if (carry > 0) {
    const move = await queueMove(feed, { customerId: p.customerId, delta: carry, reason: "Carried over from your previous pass", source: `switch:${row.id}`, byUserId: row.byUserId });
    await db.update(schema.passSwitches).set({ carryMoveId: move.id }).where(eq(schema.passSwitches.id, row.id));
    const fresh = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feed.id) });
    if (fresh) await drainFeed(fresh, new Date(), move.id);
  }
  console.log(`[pass-move] pass made (${carry > 0 ? "points carried by the outbox" : "nothing to carry"})`);
  return "made";
}

/** The counts on Coach for one program's move. */
export async function passMoveCounts(feedId: string): Promise<MoveCounts> {
  const rows = await db.query.passSwitches.findMany({ where: eq(schema.passSwitches.feedId, feedId), columns: { status: true, carryPoints: true, carryMoveId: true } });
  const ids = rows.map((r) => r.carryMoveId).filter((x): x is string => Boolean(x));
  const moves = ids.length ? await db.query.loyaltyPointsMoves.findMany({ where: inArray(schema.loyaltyPointsMoves.id, ids), columns: { id: true, status: true, newBalance: true } }) : [];
  return moveCounts(rows, new Map(moves.map((m) => [m.id, { status: m.status, newBalance: m.newBalance }])));
}
