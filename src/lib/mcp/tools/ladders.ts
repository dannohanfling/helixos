/**
 * The connector's Ladders tool for Make the graphic (rev 513): a member asks their Claude for the graphic of one of their
 * ladders, from one of their own photos or the suggested one, with the ladder's headline or an alternate. Through the same
 * function the ladder page uses (src/lib/graphic.ts), scoped to the member; nothing is deleted.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { graphicStep, makeGraphic } from "@/lib/graphic";
import { headlineChoices } from "@/lib/engine/graphic";

const member = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });

/** One of the member's ladders, by id or by words of its topic; one match or the choices named. */
async function ladderFor(v: Viewer, words: string) {
  const w = words.trim().toLowerCase();
  const rows = await db.query.ladders.findMany({ where: and(eq(schema.ladders.workspaceId, v.workspace.id), eq(schema.ladders.userId, v.user.id)) });
  const byId = rows.find((l) => l.id === w);
  if (byId) return byId;
  const some = rows.filter((l) => l.topic.toLowerCase().includes(w) || l.postName.toLowerCase().includes(w));
  if (some.length === 1) return some[0];
  if (!some.length) throw new Error(`No ladder matches "${words}". The member's ladders: ${rows.map((l) => l.topic).join("; ") || "none yet"}.`);
  throw new Error(`"${words}" fits ${some.length} ladders: ${some.map((l) => l.topic).join("; ")}. Say which.`);
}

export const ladderMakeGraphic = defineTool({
  name: "ladder_make_graphic",
  scope: "content",
  kind: "write",
  description: "Makes (or remakes) the headline graphic for one of the member's comment ladders in their approved template: their own photo (the suggested one unless a photo from their Images is named), the ladder's headline or one of its alternates, the badge from their Brand kit. Stored in their Images as a graphic and on the ladder. A face is never generated; a background may be, only from a photo already in their Images.",
  input: {
    ladder: z.string().min(1).max(200).describe("The ladder: its id, or words from its topic"),
    photo: z.string().max(80).optional().describe("An Images id of the member's own to use as the photo; omitted, the suggested photo; 'none' for a plain dark ground"),
    headline: z.string().max(300).optional().describe("The headline to draw: the ladder's own or one of its alternates, exactly as written"),
    strong_fade: z.boolean().optional().describe("A stronger fade for a bright or busy photo"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const m = member(v);
    const l = await ladderFor(v, String(input.ladder ?? ""));
    const step = await graphicStep(m, l.headline);
    const want = String(input.photo ?? "").trim();
    const photoId = want === "none" ? null : want ? (step.choices.find((c) => c.id === want)?.id ?? null) : step.suggestedId;
    if (want && want !== "none" && !photoId) throw new Error(`"${want}" is not one of the member's photos. Their choices: ${step.choices.map((c) => `${c.id} (${c.caption ?? c.kind})`).join("; ") || "none"}.`);
    const choices = headlineChoices(l.headline, l.altHeadlines);
    const headline = input.headline ? choices.find((h) => h === String(input.headline).trim()) : choices[0];
    if (!headline) throw new Error(`That headline is not the ladder's. Its choices: ${choices.join(" | ") || "none written yet"}.`);
    const r = await makeGraphic(m, l, { photoImageId: photoId, headline, strongFade: input.strong_fade === true, aiBackground: step.aiAllowed });
    if (!r.ok) throw new Error(r.error);
    return { text: `Made the graphic for "${l.topic}"${photoId ? ` on photo ${photoId}` : " on a plain ground"}, headline "${headline}". It is in Images (id ${r.imageId}) and on the ladder; Send to composer carries it.`, data: { ladderId: l.id, imageId: r.imageId, headline, photoImageId: photoId } };
  },
});
