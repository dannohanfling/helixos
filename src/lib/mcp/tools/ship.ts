/**
 * Voice to Ship (rev 638): a member says "make a ladder on X, use my gym photo, ship it" in a Claude chat, and their HelixOS
 * writes it, makes the graphic, reads back what will post and ships after their yes. Every tool calls the same code the
 * Ladders page does (src/lib/ladder-core.ts): one writer, one set of checks, one Ship. Answers are read aloud: one sentence
 * first, everything numbered, ids only in the data.
 *
 * Publishing is public, so the yes must come after the read-back: ladder_ship needs the token ladder_ship_preview gave for
 * exactly this ladder, these channels and this text, within 15 minutes, and confirm: true. Failing checks, a shipped ladder
 * or a team member are refused here, whatever Claude says.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { ladderFor } from "@/lib/mcp/tools/ladders";
import { checksFor, createLadder, pickFormat, shipLadder, updateLadderPart, LADDER_PARTS, type LadderPart } from "@/lib/ladder-core";
import { LADDER_FORMATS, headlineParts, type LadderFormatKey } from "@/lib/engine/ladder";
import { checksLine, channelSet, findImages, fingerprint, firstLines, numbered, type ShipTarget } from "@/lib/engine/voice-ship";
import { shipRuns } from "@/lib/engine/ship";
import { publishBlockers } from "@/lib/engine/ladder";
import { headlineChoices } from "@/lib/engine/graphic";
import { shipFacts } from "@/lib/queries/ship";
import { connectionFor } from "@/lib/ghl";
import { checkPreviewToken, issuePreviewToken } from "@/lib/ship-preview";
import { formatDate } from "@/lib/dates";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const linkTo = (id: string) => `${appUrl()}/content/ladders/${id}`;
const headlineText = (h: string) => headlineParts(h).text.replace(/\s*\/\s*/g, " ");
const stateOf = (l: schema.Ladder) => (l.shippedAt ? "shipped" : l.graphicImageId ? "graphic made" : "draft");
const CHANNEL_WORDS: Record<ShipTarget, string> = { page: "Facebook Page", instagram: "Instagram" };

defineTool({
  name: "ladders_list",
  scope: "content",
  kind: "read",
  description: "The member's recent comment ladders, newest first and numbered: topic, status (draft, graphic made, shipped) and date. Use a number or topic words with the other ladder tools.",
  input: { limit: z.number().int().min(1).max(20).optional().describe("How many, default 10") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.ladders.findMany({ where: and(eq(schema.ladders.workspaceId, v.workspace.id), eq(schema.ladders.userId, v.user.id)), orderBy: desc(schema.ladders.createdAt), limit: Number(input.limit ?? 10) });
    if (!rows.length) return { text: "No ladders yet. Say a topic and I'll write one.", data: { ladders: [] } };
    const lines = rows.map((l) => `${l.topic} (${stateOf(l)}, ${formatDate(l.createdAt.slice(0, 10))})`);
    return { text: `${rows.length} recent ladder${rows.length === 1 ? "" : "s"}:\n${numbered(lines)}`, data: { ladders: rows.map((l, i) => ({ n: i + 1, id: l.id, topic: l.topic, status: stateOf(l), created: l.createdAt })) } };
  },
});

defineTool({
  name: "ladder_read",
  scope: "content",
  kind: "read",
  description: "One of the member's ladders in full, by id or words from its topic: the body, the rungs numbered, the headline and numbered alternates, the Instagram caption, whether the graphic is made, whether it has shipped, and the checks in plain words.",
  input: { ladder: z.string().min(1).max(200).describe("The ladder: its id, or words from its topic") },
  handler: async (v, input): Promise<ToolResult> => {
    const l = await ladderFor(v, String(input.ladder ?? ""));
    const checks = await checksFor(l);
    const alts = headlineChoices(l.headline, l.altHeadlines).map(headlineText);
    const text = [
      `"${l.topic}": ${l.rungs.length} rungs, ${stateOf(l)}, ${checksLine(checks)}.`,
      `Headline and alternates:\n${numbered(alts)}`,
      `Body:\n${l.copy}`,
      `Rungs:\n${numbered(l.rungs.map((r) => r.body.replace(/\n+/g, " ")))}`,
      l.igCaption ? `Instagram caption:\n${l.igCaption}` : "",
      `Open it: ${linkTo(l.id)}`,
    ].filter(Boolean).join("\n\n");
    return { text, data: { id: l.id, status: stateOf(l), graphicImageId: l.graphicImageId, shippedAt: l.shippedAt, headlines: alts, rungs: l.rungs.map((r) => ({ n: r.n, body: r.body })), checks: checks.filter((c) => !c.ok).map((c) => ({ key: c.key, label: c.label, level: c.level, note: c.note })) } };
  },
});

