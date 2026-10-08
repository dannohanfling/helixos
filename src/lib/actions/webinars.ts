"use server";

import { readMoney } from "@/lib/engine/money";
import { deletedTo } from "@/lib/deleted";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { WEBINAR_STATUSES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draftFull } from "@/lib/ai";
import { ACTS, applyOverride, DERIVED_DIMENSIONS, derivedGrades, draftShape, freeTextProofUsable, ORIGIN_BEATS, READINESS_DIMENSIONS, readinessScore, readyDecision, SECTION_TEMPLATES, type Override } from "@/lib/engine/webinar";
import { buildFor, contextFor, presenterOf } from "@/lib/queries/webinar";
import { fillRuntime } from "@/lib/engine/subject";
import { award } from "@/lib/queries/points";
import { assetFor } from "@/lib/queries/library";
import { ctx, num, opt, optNum, refresh, str } from "@/lib/action-helpers";
import { originAfterAccept, originAfterSave, sectionGate } from "@/lib/engine/provenance";
import { recordConfirm } from "@/lib/provenance";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { SLIDES_MARK, checkSlides, deckSafe, keyPointsText, needsSlides, offerBlock, parseSectionDraft, slideLines, slidesInstruction, slidesOnlyTask } from "@/lib/engine/section-draft";
import { evidenceLines, insertText } from "@/lib/engine/evidence";
import { essenceFor } from "@/lib/queries/essence";
import { citableEvidence } from "@/lib/queries/evidence";
import { draftAvatarBrief } from "@/lib/avatars";

async function own(webinarId: string, userId: string) {
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, webinarId), eq(schema.webinars.userId, userId)) });
  if (!w) throw new Error("Webinar not found");
  return w;
}

export async function createWebinarAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
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
  const { userId } = await ctx({ team: "allow" });
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
      mechanismWaivedReason: opt(formData, "mechanismWaivedReason"),
      presenter: opt(formData, "presenter"),
      stayLine: opt(formData, "stayLine"),
      promiseLine: opt(formData, "promiseLine"),
      chatPrompt: opt(formData, "chatPrompt"),
      groundRule: opt(formData, "groundRule"),
      outcomes: [str(formData, "outcome1"), str(formData, "outcome2"), str(formData, "outcome3")].map((o) => o.trim()).filter(Boolean),
      sessionGoal: opt(formData, "sessionGoal"),
      permissionLine: opt(formData, "permissionLine"),
      reflectionPrompt: opt(formData, "reflectionPrompt"),
      footerBar: formData.get("footerBar") === "on",
      footerBrand: opt(formData, "footerBrand"),
      ctaBar: formData.get("ctaBar") === "on",
      originStory: Object.fromEntries(ORIGIN_BEATS.map((b) => [b.key, str(formData, `beat_${b.key}`)]).filter(([, v]) => v)),
      ctaType: str(formData, "ctaType") || "Book a call",
      status: "building",
      updatedAt: nowIso(),
    })
    .where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=beliefs`);
}

export async function updateWebinarBeliefsAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  await own(id, userId);
  const existing = await db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, id) });
  let saved = 0;
  for (const type of ["vehicle", "internal", "external"] as const) {
    const was = existing.find((b) => b.type === type);
    const proof = opt(formData, `${type}_proof`);
    const who = opt(formData, `${type}_proofWho`);
    const ticked = formData.get(`${type}_permission`) === "on";
    const changed = (proof ?? "") !== (was?.proof ?? "");
    // Tick two for the free-text proof: recorded when ticked with a name; cleared when the text changes without a fresh tick.
    const permission = proof && ticked && who ? { proofPermissionAt: nowIso(), proofPermissionBy: userId } : changed || !proof ? { proofPermissionAt: null, proofPermissionBy: null } : {};
    await db
      .update(schema.webinarBeliefs)
      .set({
        fromBelief: opt(formData, `${type}_from`),
        toBelief: opt(formData, `${type}_to`),
        proof,
        proofWho: who,
        proofChangedAt: changed ? nowIso() : was?.proofChangedAt ?? null,
        ...permission,
        proofId: opt(formData, `${type}_proofId`),
        storyAssetId: opt(formData, `${type}_story`),
        evidenceId: opt(formData, `${type}_evidence`),
        proofRepeat: formData.get(`${type}_proofRepeat`) === "on",
      })
      .where(and(eq(schema.webinarBeliefs.webinarId, id), eq(schema.webinarBeliefs.type, type)));
    // "Add this to my Proof Bank": a draft with the tick already recorded, approved on the proof page like every other proof, never here.
    if (proof && who && ticked && formData.get(`${type}_toBank`) === "on") {
      await db.insert(schema.proofs).values({ id: newId(), workspaceId, userId, name: `${who}: ${proof.slice(0, 60)}`, type: "result", who, resultAfter: proof, longVersion: proof, beliefBroken: type, status: "draft", permissionAt: nowIso(), permissionBy: userId });
      saved++;
    }
  }
  await db.update(schema.webinars).set({ updatedAt: nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=script${saved ? `&toBank=${saved}` : ""}`);
}

