/**
 * Fix my pass on the server (H-1699, plan H-1701 approved in H-1702): rewrite the name on one member's existing pass from
 * HelixOS, with the coach's own program key, field by field (First_Name, then Last_Name). Nothing else is written; Points
 * never. Logs carry the outcome and statuses only, never a name, key, serial or id.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { address } from "@/lib/engine/eloyalty";
import { type FixOutcome, fixFields, fixOutcome } from "@/lib/engine/pass-fix";
import { recordRateLimit } from "@/lib/loyalty-rate";
import { putField } from "@/lib/points-sync";

const ready = (f: schema.LeaderboardFeed) => Boolean(f.keyEncrypted && f.templateId && f.lastCheckOk);

/** Write the member's HelixOS name onto their pass. Stops at the first refusal or 429; clears the "needs fixing" flag on success. */
export async function fixPassName(feed: schema.LeaderboardFeed, m: Pick<schema.Membership, "id" | "eoPassSerial" | "eoPassTypeId">, fullName: string): Promise<FixOutcome> {
  if (!ready(feed) || (feed.refreshAfter && Date.parse(feed.refreshAfter) > Date.now())) return ready(feed) ? "busy" : "notready";
  const key = open(feed.keyEncrypted);
  if (!key) return "notready";
  const pass = { serial: m.eoPassSerial ?? null, passTypeId: m.eoPassTypeId ?? null };
  const statuses: number[] = [];
  for (const f of fixFields(fullName)) {
    const a = address("passField", pass, { field: f.field, value: f.value });
    if (!a.ok) return "nopass";
    const status = await putField(feed.host, key, a.path, a.body);
    statuses.push(status);
    if (status < 200 || status >= 300) break;
  }
  const outcome = fixOutcome(statuses);
  if (outcome === "busy") await recordRateLimit(feed.id);
  if (outcome === "updated") await db.update(schema.memberships).set({ eoNameNeedsFix: false }).where(eq(schema.memberships.id, m.id));
  console.log(`[pass-fix] ${outcome} (statuses ${statuses.join(",") || "none"})`);
  return outcome;
}
