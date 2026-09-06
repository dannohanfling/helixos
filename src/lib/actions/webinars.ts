"use server";

import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { WEBINAR_STATUSES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { VOICE, draft } from "@/lib/ai";
import { ACTS, READINESS_DIMENSIONS, SECTION_TEMPLATES, readinessScore } from "@/lib/engine/webinar";
import { award } from "@/lib/queries/points";
import { assetFor } from "@/lib/queries/library";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

async function own(webinarId: string, userId: string) {
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, webinarId), eq(schema.webinars.userId, userId)) });
  if (!w) throw new Error("Webinar not found");
  return w;
}

export async function createWebinarAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = newId();
  const title = str(formData, "title") || "Untitled webinar";
  await db.insert(schema.webinars).values({ id, workspaceId, userId, title, category: str(formData, "category") || "Live", promise: opt(formData, "promise") });
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => ({ id: newId(), webinarId: id, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, status: "todo" as const })),
  );
  await db.insert(schema.webinarBeliefs).values((["vehicle", "internal", "external"] as const).map((type) => ({ id: newId(), webinarId: id, type })));
  refresh();
  redirect(`/webinars/${id}?step=foundation`);
}

export async function updateWebinarFoundationAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  await db
    .update(schema.webinars)
    .set({
      title: str(formData, "title") || undefined,
      category: str(formData, "category") || undefined,
      audience: opt(formData, "audience"),
      coreProblem: opt(formData, "coreProblem"),
      desiredResult: opt(formData, "desiredResult"),
      promise: opt(formData, "promise"),
      mechanismName: opt(formData, "mechanismName"),
      ctaType: str(formData, "ctaType") || "Book a call",
      status: "building",
    })
    .where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=beliefs`);
}

export async function updateWebinarBeliefsAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  for (const type of ["vehicle", "internal", "external"] as const) {
    await db
      .update(schema.webinarBeliefs)
      .set({ fromBelief: opt(formData, `${type}_from`), toBelief: opt(formData, `${type}_to`), proof: opt(formData, `${type}_proof`), storyAssetId: opt(formData, `${type}_story`) })
      .where(and(eq(schema.webinarBeliefs.webinarId, id), eq(schema.webinarBeliefs.type, type)));
  }
  refresh();
  redirect(`/webinars/${id}?step=script`);
}

export async function updateSectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  await own(id, userId);
  const status = (["todo", "drafted", "final"] as const).find((s) => s === str(formData, "status"));
  const script = opt(formData, "script");
  const asset = await assetFor(workspaceId, userId, opt(formData, "assetId"));
  await db
    .update(schema.webinarSections)
    .set({
      script,
      keyPoints: opt(formData, "keyPoints"),
      transitionIn: opt(formData, "transitionIn"),
      transitionOut: opt(formData, "transitionOut"),
      assetId: asset?.id ?? null,
      durationMin: Math.max(1, num(formData, "durationMin") || 4),
      status: status ?? (script && script.length > 40 ? "drafted" : "todo"),
    })
    .where(and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)));
  refresh();
  const next = str(formData, "next");
  redirect(`/webinars/${id}?step=script&section=${next || sectionKey}`);
}

/** Drafts a section script. With Claude: from the foundation, belief map, chosen asset and the example. Without: adapts the example. */
export async function draftSectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  const w = await own(id, userId);
  const tpl = SECTION_TEMPLATES.find((t) => t.key === sectionKey);
  if (!tpl) return;
  const section = await db.query.webinarSections.findFirst({ where: and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)) });
  const asset = await assetFor(workspaceId, userId, section?.assetId);
  const beliefs = await db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, id) });
  const act = ACTS.find((a) => a.key === tpl.act)!;
  const belief = beliefs.find((b) => b.type === tpl.act);
  let text: string | null = null;
  if (str(formData, "mode") !== "example") {
    text = await draft(
      `You write webinar scripts for coaches using the Perfect Webinar structure (Opening Frame, Vehicle, Internal, External, Closing Frame). ${VOICE} Output only the spoken script for one section, 120 to 260 words, no headings.`,
      [
        `Webinar: ${w.title}`,
        `Audience: ${w.audience ?? "(not set)"}`,
        `Core problem: ${w.coreProblem ?? "(not set)"}`,
        `Promise: ${w.promise ?? "(not set)"}`,
        `Named mechanism: ${w.mechanismName ?? "(not set)"}`,
        `Desired result: ${w.desiredResult ?? "(not set)"}`,
        belief ? `Belief shift for this act: from "${belief.fromBelief ?? ""}" to "${belief.toBelief ?? ""}". Proof: ${belief.proof ?? ""}` : "",
        `Act: ${act.name}. Purpose: ${act.purpose}`,
        `Section: ${tpl.name}. Coaching: ${tpl.prompt}`,
        asset ? `Use this ${asset.type} from the library, adapted to the audience:\n${asset.body}` : "",
        section?.keyPoints ? `Key points the coach wants covered:\n${section.keyPoints}` : "",
        `Here is an example of this section from a different webinar, for structure only (do not copy its facts):\n${tpl.exampleScript}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  if (!text) {
    const swap = (s: string) => s.replace(/Synchronized Journey( Framework)?/g, w.mechanismName ?? "[your mechanism]").replace(/75 minutes/g, "60 minutes");
    text = `${swap(tpl.exampleScript)}\n\n[Example from The Leaky Webinar. Rewrite in your words: your audience is "${w.audience ?? "…"}", your promise is "${w.promise ?? "…"}".]`;
  }
  await db
    .update(schema.webinarSections)
    .set({ script: text, status: "drafted", keyPoints: section?.keyPoints ?? tpl.exampleKeyPoints })
    .where(and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)));
  refresh();
  redirect(`/webinars/${id}?step=script&section=${sectionKey}`);
}