export async function updateSectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  await own(id, userId);
  const status = (["todo", "drafted", "final", "omitted"] as const).find((s) => s === str(formData, "status"));
  const script = opt(formData, "script");
  const asset = await assetFor(workspaceId, userId, opt(formData, "assetId"));
  const before = await db.query.webinarSections.findFirst({ where: and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)) });
  await db
    .update(schema.webinarSections)
    .set({
      script,
      // A changed script is the coach's review of it; an unchanged one keeps its mark, whatever else on the form moved.
      origin: originAfterSave(before?.origin, before?.script, script),
      keyPoints: opt(formData, "keyPoints"),
      transitionIn: opt(formData, "transitionIn"),
      transitionOut: opt(formData, "transitionOut"),
      deliveryNote: opt(formData, "deliveryNote"),
      assetId: asset?.id ?? null,
      durationMin: Math.max(1, num(formData, "durationMin") || 4),
      status: status ?? (script && script.length > 40 ? "drafted" : "todo"),
      buildStyle: str(formData, "buildStyle") === "reveal" ? "reveal" : "none",
    })
    .where(and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)));
  await db.update(schema.webinars).set({ updatedAt: nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
  const next = str(formData, "next");
  // The saved section is named, so its draft is let go though the page moves on to the next one.
  redirect(`/webinars/${id}?step=script&section=${next || sectionKey}&savedSection=${sectionKey}`);
}

/** Drafts a section script. With Claude: from the foundation, belief map, chosen asset and the example. Without: adapts the example. */
export async function draftSectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  const w = await own(id, userId);
  const tpl = SECTION_TEMPLATES.find((t) => t.key === sectionKey);
  if (!tpl) return;
  const allSections = await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, id) });
  const section = allSections.find((s) => s.sectionKey === sectionKey);
  const asset = await assetFor(workspaceId, userId, section?.assetId);
  // Numbers the record knows are never left to the model: the session's runtime and this section's slot come from the sections.
  const runtime = allSections.reduce((a, s) => a + s.durationMin, 0);
  const openingMinutes = allSections.filter((s) => s.act === "opening").reduce((a, s) => a + s.durationMin, 0);
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { name: true } });
  const presenter = presenterOf(w, owner?.name ?? "");
  const beliefs = await db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, id) });
  const act = ACTS.find((a) => a.key === tpl.act)!;
  const belief = beliefs.find((b) => b.type === tpl.act);
  // The picked proof is an approved row of the bank, the same rows the ladder reads; a draft can never get here.
  const picked = belief?.proofId ? await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, belief.proofId), eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) }) : null;
  const citable = await citableEvidence(userId);
  const evidence = evidenceLines(citable);
  const evidenceLine = evidence.length ? `Verified research on the coach's shelf, each line a claim and its citation to be used together, and the only studies that may be cited:\n${evidence.join("\n")}` : "No verified research is on the coach's shelf: cite no study; write [EVIDENCE PLACEHOLDER] where one would help.";
  // The study picked for this act, confirmed by definition (only citable studies are offered); the story, from the bank or the client's Essence.
  const pickedStudy = belief?.evidenceId ? citable.find((e) => (e.source === "shared" ? `shared:${e.id}` : e.id) === belief.evidenceId) : null;
  const studyLine = pickedStudy ? `Evidence for this act, claim and citation together: ${insertText(pickedStudy)}` : "";
  const essenceStories = (await essenceFor(workspaceId, userId)).representative_stories?.stories as { name: string; summary: string; when_to_use: string }[] | undefined;
  const essenceStory = belief?.storyAssetId?.startsWith("essence:") ? essenceStories?.[Number(belief.storyAssetId.slice(8))] : null;
  const storyLine = essenceStory ? `The coach's own story that carries this act (from their Essence): ${essenceStory.name}. ${essenceStory.summary}` : "";
  // A free-text proof reaches the script only with tick two, or when written before the tick existed.
  const freeText = belief && freeTextProofUsable(belief) ? belief.proof : null;
  const proofLine = picked ? `Approved proof, use it verbatim with first name and last initial: ${picked.who ?? picked.name}: "${picked.longVersion ?? picked.shortVersion ?? picked.resultAfter ?? ""}"` : freeText ? `Proof${belief?.proofWho ? ` (${belief.proofWho})` : ""}: ${freeText}` : "No usable proof for this act: write [PROOF PLACEHOLDER] where one belongs. Never invent one.";
  // A section the coach already gave key points keeps them: the draft writes only the script. Otherwise it writes the deck lines too
  // (first-deck brief §2), so a drafted webinar exports with slides in every act.
  const minutes = section?.durationMin ?? tpl.durationMin;
  const ownPoints = Boolean(section?.keyPoints?.trim());
  // The closing frame presents the offer: it gets the record's own stack and price, the same the deck shows, or a placeholder.
  const offerLine = tpl.act === "closing" ? offerBlock((await contextFor(w)).sections.find((s) => s.offer)?.offer ?? null) : "";
  // Who it's for: the offer's main avatar (else the Primary), in the member's own words, never added to (rev 501 §6).
  const avatarLine = await draftAvatarBrief({ workspaceId, userId }, w.offerId);
  let text: string | null = null;
  let material = "";
  if (str(formData, "mode") !== "example") {
    const task = `You write webinar scripts using the Perfect Webinar structure (Opening Frame, Vehicle, Internal, External, Closing Frame). Output the spoken script for one section, 120 to 260 words, no headings. The script is spoken by the presenter named below, in their first person; never introduce anyone else, and never state a credential, a number of years or a statistic that is not in the material given.${ownPoints ? " Output only the script." : ` ${slidesInstruction(minutes)}`}`;
    material = [
        `Webinar: ${w.title}`,
        `Presenter: ${presenter}. Write as ${presenter}.`,
        `Session runtime: ${runtime} minutes in total; this section has ${section?.durationMin ?? tpl.durationMin} minutes.`,
        `Audience: ${w.audience ?? "(not set)"}`,
        avatarLine,
        `Core problem: ${w.coreProblem ?? "(not set)"}`,
        `Promise: ${w.promise ?? "(not set)"}`,
        `Named mechanism: ${w.mechanismName ?? "(not set)"}`,
        `Desired result: ${w.desiredResult ?? "(not set)"}`,
        belief ? `Belief shift for this act: from "${belief.fromBelief ?? ""}" to "${belief.toBelief ?? ""}". ${proofLine}` : "",
        evidenceLine,
        studyLine,
        storyLine,
        // The example's shape, never its words: nothing of the Leaky Webinar's script is in the prompt to be echoed.
        ...draftShape(tpl, section?.durationMin ?? tpl.durationMin, act, fillRuntime(tpl.prompt, { runtime, openingMinutes })),
        asset ? `Use this ${asset.type} from the library, adapted to the audience:\n${asset.body}` : "",
        offerLine,
        section?.keyPoints ? `Key points the coach wants covered:\n${section.keyPoints}` : "",
      ]
      .filter(Boolean)
      .join("\n\n");
    const out = await draftCompletely(task, material, "webinar_section");
    if (out === "cut") {
      refresh();
      redirect(`/webinars/${id}?step=script&section=${sectionKey}&draftError=${encodeURIComponent("The draft came back cut off twice, so nothing was saved. Press it again, or write this section yourself.")}`);
    }
    text = out;
  }
  // No model, or the example asked for: nothing is written. The example is shown beside the field, for shape, and never becomes a value.
  if (!text) {
    refresh();
    redirect(`/webinars/${id}?step=script&section=${sectionKey}&example=1`);
  }
  // A fabricated statistic the model wrote comes out, and the page says what went and why. The coach's own words are never edited here.
  const parsed = parseSectionDraft(text);
  const stripped = stripFabricated(parsed.script);
  const note = stripNote(stripped.removed);
  // The deck lines: only where the coach had none, each through the same checks as the script, a figure only from the record.
  const lines = ownPoints || !parsed.slides ? [] : deckSafe(checkSlides(parsed.slides.filter((l) => !stripFabricated(l).removed.length), `${material}\n${stripped.text}`).kept, section?.name ?? tpl.name);
  await db
    .update(schema.webinarSections)
    .set({ script: stripped.text, status: "drafted", keyPoints: ownPoints ? section!.keyPoints : lines.length ? keyPointsText(lines) : null, origin: "ai_unreviewed" })
    .where(and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)));
  await db.update(schema.webinars).set({ updatedAt: nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=script&section=${sectionKey}${note ? `&stripped=${encodeURIComponent(note)}` : ""}`);
}

/** Output budgets for a section draft: the first ask, and the one retry when an answer comes back cut off at the budget. */
const DRAFT_BUDGET = 4000;
const DRAFT_RETRY_BUDGET = 8000;

/**
 * A draft that is whole or nothing: an answer cut off at the output budget is asked for once more with a larger one, and if that
 * is cut too the caller says so rather than keep half a sentence (the Offer Stack draft that ended "…what I've built, and").
 */
async function draftCompletely(task: string, material: string, feature: string, budget = DRAFT_BUDGET): Promise<string | null | "cut"> {
  let out = await draftFull(task, material, budget, { feature });
  if (out?.cut) out = await draftFull(task, material, Math.max(DRAFT_RETRY_BUDGET, budget * 2), { feature });
  if (!out) return null;
  return out.cut ? "cut" : out.text;
}

/**
 * "Make slides from my script" (first-deck brief §2): a section with words to speak and no key points gets its deck lines from
 * its own script, one per slide, a figure only where the script has it. A section that has key points keeps them.
 */
export async function makeSlidesAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  const w = await own(id, userId);
  const section = await db.query.webinarSections.findFirst({ where: and(eq(schema.webinarSections.webinarId, w.id), eq(schema.webinarSections.sectionKey, sectionKey)) });
  const back = `/webinars/${w.id}?step=script&section=${sectionKey}`;
  if (!section?.script?.trim()) redirect(`${back}&draftError=${encodeURIComponent("This section has no script yet to make slides from.")}`);
  if (section.keyPoints?.trim()) redirect(`${back}&draftError=${encodeURIComponent("This section already has key points; the deck reads those.")}`);
  const out = await draftCompletely(slidesOnlyTask(section.durationMin), `Webinar: ${w.title}\n\nSection: ${section.name}\n\nScript:\n${section.script}`, "webinar_section", 1500);
  if (out === "cut" || !out) redirect(`${back}&draftError=${encodeURIComponent(out === "cut" ? "The slides came back cut off twice, so nothing was saved. Press it again." : "No AI key is working for you right now: type one idea per line in Key points instead.")}`);
  const at = out.indexOf(SLIDES_MARK);
  const lines = deckSafe(checkSlides(slideLines(at >= 0 ? out.slice(at + SLIDES_MARK.length) : out).filter((l) => !stripFabricated(l).removed.length), section.script).kept, section.name);
  if (!lines.length) redirect(`${back}&draftError=${encodeURIComponent("Nothing usable came back. Press it again, or type one idea per line in Key points.")}`);
  await db.update(schema.webinarSections).set({ keyPoints: keyPointsText(lines) }).where(eq(schema.webinarSections.id, section.id));
  await db.update(schema.webinars).set({ updatedAt: nowIso() }).where(eq(schema.webinars.id, w.id));
  refresh();
  redirect(`${back}&slides=${lines.length}`);
}

/**
 * "Make slides for every section" (deck re-test §5, 7 Oct): every section with a script and no key points, in order, the same
 * way one press does one section, skipping any that already has points. The request has a time budget; what is not reached
 * before it runs out is left for the next press, and the Deck step says how many are left.
 */
export async function makeAllSlidesAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const w = await own(id, userId);
  const sections = (await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: [asc(schema.webinarSections.order)] })).filter((x) => needsSlides(x));
  const started = Date.now();
  let made = 0;
  let failed = 0;
  for (const section of sections) {
    if (Date.now() - started > MAKE_ALL_BUDGET_MS) break;
    const out = await draftCompletely(slidesOnlyTask(section.durationMin), `Webinar: ${w.title}\n\nSection: ${section.name}\n\nScript:\n${section.script}`, "webinar_section", 1500);
    if (out === "cut" || !out) {
      failed++;
      continue;
    }
    const at = out.indexOf(SLIDES_MARK);
    const lines = deckSafe(checkSlides(slideLines(at >= 0 ? out.slice(at + SLIDES_MARK.length) : out).filter((l) => !stripFabricated(l).removed.length), section.script!).kept, section.name);
    if (!lines.length) {
      failed++;
      continue;
    }
    await db.update(schema.webinarSections).set({ keyPoints: keyPointsText(lines) }).where(eq(schema.webinarSections.id, section.id));
    made++;
  }
  if (made) await db.update(schema.webinars).set({ updatedAt: nowIso() }).where(eq(schema.webinars.id, w.id));
  const left = sections.length - made - failed;
  refresh();
  redirect(`/webinars/${w.id}?step=deck&made=${made}&failed=${failed}&left=${left}`);
}

/** How long one "Make slides for every section" request works before handing the rest to the next press: under the route's minute. */
const MAKE_ALL_BUDGET_MS = 40_000;

/** Accept: the coach has read this one AI-drafted script and keeps it as it is. One section per click; nothing accepts more than one. */
export async function acceptSectionAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const sectionKey = str(formData, "sectionKey");
  await own(id, userId);
  const section = await db.query.webinarSections.findFirst({ where: and(eq(schema.webinarSections.webinarId, id), eq(schema.webinarSections.sectionKey, sectionKey)) });
  if (!section) return;
  await db.update(schema.webinarSections).set({ origin: originAfterAccept(section.origin) }).where(eq(schema.webinarSections.id, section.id));
  refresh();
  redirect(`/webinars/${id}?step=script&section=${sectionKey}`);
}

/**
 * Continue anyway on the deck export: the coach saw which sections are AI drafts nobody reviewed and chose to export. The
 * choice is logged with who and when and the sections named, and the Deck step then offers the files under that confirm's id,
 * which the route checks before it serves. A clean webinar needs no confirm and gets none.
 */
export async function confirmDeckExportAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  await own(id, userId);
  const sections = await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, id) });
  const gate = sectionGate(sections);
  if (!gate) redirect(`/webinars/${id}?step=deck`);
  const confirmed = await recordConfirm({ workspaceId, userId, userName: v.user.name }, "deck_export", id, gate.items);
  refresh();
  redirect(`/webinars/${id}?step=deck&confirmed=${confirmed}`);
}

export async function linkOfferAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  await own(id, userId);
  const offerId = opt(formData, "offerId");
  if (offerId) {
    const offer = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, offerId), eq(schema.offers.userId, userId)) });
    if (!offer) return;
  }
  await db.update(schema.webinars).set({ offerId, ctaType: str(formData, "ctaType") || "Book a call", updatedAt: nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=deck`);
}