defineTool({
  name: "images_find",
  scope: "content",
  kind: "read",
  description: "Finds the member's own photos in their Images by words (\"the gym one\", \"coffee with a client\") and dates (\"from last week\", \"yesterday\"). Up to five, numbered, the first the suggestion. Read-only. Pass the chosen one's id to ladder_make_graphic as photo.",
  input: { words: z.string().min(1).max(200).describe("What the photo shows, and optionally when it was added") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), orderBy: desc(schema.deckImages.createdAt) });
    const found = findImages(rows, String(input.words ?? ""), v.today);
    if (!found.length) return { text: `No photo in their Images matches "${input.words}". They can add one in HelixOS (Images), or go without a photo.`, data: { images: [] } };
    const lines = found.map((i) => `${i.caption || i.kind}, added ${formatDate(i.createdAt.slice(0, 10))}`);
    return { text: `${found.length} match${found.length === 1 ? "" : "es"}, the first suggested:\n${numbered(lines)}`, data: { images: found.map((i, n) => ({ n: n + 1, id: i.id, caption: i.caption, kind: i.kind, added: i.createdAt, suggested: n === 0 })) } };
  },
});

defineTool({
  name: "ladder_create",
  scope: "content:write",
  kind: "write",
  description: "Writes a new comment ladder for the member with the same writer as their Ladders page (their voice, Essence, avatar; for a coach's own ladders their teaching library), and the same checks. Saves it as a draft; nothing is posted. Give the topic; the format (one of the 13) and notes (an angle, story, offer or avatar to lean on) are optional. Read back the one-line summary, then the numbered headlines.",
  input: {
    topic: z.string().min(3).max(300).describe("What the ladder is about"),
    format: z.string().max(60).optional().describe(`Optional. One of: ${LADDER_FORMATS.map((f) => f.name).join(", ")}. Left out, the best fit is picked.`),
    notes: z.string().max(4000).optional().describe("Optional: an angle, a story, an offer or an avatar to lean on"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const topic = String(input.topic ?? "").trim();
    const notes = input.notes ? String(input.notes).trim() : null;
    const asked = String(input.format ?? "").trim().toLowerCase();
    const named = asked ? LADDER_FORMATS.find((f) => f.key === asked || f.name.toLowerCase() === asked) : undefined;
    if (asked && !named) throw new Error(`"${input.format}" isn't one of the formats: ${LADDER_FORMATS.map((f) => f.name).join(", ")}.`);
    const format: LadderFormatKey = named?.key ?? (await pickFormat(topic, notes, v));
    const profile = await db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) });
    const keyword = profile?.keywords?.[0]?.keyword ?? "NONE";
    const { id, generatedBy } = await createLadder({ workspaceId: v.workspace.id, userId: v.user.id }, { format, topic, audience: "warm", keyword, sourceMaterial: notes, realNumbers: null, leadMagnet: null, leadMagnetId: null }, v);
    const l = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, id) }))!;
    const checks = await checksFor(l);
    const alts = headlineChoices(l.headline, l.altHeadlines).map(headlineText);
    const fmt = LADDER_FORMATS.find((f) => f.key === format)!.name;
    const lead = generatedBy === "claude" ? `Ladder ready: "${alts[0] ?? topic}", ${l.rungs.length} rungs, ${checksLine(checks)}.` : generatedBy === "claude-partial" ? `The writer didn't return a full ladder, so a skeleton was saved to fill in; its answer is in the notes.` : `No AI key is set up in HelixOS, so a skeleton was saved to fill in.`;
    const text = [lead, `Format: ${fmt}.`, alts.length ? `Headline and alternates:\n${numbered(alts)}` : "", `Body starts: ${firstLines(l.copy)}`, `Open it: ${linkTo(id)}`].filter(Boolean).join("\n\n");
    return { text, data: { id, format, generatedBy, headlines: alts, rungs: l.rungs.length, checks: checks.filter((c) => !c.ok).map((c) => ({ key: c.key, label: c.label, level: c.level })), link: linkTo(id) } };
  },
});

