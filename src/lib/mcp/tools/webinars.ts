/**
 * Webinar tools on the connector (H-181, plan H-684, PR 1): Claude reads the member's webinars, starts one, and writes its draft
 * of a step beside the webinar for the member to Approve, Edit or Discard in the wizard. Drafts only: no tool approves a step,
 * sets a date or status, touches a link, a number or the registration page, turns on hosting, sends to leads or starts Run it.
 * Each connection reaches only its own member's webinars; a team member's connection reads and never drafts.
 */
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { siteUrl } from "@/lib/app-url";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { createWebinar } from "@/lib/webinars-core";
import { buildFor } from "@/lib/queries/webinar";
import { subjectFor } from "@/lib/queries/subject";
import { STATUS_WORDS } from "@/lib/engine/teaching-kinds";
import { BELIEF_COLUMN, BELIEF_FIELDS, BELIEF_TYPES, DRAFTABLE_STEPS, FOUNDATION_FIELDS, cleanFields, readDraftFields, type DraftableStep } from "@/lib/engine/webinar-drafts";
import { checkCitations, noteCreated, ownWebinar, pendingDrafts, saveDraft, type Actor } from "@/lib/webinar-drafts";

const owner = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id, name: v.user.name });
const link = (id: string, step?: string) => `${siteUrl()}/webinars/${id}${step ? `?step=${step}` : ""}`;
const NOT_FOUND = "No webinar with that id in your HelixOS.";
const actor = (v: Viewer, call?: { agentId?: string | null }): Actor => ({ name: v.actor?.name ?? v.user.name, connector: true, agentId: call?.agentId ?? null });

function drafter(v: Viewer) {
  if (v.team) throw new Error("A team member's connection reads webinars and never drafts them. The account owner can, on their own connection.");
}

const progress = (w: schema.Webinar, beliefs: schema.WebinarBelief[], sections: schema.WebinarSection[]) => ({
  foundation: [w.audience, w.coreProblem, w.desiredResult, w.promise].filter(Boolean).length === 4 ? "filled" : [w.audience, w.coreProblem, w.desiredResult, w.promise].some(Boolean) ? "started" : "empty",
  beliefs: `${beliefs.filter((b) => b.fromBelief && b.toBelief).length} of 3 shifts`,
  script: `${sections.filter((s) => s.status === "final").length} final, ${sections.filter((s) => s.status === "drafted").length} drafted, ${sections.filter((s) => s.status === "todo").length} to write`,
  offer: w.offerId ? "linked" : "none",
});

defineTool({
  name: "webinars_list",
  scope: "webinars",
  kind: "read",
  description: "The member's webinars, newest first: id, title, status, date, each step's progress, the latest readiness verdict, and how many of Claude's drafts wait for them in the wizard.",
  input: { limit: z.number().int().min(1).max(30).optional().describe("How many, default 15") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.webinars.findMany({ where: and(eq(schema.webinars.workspaceId, v.workspace.id), eq(schema.webinars.userId, v.user.id)), orderBy: desc(schema.webinars.createdAt), limit: Number(input.limit ?? 15) });
    if (!rows.length) return { text: "No webinars yet. webinar_create starts one.", data: { webinars: [] } };
    const out = [];
    for (const w of rows) {
      const [beliefs, sections, review, drafts] = await Promise.all([
        db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
        db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id) }),
        db.query.readinessReviews.findFirst({ where: eq(schema.readinessReviews.webinarId, w.id), orderBy: desc(schema.readinessReviews.createdAt) }),
        pendingDrafts(w.id),
      ]);
      out.push({ id: w.id, title: w.title, status: w.status, example: w.isExample, date: w.scheduledAt, steps: progress(w, beliefs, sections), readiness: review?.verdict ?? "not rated yet", draftsWaiting: drafts.length, link: link(w.id) });
    }
    return { text: `${out.length} webinar${out.length === 1 ? "" : "s"}:\n${out.map((w, i) => `${i + 1}. ${w.title} (${w.status}${w.date ? `, ${w.date.slice(0, 10)}` : ""})${w.draftsWaiting ? `, ${w.draftsWaiting} draft${w.draftsWaiting === 1 ? "" : "s"} waiting` : ""}`).join("\n")}`, data: { webinars: out } };
  },
});

