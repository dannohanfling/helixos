"use server";

/**
 * Hermes's settings, per webinar (Webinars → Magic funnel → HelixOS pages): "Host pages in HelixOS" (a coach's own webinars
 * only, for now Danno's), the thank-you video and the Meta Pixel. Before the migration is on this database the save says so and
 * changes nothing.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { mfAvailable } from "@/lib/mf/data";
import { hermesPages } from "@/db/schema-hermes";
import { cleanPixelId, youtubeEmbed } from "@/lib/hermes/rules";

export async function saveHermesAction(fd: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HelixOS pages are the member's own settings." });
  const webinarId = str(fd, "webinarId");
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, webinarId), eq(schema.webinars.workspaceId, workspaceId), eq(schema.webinars.userId, userId)), columns: { id: true } });
  if (!w) redirect("/webinars");
  const back = `/webinars/${w.id}/helixos-pages`;
  if (!mfAvailable(v.membership)) redirect(`${back}?held=${encodeURIComponent("the Magic funnel isn't switched on for you yet")}`);

  const videoRaw = str(fd, "videoUrl");
  const pixelRaw = str(fd, "pixelId");
  const problems: string[] = [];
  if (videoRaw && !youtubeEmbed(videoRaw)) problems.push("the video link isn't a YouTube link");
  if (pixelRaw && !cleanPixelId(pixelRaw)) problems.push("the Pixel ID should be digits only");
  // For now only a coach turns a webinar's HelixOS pages on (Danno, 13 Oct): built for any member, switched on for his account.
  const hostOn = v.role === "coach" && fd.get("hostOn") === "on";
  const values = {
    hostOn,
    videoUrl: videoRaw && youtubeEmbed(videoRaw) ? videoRaw.slice(0, 300) : null,
    pixelId: cleanPixelId(pixelRaw),
    pixelOn: fd.get("pixelOn") === "on" && Boolean(cleanPixelId(pixelRaw)),
    updatedAt: nowIso(),
  };
  try {
    await db
      .insert(hermesPages)
      .values({ id: newId(), workspaceId, userId, webinarId: w.id, ...values })
      .onConflictDoUpdate({ target: hermesPages.webinarId, set: values, setWhere: and(eq(hermesPages.workspaceId, workspaceId), eq(hermesPages.userId, userId)) });
  } catch {
    redirect(`${back}?held=table`);
  }
  redirect(`${back}?${problems.length ? `held=${encodeURIComponent(problems.join("; "))}` : "saved=1"}`);
}