export async function saveReadinessAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const w = await own(id, userId);
  const { build, derived } = await buildFor(w);
  // Three grades come from the record, shown with their working; the coach may lower one with a reason, never raise it.
  const ratings: Record<string, number> = {};
  const overrides: Record<string, Override> = {};
  const graded = derivedGrades(derived);
  for (const d of READINESS_DIMENSIONS) {
    const g = (DERIVED_DIMENSIONS as readonly string[]).includes(d.key) ? graded.find((x) => x.key === d.key) : undefined;
    if (!g) {
      ratings[d.key] = Math.max(0, Math.min(5, num(formData, `r_${d.key}`)));
      continue;
    }
    const value = num(formData, `o_${d.key}`);
    const reason = str(formData, `o_${d.key}_reason`);
    if (value && reason) overrides[d.key] = { value, reason };
    ratings[d.key] = applyOverride(g, overrides[d.key]);
  }
  const r = readinessScore(ratings);
  await db.insert(schema.readinessReviews).values({ id: newId(), webinarId: id, ratings, overrides, score: r.score, verdict: r.verdict, biggestGaps: opt(formData, "biggestGaps"), nextActions: opt(formData, "nextActions") });
  // The rating alone never sets the status: ready is the record's must-checks passing and the rating passing, together.
  const decision = readyDecision(r, build);
  if (decision.ready && (w.status === "draft" || w.status === "building")) await db.update(schema.webinars).set({ status: "ready" }).where(eq(schema.webinars.id, id));
  refresh();
  redirect(`/webinars/${id}?step=${decision.ready ? "run" : "review"}`);
}

