/**
 * The Stage 1 push to a client's own Community Loyalty (uChat) workspace: HelixOS writes values into the template's existing
 * bot field names, one call per client, addressed by name (PUT /flow/set-bot-fields-by-name). One-way: the only read is the
 * read-back of what was just sent. The push is a named subset (STAGE1_FIELDS) and asserts it touches none of
 * BOT_WRITTEN_FIELDS before it sends, so a re-push after an unrelated edit leaves the calendar the client chose and the
 * appointment the agent booked exactly as they were.
 *
 * Request shape from the published UChat OpenAPI document (code-addendum-uchat-spec.md): `{ "data": [{ name, value }] }` with
 * `Authorization: Bearer <token>`, a 200 of `{ "status": "ok" }` with no per-field result. So a 200 is not a match: after it,
 * GET /flow/bot-fields is read, page by page at an explicit limit until a page comes back short, and compared; the push is
 * recorded only when every sent value reads back. The read-back's shape is the spec's BotFieldResource (`{ data: [BotField] }`,
 * each with name, var_type and a string value), parsed and nothing else. Comparison is exact: a typed field the bot normalises
 * ("01" to "1") fails the match on the safe side until the live call says how it behaves. Partial failure and the host are
 * Danno's call to run. Tokens are sealed at rest and decrypted for the request.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { BOT_WRITTEN_FIELDS, READ_BACK_LIMIT, STAGE1_FIELDS, assertStorable, botFieldsRequest, morePages, parseBotFields, readBackMismatches, samePayload, stage1Payload, stage1Problems, type BotFieldPayload } from "@/lib/engine/bot-fields";
import { redactSecrets } from "@/lib/engine/redact";
import { logSync } from "@/lib/integrations";

const DEFAULT_BASE = "https://www.uchat.com.au/api";
export function uchatBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.UCHAT_BASE_URL ? process.env.UCHAT_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export type PushOutcome = { status: "sent" | "skipped" | "failed"; note: string; fields: string[] };

/** The Stage 1 payload for one member, read off the record: the membership, the workspace, the member's zone and their live offers. */
export async function payloadFor(membership: schema.Membership): Promise<BotFieldPayload> {
  const [workspace, offers] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, membership.workspaceId), eq(schema.offers.userId, membership.userId)) }),
  ]);
  // The member's own zone, else the workspace's: the same rule Today and the reminders follow.
  return stage1Payload({ businessName: membership.businessName, workspaceName: workspace?.name ?? "", timezone: membership.timezone ?? workspace?.timezone ?? "UTC", offers });
}

/**
 * Push one member's Stage 1 fields. `force` re-sends even when nothing changed (the coach's Re-sync, which wins back fields the
 * bot's own SETUP wizard overwrote); otherwise an unchanged payload is not sent. Never throws.
 */
export async function pushBotFields(membershipId: string, opts: { force?: boolean; reason: string }): Promise<PushOutcome> {
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  if (!m) return { status: "skipped", note: "No such member.", fields: [] };
  const log = async (status: PushOutcome["status"], note: string, fields: string[]) => {
    // The sync log carries the names and the reason, never a value: values are on the membership row, the token nowhere.
    await logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "community_loyalty", direction: "out", event: "botfields.push", payload: { reason: opts.reason, fields }, status, note: redactSecrets(note) });
    return { status, note, fields };
  };
  const token = open(m.clApiToken);
  if (!token) return log("skipped", "No Community Loyalty API token on this client.", []);
  const payload = await payloadFor(m);
  const names = Object.keys(payload);
  for (const n of names) if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(n) || !(STAGE1_FIELDS as readonly string[]).includes(n)) return log("failed", `Refused: ${n} is not a Stage 1 field.`, names);
  // The drip webhook is never opened here: its shape (/api/iwh/) is refused by assertStorable without the value in hand.
  assertStorable(payload, [token]);
  const problems = stage1Problems(payload);
  if (problems.length) return log("failed", problems.join(" "), names);
  if (!opts.force && samePayload(m.clBotFields, payload)) return log("skipped", "Nothing changed since the last push.", names);
  try {
    const headers = { "content-type": "application/json", accept: "application/json", Authorization: `Bearer ${token}` };
    const withTimeout = async (input: string, init: RequestInit) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        return await fetch(input, { ...init, signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    };
    const res = await withTimeout(`${uchatBase()}/flow/set-bot-fields-by-name`, { method: "PUT", headers, body: JSON.stringify(botFieldsRequest(payload)) });
    const text = (await res.text()).slice(0, 200);
    if (!res.ok) return log("failed", `${res.status} ${text}`.trim(), names);
    // Read back: a 200 says the call was accepted, not that the fields were written. The record moves only on a match.
    const held: Record<string, string | undefined> = {};
    for (let page = 1; page <= 100; page++) {
      const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers });
      if (!back.ok) return log("failed", `Pushed, but the read-back answered ${back.status} on page ${page}: not recorded as synced.`, names);
      const rows = parseBotFields(await back.json());
      for (const r of rows) held[r.name] = r.value;
      if (!morePages(rows.length, READ_BACK_LIMIT)) break;
    }
    const mismatched = readBackMismatches(payload, held);
    if (mismatched.length) return log("failed", `Pushed, but the read-back differs on ${mismatched.join(", ")}: not recorded as synced.`, names);
    await db.update(schema.memberships).set({ clBotFields: payload, clBotFieldsPushedAt: nowIso() }).where(eq(schema.memberships.id, m.id));
    return log("sent", `${names.length} fields pushed and read back`, names);
  } catch (e) {
    return log("failed", e instanceof Error ? e.message : String(e), names);
  }
}

/** A Stage 1 source changed for one member: re-push if the payload differs. Quiet when the member has no token. */
export async function repushForMember(workspaceId: string, userId: string, reason: string): Promise<void> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) });
  if (m?.clApiToken) await pushBotFields(m.id, { reason });
}

/** A workspace-wide source changed (its timezone): every member with a token is re-pushed. */
export async function repushWorkspace(workspaceId: string, reason: string): Promise<void> {
  const members = await db.query.memberships.findMany({ where: eq(schema.memberships.workspaceId, workspaceId) });
  for (const m of members) if (m.clApiToken) await pushBotFields(m.id, { reason });
}
