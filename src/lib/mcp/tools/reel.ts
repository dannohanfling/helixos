/**
 * Reel to Post, PR C (H-1948, plan H-1953): reel_create on the connector. A member pastes or says a reel's transcript in a
 * Claude chat and their HelixOS writes the reel package with the same Reel mode as Content → New from a reel (one writer,
 * the same flags and checks, src/lib/ladder-core.ts), saves it as a ladder draft and reads back the picked hook, the cover
 * frame and what to check before posting. Nothing is posted.
 */
import { siteUrl } from "@/lib/app-url";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { checksFor, createLadder } from "@/lib/ladder-core";
import { headlineParts } from "@/lib/engine/ladder";
import { REEL_FLAG_LABELS, spokenKeyword, topicFromTranscript, type ReelFlagKind } from "@/lib/engine/reel";
import { checksLine, numbered } from "@/lib/engine/voice-ship";

const linkTo = (id: string) => `${siteUrl()}/content/ladders/${id}`;

defineTool({
  name: "reel_create",
  scope: "content:write",
  kind: "write",
  description:
    "Turns a reel's transcript into a ready-to-post package with the same writer as Content → New from a reel: three hooks with one picked, the caption, exactly 5 comment rungs, the cover frame, on-screen text, and what to check before posting (numbers, prices or names said on camera that aren't in their proof, a keyword said that isn't on their facts). Saves it as a ladder draft; nothing is posted. Give the transcript (or, for a reel with no talking, what's on screen); keyword and notes are optional. Read back the one-line summary, the picked hook, the cover, then the numbered things to check.",
  input: {
    transcript: z.string().min(20).max(20000).describe("What the member says in the reel, or for a reel with no talking, what's on screen or what they're teaching"),
    keyword: z.string().max(40).optional().describe("Optional: one of the keywords on their Ladder facts for the last rung, or NONE. Left out: the keyword said on camera if it's on their facts, else none."),
    notes: z.string().max(2000).optional().describe("Optional: an angle or what to keep. Never used as a fact."),
    topic: z.string().max(200).optional().describe("Optional: a few words for their list. Left out: taken from the first sentence."),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const transcript = String(input.transcript ?? "").trim();
    if (transcript.length < 20) throw new Error("Give the reel's words (at least a sentence), or describe what's on screen.");
    const profile = await db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) });
    const asked = String(input.keyword ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (asked && asked !== "NONE" && !(profile?.keywords ?? []).some((k) => k.keyword.trim().toUpperCase() === asked)) throw new Error(`"${input.keyword}" isn't a keyword on their Ladder facts. Their keywords: ${(profile?.keywords ?? []).map((k) => k.keyword).join(", ") || "none yet"}, or NONE.`);
    // The same rule as the page: left out, the keyword said on camera if it's on their facts, else none.
    const spoken = spokenKeyword(transcript, profile ?? null);
    const keyword = asked || (spoken?.onFacts ? spoken.keyword : "NONE");
    const topic = String(input.topic ?? "").trim() || topicFromTranscript(transcript);
    const { id, generatedBy } = await createLadder({ workspaceId: v.workspace.id, userId: v.user.id }, { format: "reel", topic, audience: "warm", keyword, sourceMaterial: transcript, realNumbers: null, leadMagnet: null, leadMagnetId: null, notes: input.notes ? String(input.notes).trim() : null }, v);
    const l = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, id) }))!;
    const checks = await checksFor(l);
    const hook = l.hookOptions.find((h) => h.pick)?.text ?? l.hook ?? "";
    const cover = headlineParts(l.headline).lines.join(" / ");
    const flags = l.reelFlags.map((f) => `${REEL_FLAG_LABELS[f.kind as ReelFlagKind] ?? "Check"}: ${f.text}`);
    const lead = generatedBy === "claude" ? `Reel package ready: ${l.rungs.length} rungs, keyword ${keyword === "NONE" ? "none" : keyword}, ${checksLine(checks)}.` : generatedBy === "claude-partial" ? "The writer didn't return a full reel package, so a skeleton was saved to fill in; its answer is in the notes." : "No AI key is set up in HelixOS, so a skeleton was saved to fill in.";
    const text = [lead, hook ? `Picked hook: ${hook}` : "", cover ? `Cover: ${cover}` : "", l.onScreenText ? `On screen: ${l.onScreenText}` : "", flags.length ? `Before you post:\n${numbered(flags)}` : "Nothing to check: no unproven numbers, prices or names came through.", `Open it: ${linkTo(id)}`].filter(Boolean).join("\n\n");
    return {
      text,
      data: { id, generatedBy, keyword, topic, hooks: l.hookOptions, cover, onScreen: l.onScreenText, rungs: l.rungs.length, flags: l.reelFlags.map((f) => ({ kind: f.kind, text: f.text })), checks: checks.filter((c) => !c.ok).map((c) => ({ key: c.key, label: c.label, level: c.level })), link: linkTo(id) },
    };
  },
});
