/**
 * Offers on the connector (H-184, plan H-220 PR D2): Claude reads the member's offers and writes a draft of one, or of a new
 * one, beside it, for the member to Approve, Edit or Discard on the offer's page. Drafts only: no tool approves a draft, makes
 * an offer live, sets a link or touches the bot's fields. Each connection reaches only its own member's offers; a team member's
 * connection reads and never drafts.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { siteUrl } from "@/lib/app-url";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { OFFER_FIELDS, cleanFields, readFields } from "@/lib/engine/claude-drafts";
import { areaFacts, pendingDrafts, redLinesFor, saveDraft, type Actor } from "@/lib/claude-drafts";

const owner = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });
const link = (id?: string | null) => `${siteUrl()}/offers${id ? `/${id}` : ""}`;
const NOT_FOUND = "No offer with that id in your HelixOS.";
const actor = (v: Viewer, call?: { agentId?: string | null }): Actor => ({ name: v.actor?.name ?? v.user.name, connector: true, agentId: call?.agentId ?? null });
const ownOffer = (v: Viewer, id: string) => db.query.offers.findFirst({ where: and(eq(schema.offers.id, id), eq(schema.offers.workspaceId, v.workspace.id), eq(schema.offers.userId, v.user.id)) });
const FIELD_NAMES = OFFER_FIELDS.map((f) => (f.kind === "choice" ? `${f.key} (${f.choices!.join(", ")})` : f.kind === "list" ? `${f.key} (3 to 5 steps)` : f.kind === "price" ? `${f.key} (a plain amount, only one the member said)` : f.key)).join(", ");

defineTool({
  name: "offers_list",
  scope: "offers",
  kind: "read",
  description: "The member's offers, newest first: id, name, status, container, price and currency, the promise, and whether Claude's draft of it is waiting for them.",
  input: { limit: z.number().int().min(1).max(50).optional().describe("How many, default 20") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, v.workspace.id), eq(schema.offers.userId, v.user.id)), orderBy: desc(schema.offers.createdAt), limit: Number(input.limit ?? 20) });
    const waiting = await pendingDrafts(owner(v), "offer");
    const offers = rows.map((o) => ({ id: o.id, name: o.name, status: o.status, container: o.container || null, price: o.price, currency: o.currency, promise: o.promise, draftWaiting: waiting.some((d) => d.targetId === o.id), link: link(o.id) }));
    const fresh = waiting.filter((d) => !d.targetId).length;
    if (!offers.length) return { text: `No offers yet.${fresh ? ` ${fresh} new offer draft${fresh === 1 ? "" : "s"} waiting.` : ""} offer_draft with no id drafts a new one.`, data: { offers, newDraftsWaiting: fresh } };
    return { text: `${offers.length} offer${offers.length === 1 ? "" : "s"}:\n${offers.map((o, i) => `${i + 1}. ${o.name} (${o.status})${o.draftWaiting ? ", Claude's draft waiting" : ""}`).join("\n")}${fresh ? `\n${fresh} new offer draft${fresh === 1 ? "" : "s"} waiting.` : ""}`, data: { offers, newDraftsWaiting: fresh } };
  },
});

defineTool({
  name: "offer_read",
  scope: "offers",
  kind: "read",
  description: "One of the member's offers: every field a draft can set, as it stands now, and Claude's draft waiting on it (its fields, who wrote it and when), if any.",
  input: { id: z.string().min(1).max(40).describe("The offer's id, from offers_list") },
  handler: async (v, input): Promise<ToolResult> => {
    const o = await ownOffer(v, String(input.id ?? ""));
    if (!o) return { text: NOT_FOUND };
    const [draft] = await pendingDrafts(owner(v), "offer", o.id);
    const fields = Object.fromEntries(OFFER_FIELDS.map((f) => [f.key, (o as Record<string, unknown>)[f.key] ?? null]));
    return { text: `${o.name} (${o.status}).${draft ? " Claude's draft is waiting on it." : ""}`, data: { id: o.id, status: o.status, fields, draft: draft ? { id: draft.id, fields: draft.fields, by: draft.byLabel, at: draft.createdAt } : null, link: link(o.id) } };
  },
});

defineTool({
  name: "offer_draft",
  scope: "offers",
  kind: "write",
  description:
    `Writes Claude's draft of one of the member's offers (give its id), or of a new offer (leave id out; name is then needed). The offer doesn't change until the member taps Approve on its page; a new offer is only made then, as a draft offer. Fields (exactly these names; any other is refused): ${FIELD_NAMES}. ` +
    "No income claims and no figures the member didn't give: a sentence with a number that isn't in their offers or source_words is taken out, and a price that isn't in their facts shows in red until they check it. A newer draft of an offer replaces the older one.",
  input: {
    id: z.string().max(40).optional().describe("The offer's id; leave out for a new offer"),
    fields: z.record(z.string(), z.unknown()).describe("The offer's fields, by the names above"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from; a figure may appear only if it is here or in their offers"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    if (v.team) throw new Error("A team member's connection reads offers and never drafts them. The account owner can, on their own connection.");
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : null;
    const offer = id ? await ownOffer(v, id) : null;
    if (id && !offer) return { text: NOT_FOUND };
    const read = readFields("offer", input.fields);
    if (read.refused.length || read.problems.length) {
      const parts = [read.refused.length ? `an offer doesn't take ${read.refused.join(", ")}` : "", ...read.problems].filter(Boolean);
      return { text: `Nothing was saved: ${parts.join("; ")}.`, data: { saved: false, refused: read.refused, problems: read.problems } };
    }
    if (!id && !read.fields.name) return { text: "Nothing was saved: a new offer needs its name.", data: { saved: false } };
    const known = `${await areaFacts(owner(v), "offer")}\n${String(input.source_words ?? "")}`;
    const cleaned = cleanFields("offer", read.fields, known);
    const notes = cleaned.removed.map((s) => `Taken out (a claim or a figure you didn't give): "${s}"`);
    if (!Object.keys(cleaned.fields).length || (!id && !cleaned.fields.name)) return { text: `Nothing was saved: nothing usable was left.${notes.length ? `\n${notes.join("\n")}` : ""}`, data: { saved: false, notes } };
    // The member's own words go with the draft: a price they said counts as theirs when the red lines are read.
    const draftId = await saveDraft(owner(v), "offer", id, cleaned.fields, notes, actor(v, call), String(input.source_words ?? ""));
    const [d] = await pendingDrafts(owner(v), "offer", id);
    const red = d && d.id === draftId ? await redLinesFor(owner(v), d) : [];
    const what = offer ? `beside "${offer.name}"` : `of a new offer, "${String(cleaned.fields.name)}"`;
    return {
      text: `Saved Claude's draft ${what}. It waits for the member's Approve, Edit or Discard on ${offer ? "the offer's page" : "Offers"}; nothing has changed.${red.length ? ` Shown in red until they check it: ${red.join(" ")}` : ""}${cleaned.removed.length ? ` ${cleaned.removed.length} sentence${cleaned.removed.length === 1 ? "" : "s"} taken out (a claim or a figure they didn't give).` : ""}`,
      data: { saved: true, draftId, fields: cleaned.fields, notes, red, link: link(id) },
    };
  },
});