defineTool({
  name: "webinar_read",
  scope: "webinars",
  kind: "read",
  description: "One webinar in full, or one step of it (foundation, beliefs, script, offer): every field as it is now, Claude's drafts waiting beside it, and the readiness checks still open. Use the field names here with webinar_draft_step.",
  input: { id: z.string().min(1).max(40).describe("The webinar's id, from webinars_list"), step: z.enum(["foundation", "beliefs", "script", "offer"]).optional().describe("Optional: just this step") },
  handler: async (v, input): Promise<ToolResult> => {
    const w = await ownWebinar(owner(v), String(input.id ?? ""));
    if (!w) return { text: NOT_FOUND };
    const step = input.step as string | undefined;
    const want = (s: string) => !step || step === s;
    const [beliefs, sections, drafts] = await Promise.all([
      db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
      db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
      pendingDrafts(w.id),
    ]);
    const data: Record<string, unknown> = { id: w.id, title: w.title, status: w.status, date: w.scheduledAt, link: link(w.id) };
    if (want("foundation")) data.foundation = Object.fromEntries(FOUNDATION_FIELDS.map((k) => [k, (w as Record<string, unknown>)[k] ?? null]));
    if (want("beliefs")) data.beliefs = Object.fromEntries(BELIEF_TYPES.map((t) => { const b = beliefs.find((x) => x.type === t); return [t, Object.fromEntries(BELIEF_FIELDS.map((f) => [f, (b?.[BELIEF_COLUMN[f]] as string | null | undefined) ?? null]))]; }));
    if (want("script")) data.script = sections.map((s) => ({ sectionKey: s.sectionKey, name: s.name, act: s.act, status: s.status, keyPoints: s.keyPoints, script: s.script, transitionIn: s.transitionIn, transitionOut: s.transitionOut, deliveryNote: s.deliveryNote, durationMin: s.durationMin, buildStyle: s.buildStyle }));
    if (want("offer")) {
      const offer = w.offerId ? await db.query.offers.findFirst({ where: and(eq(schema.offers.id, w.offerId), eq(schema.offers.userId, v.user.id)) }) : null;
      data.offer = { offerId: w.offerId, offerName: offer?.name ?? null, ctaType: w.ctaType };
    }
    data.draftsWaiting = drafts.filter((d) => want(d.step)).map((d) => ({ id: d.id, step: d.step, fields: d.fields, notes: d.notes, written: d.createdAt }));
    if (!step) {
      const { build } = await buildFor(w);
      data.readiness = { must: build.must.map((c) => ({ check: c.label, detail: c.detail })), warnings: build.checks.filter((c) => !c.ok && c.level === "warn").map((c) => ({ check: c.label, detail: c.detail })) };
    }
    const waiting = (data.draftsWaiting as unknown[]).length;
    return { text: `${w.title} (${w.status})${step ? `, ${step}` : ""}.${waiting ? ` ${waiting} of Claude's drafts wait for approval in the wizard.` : ""}`, data };
  },
});

defineTool({
  name: "webinar_create",
  scope: "webinars:write",
  kind: "write",
  description: "Starts a new webinar for the member, as a draft with only its title (and its offer, if named). Then write each step with webinar_draft_step for them to approve in the wizard.",
  input: {
    title: z.string().min(2).max(200).describe("The working title"),
    offer_id: z.string().max(40).optional().describe("Optional: the offer it sells, one of the member's offers"),
    avatar_id: z.string().max(40).optional().describe("Optional: the avatar it's for; their details come back to draft the foundation's audience from"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v);
    const o = owner(v);
    const offerId = input.offer_id ? String(input.offer_id) : null;
    if (offerId && !(await db.query.offers.findFirst({ where: and(eq(schema.offers.id, offerId), eq(schema.offers.workspaceId, o.workspaceId), eq(schema.offers.userId, o.userId)) }))) return { text: "That offer isn't one of yours, so nothing was started. Leave offer_id out, or name one of their offers." };
    const avatar = input.avatar_id ? await db.query.avatars.findFirst({ where: and(eq(schema.avatars.id, String(input.avatar_id)), eq(schema.avatars.workspaceId, o.workspaceId), eq(schema.avatars.userId, o.userId)) }) : null;
    if (input.avatar_id && !avatar) return { text: "That avatar isn't one of yours, so nothing was started." };
    const id = await createWebinar(o, { title: String(input.title).trim(), offerId });
    await noteCreated(o, id, actor(v, call));
    return { text: `Started "${String(input.title).trim()}" as a draft. Nothing else is set; write the foundation next with webinar_draft_step.`, data: { id, status: "draft", offerId, avatar: avatar ? { id: avatar.id, name: avatar.name, oneLine: avatar.oneLine, who: avatar.who, pains: avatar.pains, wants: avatar.wants } : null, link: link(id, "foundation") } };
  },
});

defineTool({
  name: "webinar_draft_step",
  scope: "webinars:write",
  kind: "write",
  description:
    "Writes Claude's draft of one step beside the webinar; the webinar itself doesn't change until the member taps Approve in the wizard. Steps and their fields (exactly these names; any other is refused): " +
    "foundation: title, category (Live, Evergreen, JV / partner, Challenge), audience, coreProblem, desiredResult, promise, mechanismName, mechanismWaivedReason, presenter, stayLine, promiseLine, chatPrompt, groundRule, outcomes (up to 3 lines), sessionGoal, permissionLine, reflectionPrompt, footerBrand, originStory {wanted, outside, inside, wall, epiphany, plan, result, transformation}, ctaType. " +
    "beliefs: vehicle, internal and external, each {from, to, proofId, storyId, evidenceId}; cite proof and stories by id only (proof_list, story_bank_list). " +
    "offer: offerId (one of the member's offers), ctaType (Book a call, Buy now, Apply, Join the community, Start the trial). " +
    "No income claims and no figures the member didn't give: a sentence with a number that isn't in the offer or source_words is taken out. A proof or story that needs permission first is refused by name. A newer draft of a step replaces the older one.",
  input: {
    id: z.string().min(1).max(40).describe("The webinar's id"),
    step: z.enum(DRAFTABLE_STEPS).describe("foundation, beliefs or offer (script and deck come next)"),
    fields: z.record(z.string(), z.unknown()).describe("The step's fields, by the names above"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from; a figure may appear in the draft only if it is here or in the offer"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v);
    const o = owner(v);
    const w = await ownWebinar(o, String(input.id ?? ""));
    if (!w) return { text: NOT_FOUND };
    const step = input.step as DraftableStep;
    const read = readDraftFields(step, input.fields);
    if (read.refused.length || read.problems.length) {
      const parts = [read.refused.length ? `the ${step} step doesn't take ${read.refused.join(", ")}` : "", ...read.problems].filter(Boolean);
      return { text: `Nothing was saved: ${parts.join("; ")}.`, data: { saved: false, refused: read.refused, problems: read.problems } };
    }
    const offerId = (step === "offer" ? (read.fields.offerId as string | undefined) : null) ?? w.offerId;
    const offer = offerId ? await db.query.offers.findFirst({ where: and(eq(schema.offers.id, offerId), eq(schema.offers.userId, o.userId)) }) : null;
    const components = offer ? await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, offer.id) }) : [];
    const known = [JSON.stringify(offer ?? {}), JSON.stringify(components), String(input.source_words ?? ""), ...FOUNDATION_FIELDS.map((k) => JSON.stringify((w as Record<string, unknown>)[k] ?? ""))].join("\n");
    const cleaned = cleanFields(step, read.fields, known);
    const cited = await checkCitations(o, step, cleaned.fields);
    const notes = [...cleaned.removed.map((s) => `Taken out (a claim or a figure you didn't give): "${s}"`), ...cited.refused.map((r) => `${r.field} ${r.why}`)];
    if (!Object.keys(cited.fields).length) return { text: `Nothing was saved: nothing usable was left.${notes.length ? `\n${notes.join("\n")}` : ""}`, data: { saved: false, notes } };
    const draftId = await saveDraft(o, w, step, cited.fields, notes, actor(v, call));
    const needs = cited.refused.filter((r) => r.why.startsWith("needs permission first"));
    return {
      text: `Saved Claude's ${step} draft beside "${w.title}". It waits for the member's Approve, Edit or Discard in the wizard; the webinar is unchanged.${needs.length ? ` Needs permission first: ${needs.map((r) => r.why.replace(/^needs permission first: /, "")).join("; ")}.` : ""}${cleaned.removed.length ? ` ${cleaned.removed.length} sentence${cleaned.removed.length === 1 ? "" : "s"} taken out (a claim or a figure they didn't give).` : ""}`,
      data: { saved: true, draftId, step, fields: cited.fields, notes, link: link(w.id, step) },
    };
  },
});