defineTool({
  name: "ladder_update",
  scope: "content:write",
  kind: "write",
  description: "Changes one part of the member's ladder: the headline, the body, rung N or the Instagram caption. Give either the member's exact new words (text) or what to change (instruction, e.g. \"make it shorter\"), or for the headline use_alternate N. Re-runs the checks and says the new part back. A shipped ladder is never changed here.",
  input: {
    ladder: z.string().min(1).max(200).describe("The ladder: its id, or words from its topic"),
    part: z.enum(LADDER_PARTS).describe("headline, body, rung or ig_caption"),
    rung: z.number().int().min(1).max(30).optional().describe("Which rung, for part rung"),
    text: z.string().max(4000).optional().describe("The member's exact new words"),
    instruction: z.string().max(1000).optional().describe("What to change, for the writer to apply to that part only"),
    use_alternate: z.number().int().min(1).max(5).optional().describe("For the headline: use alternate N, as numbered by ladder_read or ladder_create"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const l = await ladderFor(v, String(input.ladder ?? ""));
    const part = input.part as LadderPart;
    let text = input.text ? String(input.text) : undefined;
    if (part === "headline" && input.use_alternate) {
      const choices = headlineChoices(l.headline, l.altHeadlines);
      const pick = choices[Number(input.use_alternate)];
      if (!pick) throw new Error(`There's no alternate ${input.use_alternate}. The choices:\n${numbered(choices.map(headlineText))}`);
      text = pick;
    }
    if (part === "rung" && !input.rung) throw new Error("Say which rung, by its number.");
    const r = await updateLadderPart(v, l, part, { text, instruction: input.instruction ? String(input.instruction) : undefined, rung: input.rung ? Number(input.rung) : undefined });
    if (!r.ok) throw new Error(r.error);
    // The old headline becomes an alternate, so "swap back" is always one step.
    if (part === "headline") {
      const alts = [r.before, ...r.ladder.altHeadlines.filter((a) => a.trim() !== r.after.trim() && a.trim() !== r.before.trim())].slice(0, 4);
      await db.update(schema.ladders).set({ altHeadlines: alts }).where(eq(schema.ladders.id, l.id));
    }
    const checks = await checksFor(r.ladder);
    const label = part === "rung" ? `Rung ${input.rung}` : part === "ig_caption" ? "The Instagram caption" : part === "body" ? "The body" : "The headline";
    return { text: `${label} changed, ${checksLine(checks)}. Now:\n${part === "headline" ? headlineText(r.after) : r.after}`, data: { id: l.id, part, rung: input.rung ?? null, after: r.after, checks: checks.filter((c) => !c.ok).map((c) => ({ key: c.key, label: c.label, level: c.level })) } };
  },
});

/** What a Ship of this ladder would do on these channels, and what stops or weakens it. */
async function previewOf(v: Viewer, l: schema.Ladder, asked: readonly string[] | undefined) {
  const { facts, steps } = await shipFacts(v, l);
  const runs = shipRuns(steps);
  const ready = channelSet(runs.filter((k) => k === "page" || k === "instagram"));
  const channels = asked?.length ? channelSet(asked) : ready;
  const checks = await checksFor(l);
  const blocks: string[] = [];
  const weakens: string[] = [];
  if (publishBlockers(checks).length) blocks.push(checksLine(checks));
  if (l.shippedAt) blocks.push("it has already shipped; a re-ship stays in HelixOS");
  if (!facts.hasGraphic) blocks.push("there's no graphic yet (make one first)");
  if (!channels.length) blocks.push("no channel is ready to post to");
  for (const c of channels) if (!ready.includes(c)) blocks.push(`${CHANNEL_WORDS[c]} can't post: ${steps.find((s) => s.key === c)?.why ?? "not connected"}`);
  // Before a Ship the rungs always wait on the two posts going live; only a missing webhook or another ladder dripping holds them.
  if (l.rungs.length && !facts.drip.handed) {
    if (!facts.drip.setUp) weakens.push("the posts will go but the rungs will hold: the rungs webhook isn't set up under My bot yet");
    else if (facts.drip.locked) weakens.push(`the posts will go but the rungs will wait: another ladder is dripping until about ${facts.drip.locked}`);
    else if (channels.length < 2) weakens.push("the rungs go once both the Facebook and Instagram posts are live, so with one channel they'll wait");
  }
  const conn = await connectionFor(v.user.id);
  const nameOf = (c: ShipTarget) => conn?.accounts.find((a) => a.id === conn.mapping[c === "page" ? "fb_page" : "instagram"])?.name ?? null;
  return { channels, blocks, weakens, accounts: channels.map((c) => ({ channel: c, name: nameOf(c) })) };
}

defineTool({
  name: "ladder_ship_preview",
  scope: "content:publish",
  kind: "read",
  description: "Says exactly what shipping the ladder would do: the accounts by name, the headline on the graphic, the first lines of the body and caption, the rung count and timing, and anything that would stop or weaken it. Returns a preview_token for ladder_ship. Read this back to the member in plain words and get their yes before calling ladder_ship.",
  input: {
    ladder: z.string().min(1).max(200).describe("The ladder: its id, or words from its topic"),
    channels: z.array(z.enum(["page", "instagram"])).optional().describe("Optional: page, instagram or both; left out, whatever Ship would use"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    if (v.team) throw new Error("A team member can't publish for the account owner. They can ship it themselves.");
    const l = await ladderFor(v, String(input.ladder ?? ""));
    const p = await previewOf(v, l, input.channels as string[] | undefined);
    const where = p.accounts.map((a) => `${CHANNEL_WORDS[a.channel]}${a.name ? ` "${a.name}"` : ""}`).join(" and ");
    const what = [
      `Headline on the graphic: ${headlineText(l.headline)}`,
      `Body starts: ${firstLines(l.copy)}`,
      l.igCaption && p.channels.includes("instagram") ? `Instagram caption starts: ${firstLines(l.igCaption, 1)}` : "",
      l.rungs.length ? `Rungs: ${l.rungs.length}, the first about 5 minutes after both posts are live, then a few minutes apart.` : "",
    ].filter(Boolean);
    if (p.blocks.length) return { text: `This can't ship yet: ${p.blocks.join("; ")}.\n\n${what.join("\n")}`, data: { canShip: false, blocks: p.blocks, weakens: p.weakens, channels: p.channels } };
    const token = issuePreviewToken({ userId: v.user.id, ladderId: l.id, channels: p.channels, fingerprint: fingerprint(l) });
    const text = [`Shipping "${l.topic}" will post to ${where}.`, ...what, p.weakens.length ? `Note: ${p.weakens.join("; ")}.` : "", "Read this back and ask the member to say yes before shipping. The preview lasts 15 minutes."].filter(Boolean).join("\n");
    return { text, data: { canShip: true, preview_token: token, channels: p.channels, accounts: p.accounts, weakens: p.weakens, rungs: l.rungs.length } };
  },
});

defineTool({
  name: "ladder_ship",
  scope: "content:publish",
  kind: "write",
  description: "Ships the ladder: posts it to the Facebook Page and Instagram with its graphic and hands its rungs to the bot, the same Ship as the HelixOS button. ONLY after: (1) calling ladder_ship_preview, (2) reading the preview back to the member in plain words (accounts, headline, first lines, rung count), (3) the member saying yes in this conversation after hearing it. \"Ship it\" in their first request means go to the preview, not skip it. Pass the preview_token and confirm: true. Refused with failing checks, after an edit, for a shipped ladder, or with an old preview.",
  input: {
    ladder: z.string().min(1).max(200).describe("The ladder: its id, or words from its topic"),
    preview_token: z.string().min(1).max(2000).describe("The token ladder_ship_preview returned for this ladder"),
    confirm: z.boolean().describe("true only after the member said yes to the read-back preview"),
    channels: z.array(z.enum(["page", "instagram"])).optional().describe("The same channels the preview used, if it was given any"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    if (v.team) throw new Error("A team member can't publish for the account owner. They can ship it themselves.");
    if (input.confirm !== true) return { text: "Not shipped. Read the preview back to the member and ask for their yes, then call again with confirm: true.", data: { shipped: false } };
    const l = await ladderFor(v, String(input.ladder ?? ""));
    if (l.shippedAt) return { text: "Not shipped: this ladder has already shipped. A re-ship stays in HelixOS, so nothing posts twice.", data: { shipped: false, reason: "already_shipped" } };
    const p = await previewOf(v, l, input.channels as string[] | undefined);
    const t = checkPreviewToken(String(input.preview_token ?? ""), { userId: v.user.id, ladderId: l.id, channels: p.channels, fingerprint: fingerprint(l) });
    if (!t.ok) return { text: `Not shipped. ${t.why}`, data: { shipped: false, reason: "token" } };
    if (p.blocks.length) return { text: `Not shipped: ${p.blocks.join("; ")}. Fix it, or ship from HelixOS.`, data: { shipped: false, blocks: p.blocks } };
    const out = await shipLadder(v, l, null, p.channels);
    if (out.held) return { text: "Nothing could ship: every step is held. Open the ladder in HelixOS to see why.", data: { shipped: false, reason: "held" } };
    const after = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, l.id) }))!;
    const { facts } = await shipFacts(v, after);
    const said = (c: ShipTarget) => {
      const post = facts.posts[c];
      return post.state === "published" ? "posted" : post.state === "sent" ? "sent, waiting for GoHighLevel to confirm" : post.state === "failed" ? `didn't post: ${post.reason ?? "the reason is on the ladder in HelixOS"}` : "not sent";
    };
    const rungs = out.notes.find((n) => n.startsWith("Rungs queued") || n.startsWith("rungs held"));
    const line = [...p.channels.map((c) => `${c === "page" ? "Facebook" : "Instagram"}: ${said(c)}`), rungs ? (rungs.startsWith("rungs held") ? `Rungs held: ${rungs.replace(/^rungs held \((.*)\)$/, "$1")}` : rungs) : ""].filter(Boolean).join(" · ");
    return { text: line, data: { shipped: true, posts: Object.fromEntries(p.channels.map((c) => [c, facts.posts[c]])), notes: out.notes, keywordBlocked: out.keywordBlocked } };
  },
});