export async function updateRunAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const w = await own(id, userId);
  const chosen = WEBINAR_STATUSES.find((s) => s === str(formData, "status")) ?? w.status;
  const scheduled = opt(formData, "scheduledAt");
  // Ready or scheduled is refused while a must-check is open, and the Run step says which; the other fields still save.
  const { build } = await buildFor(w);
  const held = (chosen === "ready" || chosen === "scheduled") && chosen !== w.status && build.must.length > 0;
  // Revenue the way people write it (rev 444): "4.5k" is 4500, never 4.5; one that can't be read is refused beside its box.
  const revenue = readMoney(str(formData, "revenue"));
  if ("error" in revenue) redirect(`/webinars/${id}?step=run&runError=${encodeURIComponent(revenue.error)}&field=revenue`);
  const status = held ? w.status : chosen;
  await db
    .update(schema.webinars)
    .set({
      scheduledAt: scheduled,
      registrationUrl: opt(formData, "registrationUrl"),
      replayUrl: opt(formData, "replayUrl"),
      deckUrl: opt(formData, "deckUrl"),
      registered: optNum(formData, "registered"),
      showed: optNum(formData, "showed"),
      offersMade: optNum(formData, "offersMade"),
      callsBooked: optNum(formData, "callsBooked"),
      sales: optNum(formData, "sales"),
      revenue: revenue.value,
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
  if (held) redirect(`/webinars/${id}?step=run&held=${chosen}`);
}

export async function deleteWebinarAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  await own(id, userId);
  await db.delete(schema.webinars).where(eq(schema.webinars.id, id));
  refresh();
  redirect(deletedTo("/webinars", "webinar"));
}

/**
 * Start from the example: the example's shape, never its words. The sections arrive named, in order and empty, and the
 * Foundation is empty too; the worked example stays readable in place, which is where it does its work. Example content
 * copied into a record as a value ships later as the coach's own claim, so none is.
 */
export async function duplicateExampleAction(): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = newId();
  await db.insert(schema.webinars).values({ id, workspaceId, userId, title: "My webinar", status: "building" });
  await db.insert(schema.webinarSections).values(
    SECTION_TEMPLATES.map((t) => ({ id: newId(), webinarId: id, sectionKey: t.key, act: t.act, order: t.order, name: t.name, durationMin: t.durationMin, keyPoints: null, script: null, status: "todo" as const })),
  );
  await db.insert(schema.webinarBeliefs).values((["vehicle", "internal", "external"] as const).map((type) => ({ id: newId(), webinarId: id, type })));
  refresh();
  redirect(`/webinars/${id}?step=foundation`);
}

export async function createAssetAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
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
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  await own(id, userId);
  await db.update(schema.webinars).set({ notes: opt(formData, "notes") ?? nowIso() }).where(eq(schema.webinars.id, id));
  refresh();
}
