"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SOCRATES_SCRIPT_TYPES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { CLARITY_BEATS, MAX_FOLLOW_UPS, NEPQ_CATEGORIES, SPOKEN_REFRAMES, REFRAME_BEAT, assemble, beatByKey, beatByStage, beatOf, noBrackets, placeholdersOf } from "@/lib/engine/socrates";
import { visibleQuestions, ownScript } from "@/lib/queries/socrates";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

const scriptType = (fd: FormData) => SOCRATES_SCRIPT_TYPES.find((t) => t === str(fd, "scriptType"));
const stageOf = (fd: FormData) => beatByStage(str(fd, "clarityStage"))?.stage;
const typesOf = (fd: FormData) => fd.getAll("scriptTypes").map(String).filter((t): t is (typeof SOCRATES_SCRIPT_TYPES)[number] => (SOCRATES_SCRIPT_TYPES as readonly string[]).includes(t));

/** A client's own question: theirs, scoped to them, never touched by a library update. */
export async function addQuestionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const question = str(formData, "question");
  const stage = stageOf(formData);
  const types = typesOf(formData);
  if (!question || !stage) return;
  const nepq = NEPQ_CATEGORIES.find((c) => c === str(formData, "nepqCategory")) ?? null;
  await db.insert(schema.socratesQuestions).values({ id: newId(), key: null, workspaceId, userId, question, clarityStage: stage, nepqCategory: nepq, source: "Mine", scriptTypes: types });
  refresh();
  redirect(`/socrates/questions?stage=${encodeURIComponent(stage)}`);
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.socratesQuestions).where(and(eq(schema.socratesQuestions.id, str(formData, "id")), eq(schema.socratesQuestions.userId, userId)));
  refresh();
}

export async function createScriptAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  const type = scriptType(formData);
  if (!name || !type) return;
  const id = newId();
  await db.insert(schema.socratesScripts).values({ id, workspaceId, userId, name, scriptType: type, beats: {} });
  refresh();
  redirect(`/socrates/scripts/${id}?beat=${CLARITY_BEATS[0].key}`);
}

export async function updateScriptAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const s = await ownScript(str(formData, "id"), userId);
  if (!s) return;
  await db
    .update(schema.socratesScripts)
    .set({ name: str(formData, "name") || s.name, scriptType: scriptType(formData) ?? s.scriptType, updatedAt: nowIso() })
    .where(eq(schema.socratesScripts.id, s.id));
  refresh();
}

/**
 * One beat: the question and up to two follow-ups (only questions this client can see, the question first), the client's own
 * "listen for" note, the branches if they push back (spoken reframes only), and the client's own words.
 */
export async function saveBeatAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const s = await ownScript(str(formData, "id"), userId);
  const beat = beatByKey(str(formData, "beat"));
  if (!s || !beat) return;
  const visible = new Set((await visibleQuestions(userId)).map((q) => q.id));
  const primary = str(formData, "primary");
  // Follow-ups follow a question: with none picked there is nothing to follow, so none are kept; a repeated id is one id.
  const followUps = visible.has(primary) ? Array.from(new Set(formData.getAll("followUpIds").map(String))).filter((id) => id !== primary && visible.has(id)).slice(0, MAX_FOLLOW_UPS) : [];
  const questionIds = [...(visible.has(primary) ? [primary] : []), ...followUps];
  // Reframes are deployed at one beat of an Objection script; picks sent for any other beat are dropped.
  const reframeIds = s.scriptType === "Objection" && beat.key === REFRAME_BEAT ? formData.getAll("reframeIds").map(String).filter((id) => SPOKEN_REFRAMES.some((r) => r.id === id)) : [];
  // A principle is never a branch: the id list is checked against the spoken set, whatever the form sent.
  const branchIds = formData.getAll("branchIds").map(String).filter((id) => SPOKEN_REFRAMES.some((r) => r.id === id));
  const beats = { ...s.beats, [beat.key]: { ...beatOf(s.beats, beat.key), questionIds, reframeIds, override: opt(formData, "override"), listenFor: opt(formData, "listenFor"), branchIds } };
  await db.update(schema.socratesScripts).set({ beats, updatedAt: nowIso() }).where(eq(schema.socratesScripts.id, s.id));
  refresh();
  const next = str(formData, "next");
  redirect(`/socrates/scripts/${s.id}?beat=${next === "fill" ? "fill" : (beatByKey(next)?.key ?? beat.key)}`);
}

/** The blanks, filled once each by key. Only keys the script actually carries are kept, so a stale fill never lingers. */
export async function saveFillsAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const s = await ownScript(str(formData, "id"), userId);
  if (!s) return;
  const keys = placeholdersOf(assemble(s.beats, await visibleQuestions(userId)));
  const fills: Record<string, string> = {};
  for (const k of keys) {
    const v = noBrackets(str(formData, `fill:${k}`)).trim();
    if (v) fills[k] = v;
  }
  await db.update(schema.socratesScripts).set({ fills, updatedAt: nowIso() }).where(eq(schema.socratesScripts.id, s.id));
  refresh();
  redirect(`/socrates/scripts/${s.id}?beat=fill`);
}

export async function deleteScriptAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.socratesScripts).where(and(eq(schema.socratesScripts.id, str(formData, "id")), eq(schema.socratesScripts.userId, userId)));
  refresh();
  redirect("/socrates/scripts");
}

