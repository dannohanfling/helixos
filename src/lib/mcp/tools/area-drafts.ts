/**
 * Claude's drafts of the Essence, lead magnets, posts and what the bot says on the connector (H-184, plan H-220 PRs D2b, D2c). Each draft sits beside
 * what the member has, for them to Approve, Edit or Discard on its own page; nothing is published, scheduled or sent, and a
 * magnet's keyword, address and files are never touched. Each connection reaches only its own member's rows; a team member's
 * connection reads and never drafts.
 */
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DraftArea } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { siteUrl } from "@/lib/app-url";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { BOT_FIELDS, CONTENT_FIELDS, MAGNET_FIELDS, cleanFields, readFields, type FieldSpec } from "@/lib/engine/claude-drafts";
import { ESSENCE_SECTIONS, normalizeEssence, sectionByKey, sectionFilled, type Story } from "@/lib/engine/essence";
import { areaFacts, areaRow, pendingDrafts, redLinesFor, saveDraft, type Actor } from "@/lib/claude-drafts";

const owner = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });
const actor = (v: Viewer, call?: { agentId?: string | null }): Actor => ({ name: v.actor?.name ?? v.user.name, connector: true, agentId: call?.agentId ?? null });
const describe = (specs: FieldSpec[]) => specs.map((f) => (f.kind === "choice" ? `${f.key} (${f.choices!.join(", ")})` : f.kind === "date" ? `${f.key} (YYYY-MM-DD)` : f.kind === "list" ? `${f.key} (a list of lines)` : f.kind === "stories" ? `${f.key} (a list of {name, summary, when_to_use})` : f.key)).join(", ");
const drafter = (v: Viewer, what: string) => {
  if (v.team) throw new Error(`A team member's connection reads ${what} and never drafts them. The account owner can, on their own connection.`);
};

/**
 * One draft through the shared rules: fields by name only, the words cleaned against the member's own facts and words, then
 * saved beside the row. What came out and why is said back, and so are the red lines the member will see.
 */
async function draftOf(v: Viewer, call: { agentId?: string | null } | undefined, area: DraftArea, targetId: string | null, raw: unknown, source: string, label: string, page: string, extra: { fields?: Record<string, unknown>; notes?: string[] } = {}): Promise<ToolResult> {
  const read = readFields(area, raw, targetId);
  if (read.refused.length || read.problems.length) {
    const parts = [read.refused.length ? `${label} doesn't take ${read.refused.join(", ")}` : "", ...read.problems].filter(Boolean);
    return { text: `Nothing was saved: ${parts.join("; ")}.`, data: { saved: false, refused: read.refused, problems: read.problems } };
  }
  const known = `${await areaFacts(owner(v), area)}\n${source}`;
  const cleaned = cleanFields(area, { ...read.fields, ...(extra.fields ?? {}) }, known, targetId);
  const notes = [...cleaned.removed.map((s) => `Taken out (a claim or a figure you didn't give): "${s}"`), ...(extra.notes ?? [])];
  if (!Object.keys(cleaned.fields).length) return { text: `Nothing was saved: nothing usable was left.${notes.length ? `\n${notes.join("\n")}` : ""}`, data: { saved: false, notes } };
  if (!targetId && !cleaned.fields.title) return { text: "Nothing was saved: a new one needs its title.", data: { saved: false, notes } };
  const draftId = await saveDraft(owner(v), area, targetId, cleaned.fields, notes, actor(v, call), source);
  const d = (await pendingDrafts(owner(v), area, targetId)).find((x) => x.id === draftId);
  const red = d ? await redLinesFor(owner(v), d) : [];
  return {
    text: `Saved Claude's draft of ${label}. It waits for the member's Approve, Edit or Discard on ${page}; nothing has changed.${red.length ? ` Shown in red until they check it: ${red.join(" ")}` : ""}${cleaned.removed.length ? ` ${cleaned.removed.length} line${cleaned.removed.length === 1 ? "" : "s"} taken out (a claim or a figure they didn't give).` : ""}${(extra.notes ?? []).length ? ` ${extra.notes!.join(" ")}` : ""}`,
    data: { saved: true, draftId, fields: cleaned.fields, notes, red },
  };
}

// ── Essence ──

defineTool({
  name: "essence_read",
  scope: "essence",
  kind: "read",
  description: "The member's Essence, section by section: each section's key, title, its fields as they stand, whether it's filled, and whether Claude's draft of it is waiting. Draft a section with essence_draft.",
  input: { section: z.string().max(60).optional().describe("One section's key, for that section only") },
  handler: async (v, input): Promise<ToolResult> => {
    const row = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, v.workspace.id), eq(schema.essences.userId, v.user.id)) });
    const data = normalizeEssence(row?.data ?? {});
    const waiting = await pendingDrafts(owner(v), "essence");
    const want = typeof input.section === "string" && input.section ? sectionByKey(input.section) : null;
    if (input.section && !want) return { text: `No Essence section "${input.section}". The sections are: ${ESSENCE_SECTIONS.map((s) => s.key).join(", ")}.` };
    const sections = (want ? [want] : ESSENCE_SECTIONS).map((s) => ({ key: s.key, title: s.title, filled: sectionFilled(data, s.key), fields: Object.fromEntries(s.fields.map((f) => [f.key, data[s.key]?.[f.key] ?? (f.kind === "text" ? "" : [])])), fieldKinds: Object.fromEntries(s.fields.map((f) => [f.key, f.kind])), draftWaiting: waiting.some((d) => d.targetId === s.key) }));
    return { text: `${sections.filter((s) => s.filled).length} of ${sections.length} section${sections.length === 1 ? "" : "s"} filled.`, data: { sections, link: `${siteUrl()}/essence` } };
  },
});