defineTool({
  name: "story_bank_list",
  scope: "webinars",
  kind: "read",
  description: "The member's stories: those a webinar act can carry (their library's stories, and their Essence's as essence:<n>), and their story bank, each with its status. Only a story bank item marked Ready may be used; Check before using and Needs permission are held.",
  input: { limit: z.number().int().min(1).max(50).optional().describe("How many story bank items, default 25") },
  handler: async (v, input): Promise<ToolResult> => {
    const o = owner(v);
    const subject = await subjectFor(o);
    const actStories = [...subject.assets.filter((a) => a.type === "story").map((a) => ({ storyId: a.id, name: a.name, from: a.isExample ? "library (example)" : "library" })), ...subject.essenceStories.map((st, i) => ({ storyId: `essence:${i}`, name: st.name || st.summary.slice(0, 60), from: "Essence" }))];
    const bank = await db.query.storyItems.findMany({ where: and(eq(schema.storyItems.workspaceId, o.workspaceId), eq(schema.storyItems.userId, o.userId)), orderBy: [asc(schema.storyItems.status), asc(schema.storyItems.title)], limit: Number(input.limit ?? 25) });
    const items = bank.map((s) => ({ id: s.id, title: s.title, type: s.type, what: s.what, status: STATUS_WORDS[s.status], usable: s.status === "ready", ...(s.status === "ready" ? { exactWords: s.exactWords, numbers: s.numbers } : {}) }));
    const held = items.filter((i) => !i.usable).length;
    return { text: `${actStories.length} stor${actStories.length === 1 ? "y" : "ies"} a webinar act can carry (use storyId in beliefs), and ${items.length} story bank item${items.length === 1 ? "" : "s"}${held ? `, ${held} held until the member clears them` : ""}.`, data: { actStories, storyBank: items } };
  },
});