export async function linkOfferAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  const offerId = opt(formData, "offerId");
  if (offerId) {
    const offer = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, offerId), eq(schema.offers.userId, userId)) });
    if (!offer) return;
  }
  await db.update(schema.webinars).set({ offerId, ctaType: str(formData, "ctaType") || "Book a call" }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=deck`);
}

export async function saveReadinessAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  const ratings: Record<string, number> = {};
  for (const d of READINESS_DIMENSIONS) ratings[d.key] = Math.max(0, Math.min(5, num(formData, `r_${d.key}`)));
  const r = readinessScore(ratings);
  await db.insert(schema.readinessReviews).values({ id: newId(), webinarId: id, ratings, score: r.score, verdict: r.verdict, biggestGaps: opt(formData, "biggestGaps"), nextActions: opt(formData, "nextActions") });
  if (r.verdict === "ready") await db.update(schema.webinars).set({ status: "ready" }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=${r.verdict === "ready" ? "run" : "review"}`);
}

export async function updateRunAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const w = await own(id, userId);
  const status = WEBINAR_STATUSES.find((s) => s === str(formData, "status")) ?? w.status;
  const scheduled = opt(formData, "scheduledAt");
  await db
    .update(schema.webinars)
    .set({
      scheduledAt: scheduled,
      registrationUrl: opt(formData, "registrationUrl"),
      replayUrl: opt(formData, "replayUrl"),
      deckUrl: opt(formData, "deckUrl"),
      registered: num(formData, "registered"),
      showed: num(formData, "showed"),
      offersMade: num(formData, "offersMade"),
      callsBooked: num(formData, "callsBooked"),
      sales: num(formData, "sales"),
      revenue: num(formData, "revenue"),
      debriefLeak: opt(formData, "debriefLeak"),
      debriefFix: opt(formData, "debriefFix"),
      debriefWins: opt(formData, "debriefWins"),
      status: status === "ready" && scheduled ? "scheduled" : status,
    })
    .where(eq(schema.webinars.id, id));
  if (status === "delivered" && w.status !== "delivered") {
    await award({ workspaceId, userId }, "bonus", 200, `Delivered webinar: ${w.title}`, `webinar:${id}`);
  }
  refresh();
}

export async function deleteWebinarAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  await db.delete(schema.webinars).where(eq(schema.webinars.id, id));
  refresh();
  redirect("/webinars");
}

export async function duplicateExampleAction(): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const example = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, userId), eq(schema.webinars.isExample, true)) });
  const id = newId();
  await db.insert(schema.webinars).values({ id, workspaceId, userId, title: "My webinar (from the example)", status: "building", audience: example?.audience, promise: example?.promise, mechanismName: example?.mechanismName, coreProblem: example?.coreProblem, desiredResult: example?.desiredResult });
  const sections = example ? await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, example.id), orderBy: asc(schema.webinarSections.order) }) : [];
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => {
      const ex = sections.find((s) => s.sectionKey === t.key);
      return { id: newId(), webinarId: id, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, keyPoints: ex?.keyPoints ?? t.exampleKeyPoints, script: ex?.script ?? t.exampleScript, status: "drafted" as const };
    }),
  );
  await db.insert(schema.webinarBeliefs).values((["vehicle", "internal", "external"] as const).map((type) => ({ id: newId(), webinarId: id, type })));
  refresh();
  redirect(`/webinars/${id}?step=foundation`);
}

export async function createAssetAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const type = (["story", "analogy", "objection", "belief"] as const).find((t) => t === str(formData, "type")) ?? "story";
  const name = str(formData, "name");
  const body = str(formData, "body");
  if (!name || !body) return;
  await db.insert(schema.libraryAssets).values({ id: newId(), workspaceId, userId, type, name, body, summary: opt(formData, "summary"), useWhen: opt(formData, "useWhen"), reframe: opt(formData, "reframe"), proof: opt(formData, "proof"), tag: opt(formData, "tag") });
  refresh();
  const back = str(formData, "back");
  if (back.startsWith("/")) redirect(back);
}

export async function touchWebinarAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  await db.update(schema.webinars).set({ notes: opt(formData, "notes") ?? nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
}