defineTool({
  name: "essence_draft",
  scope: "essence",
  kind: "write",
  description:
    "Writes Claude's draft of one Essence section, beside it; the Essence doesn't change until the member taps Approve on that section. Give the section's key and its fields by name (essence_read lists them; text fields are text, list fields a list of lines, representative_stories.stories a list of {name, summary, when_to_use}). For representative_stories, story_ids adds stories from their own library or story bank by id; a story bank item marked Check before using or Needs permission is refused. " +
    "The member's words only: a sentence with a figure that isn't in their own facts or source_words is taken out, and so is an income claim. A newer draft of a section replaces the older one.",
  input: {
    section: z.string().min(1).max(60).describe("The section's key, e.g. mission_and_vision"),
    fields: z.record(z.string(), z.unknown()).describe("The section's fields, by name"),
    story_ids: z.array(z.string().max(40)).max(12).optional().describe("representative_stories only: ids from their library's stories or their story bank"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v, "the Essence");
    const section = sectionByKey(String(input.section ?? ""));
    if (!section) return { text: `No Essence section "${String(input.section ?? "")}". The sections are: ${ESSENCE_SECTIONS.map((s) => s.key).join(", ")}.` };
    const notes: string[] = [];
    const added: Story[] = [];
    const ids = Array.isArray(input.story_ids) ? (input.story_ids as string[]) : [];
    if (ids.length) {
      if (section.key !== "representative_stories") return { text: "Nothing was saved: story_ids is for the representative_stories section only." };
      const [assets, bank] = await Promise.all([
        db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.userId, v.user.id), eq(schema.libraryAssets.type, "story"), eq(schema.libraryAssets.isExample, false), inArray(schema.libraryAssets.id, ids)) }),
        db.query.storyItems.findMany({ where: and(eq(schema.storyItems.workspaceId, v.workspace.id), eq(schema.storyItems.userId, v.user.id), inArray(schema.storyItems.id, ids)) }),
      ]);
      for (const id of ids) {
        const a = assets.find((x) => x.id === id);
        const b = bank.find((x) => x.id === id);
        if (a) added.push({ name: a.name, summary: a.summary ?? a.body, when_to_use: a.useWhen ?? "" });
        else if (b && b.status === "ready") added.push({ name: b.title, summary: b.what, when_to_use: "" });
        else if (b) notes.push(`Needs permission first: "${b.title}" is marked ${b.status === "check" ? "Check before using" : "Needs permission"}, so it was left out.`);
        else notes.push(`${id} isn't one of their stories, so it was left out.`);
      }
    }
    const raw = (input.fields ?? {}) as Record<string, unknown>;
    const extra = added.length ? { fields: { stories: [...((readFields("essence", raw, section.key).fields.stories as Story[] | undefined) ?? []), ...added] } } : {};
    return draftOf(v, call, "essence", section.key, raw, String(input.source_words ?? ""), `their Essence's "${section.title}"`, `Essence → ${section.title}`, { ...extra, notes });
  },
});

// ── Lead magnets ──

defineTool({
  name: "magnets_list",
  scope: "magnets",
  kind: "read",
  description: "The member's lead magnets, newest first: id, title, type, promise, whether it's published, and whether Claude's draft of it is waiting.",
  input: { limit: z.number().int().min(1).max(30).optional().describe("How many, default 15") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.leadMagnets.findMany({ where: and(eq(schema.leadMagnets.workspaceId, v.workspace.id), eq(schema.leadMagnets.userId, v.user.id)), orderBy: desc(schema.leadMagnets.createdAt), limit: Number(input.limit ?? 15) });
    const waiting = await pendingDrafts(owner(v), "magnet");
    const magnets = rows.map((m) => ({ id: m.id, title: m.title, type: m.type, promise: m.promise, published: Boolean(m.publishedAt), draftWaiting: waiting.some((d) => d.targetId === m.id), link: `${siteUrl()}/magnets/${m.id}` }));
    const fresh = waiting.filter((d) => !d.targetId).length;
    return { text: `${magnets.length} lead magnet${magnets.length === 1 ? "" : "s"}.${fresh ? ` ${fresh} new one${fresh === 1 ? "" : "s"} drafted and waiting.` : ""}`, data: { magnets, newDraftsWaiting: fresh } };
  },
});

