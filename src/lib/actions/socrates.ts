"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SOCRATES_SCRIPT_TYPES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { CLARITY_BEATS, NEPQ_CATEGORIES, REFRAMES, REFRAME_BEAT, beatByKey, beatByStage, beatOf } from "@/lib/engine/socrates";
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

/** One beat: the library picks (only questions this client can see, and reframes that exist) and the client's own words. */
export async function saveBeatAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const s = await ownScript(str(formData, "id"), userId);
  const beat = beatByKey(str(formData, "beat"));
  if (!s || !beat) return;
  const visible = new Set((await visibleQuestions(userId)).map((q) => q.id));
  const questionIds = formData.getAll("questionIds").map(String).filter((id) => visible.has(id));
  // Reframes are deployed at one beat of an Objection script; picks sent for any other beat are dropped.
  const reframeIds = s.scriptType === "Objection" && beat.key === REFRAME_BEAT ? formData.getAll("reframeIds").map(String).filter((id) => REFRAMES.some((r) => r.id === id)) : [];
  const beats = { ...s.beats, [beat.key]: { ...beatOf(s.beats, beat.key), questionIds, reframeIds, override: opt(formData, "override") } };
  await db.update(schema.socratesScripts).set({ beats, updatedAt: nowIso() }).where(eq(schema.socratesScripts.id, s.id));
  refresh();
  const next = beatByKey(str(formData, "next"));
  redirect(`/socrates/scripts/${s.id}?beat=${next ? next.key : beat.key}`);
}

export async function deleteScriptAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.socratesScripts).where(and(eq(schema.socratesScripts.id, str(formData, "id")), eq(schema.socratesScripts.userId, userId)));
  refresh();
  redirect("/socrates/scripts");
}