defineTool({
  name: "magnet_draft",
  scope: "magnets",
  kind: "write",
  description:
    `Writes Claude's draft of one of the member's lead magnets (give its id), or of a new one (leave id out; title is then needed). The magnet doesn't change until the member taps Approve on its page, and a new one is only made then. It is never published, and its keyword, address and files are never touched. Fields (exactly these names): ${describe(MAGNET_FIELDS)}. ` +
    'content is text: the intro, then "## Heading" lines each with "- item" lines under it, then a line "---" and the closing with the call to action. No income claims and no figures the member didn\'t give.',
  input: {
    id: z.string().max(40).optional().describe("The magnet's id; leave out for a new one"),
    fields: z.record(z.string(), z.unknown()).describe("The magnet's fields, by the names above"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v, "lead magnets");
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : null;
    const row = id ? await areaRow(owner(v), "magnet", id) : null;
    if (id && !row) return { text: "No lead magnet with that id in your HelixOS." };
    return draftOf(v, call, "magnet", id, input.fields, String(input.source_words ?? ""), row ? `"${String(row.title)}"` : "a new lead magnet", row ? "the magnet's page" : "Lead magnets");
  },
});

// ── Posts ──

defineTool({
  name: "content_list",
  scope: "content",
  kind: "read",
  description: "The member's posts, newest first: id, title, status (idea, creating, ready, scheduled, posted), type, platform, its date, and whether Claude's draft of it is waiting.",
  input: { limit: z.number().int().min(1).max(50).optional().describe("How many, default 20") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, v.workspace.id), eq(schema.contentItems.userId, v.user.id)), orderBy: desc(schema.contentItems.createdAt), limit: Number(input.limit ?? 20) });
    const waiting = await pendingDrafts(owner(v), "content");
    const posts = rows.map((c) => ({ id: c.id, title: c.title, status: c.status, contentType: c.contentType, platform: c.platform, date: c.postAt?.slice(0, 10) ?? null, draftWaiting: waiting.some((d) => d.targetId === c.id), link: `${siteUrl()}/content/${c.id}` }));
    return { text: `${posts.length} post${posts.length === 1 ? "" : "s"}.`, data: { posts, newDraftsWaiting: waiting.filter((d) => !d.targetId).length } };
  },
});

defineTool({
  name: "content_draft",
  scope: "content:write",
  kind: "write",
  description:
    `Writes Claude's draft of a post: one of the member's (give its id) or a new one (leave id out; title is then needed). Nothing changes until the member taps Approve; then it lands on their calendar as In progress on the suggested date. It is never scheduled or posted from here: scheduling stays their own step, and a post already scheduled or posted can't be drafted over. Fields (exactly these names): ${describe(CONTENT_FIELDS)}. ` +
    "No income claims and no figures the member didn't give.",
  input: {
    id: z.string().max(40).optional().describe("The post's id; leave out for a new one"),
    fields: z.record(z.string(), z.unknown()).describe("The post's fields, by the names above"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v, "posts");
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : null;
    const row = id ? await areaRow(owner(v), "content", id) : null;
    if (id && !row) return { text: "No post with that id in your HelixOS." };
    return draftOf(v, call, "content", id, input.fields, String(input.source_words ?? ""), row ? `"${String(row.title)}"` : "a new post", row ? "the post's page" : "Content");
  },
});

// ── Your bot ──

defineTool({
  name: "bot_profile_read",
  scope: "bot",
  kind: "read",
  description: "What the member's bot says about their business: what they do, the three questions it asks before booking (blank uses the house question), and what to expect when booking; and whether Claude's draft of it is waiting.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    const row = await areaRow(owner(v), "bot_profile", v.membership.id);
    const [draft] = await pendingDrafts(owner(v), "bot_profile", v.membership.id);
    const fields = Object.fromEntries(BOT_FIELDS.map((f) => [f.key, row?.[f.key] ?? null]));
    return { text: `What your bot says about the business.${draft ? " Claude's draft is waiting on it." : ""}`, data: { fields, draft: draft ? { id: draft.id, fields: draft.fields, by: draft.byLabel, at: draft.createdAt } : null, link: `${siteUrl()}/settings#your-bot` } };
  },
});

defineTool({
  name: "bot_profile_draft",
  scope: "bot",
  kind: "write",
  description:
    `Writes Claude's draft of what the member's bot says about their business, beside it. The bot keeps its current answers until the member taps Approve in Settings → What your bot says, and nothing is sent to their bot or to Community Loyalty from here; the booking link and the guarantee's terms are never touched. Fields (exactly these names): ${describe(BOT_FIELDS)}. No income claims and no figures the member didn't give.`,
  input: {
    fields: z.record(z.string(), z.unknown()).describe("The fields, by the names above"),
    source_words: z.string().max(8000).optional().describe("The member's own words this draft is built from"),
  },
  handler: async (v, input, call): Promise<ToolResult> => {
    drafter(v, "what the bot says");
    return draftOf(v, call, "bot_profile", v.membership.id, input.fields, String(input.source_words ?? ""), "what your bot says about your business", "Settings → What your bot says");
  },
});
