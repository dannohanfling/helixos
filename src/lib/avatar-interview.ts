/**
 * Avatars by interview (rev 636, answered rev 639) on the server: start (or resume) an interview, take each answer, ask the
 * AI for one follow-up or move on, draft the avatar when the fields are asked or the member says that's enough, and save only
 * the fields they keep. The page's actions and the connector's avatar_interview_* tools call these same functions. Every
 * read and write is the member's own (workspace and user together); AI calls run on their own key.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AvatarField, AvatarInterview, InterviewTurn } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { aiStatus, draft } from "@/lib/ai";
import { saveAvatar } from "@/lib/avatars";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { DRAFT_TASK, FOLLOW_UP_TASK, checkDraft, fieldsToAsk, fieldsToSave, nextTurn, openTurn, transcript, type FieldChoice } from "@/lib/engine/avatar-interview";

const FEATURE = "avatar_interview";
const memberOf = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });
const mine = (v: Viewer) => and(eq(schema.avatarInterviews.workspaceId, v.workspace.id), eq(schema.avatarInterviews.userId, v.user.id));
export const NO_KEY = "Add your AI key in Settings to be interviewed.";

export type InterviewResult = { ok: true; interview: AvatarInterview } | { ok: false; error: string };

async function ownAvatar(v: Viewer, id: string) {
  return db.query.avatars.findFirst({ where: and(eq(schema.avatars.workspaceId, v.workspace.id), eq(schema.avatars.userId, v.user.id), eq(schema.avatars.id, id)) });
}
/** One of the member's interviews, or null. */
export async function ownInterview(v: Viewer, id: string): Promise<AvatarInterview | null> {
  return (await db.query.avatarInterviews.findFirst({ where: and(mine(v), eq(schema.avatarInterviews.id, id)) })) ?? null;
}
/** The fields this interview asks about: all ten, or the avatar's empty ones as they were when it began. */
async function fieldsOf(v: Viewer, row: AvatarInterview): Promise<AvatarField[]> {
  if (!row.avatarId) return fieldsToAsk(null);
  const asked = [...new Set(row.turns.map((t) => t.field))];
  const a = await ownAvatar(v, row.avatarId);
  return [...new Set([...asked, ...fieldsToAsk(a ?? null)])];
}
async function update(row: AvatarInterview, set: Partial<AvatarInterview>): Promise<AvatarInterview> {
  await db.update(schema.avatarInterviews).set({ ...set, updatedAt: nowIso() }).where(eq(schema.avatarInterviews.id, row.id));
  return (await db.query.avatarInterviews.findFirst({ where: eq(schema.avatarInterviews.id, row.id) }))!;
}

/** Whether the member can be interviewed: a working key under the day's cap. */
export async function canInterview(v: Viewer): Promise<boolean> {
  const s = await aiStatus(v);
  return s.hasKey && !s.blocked;
}

/**
 * Starts an interview, for a new avatar or to fill an avatar's empty fields, or picks up the one already under way for the same
 * avatar, so stopping and coming back (in the app or by voice) carries on where it was.
 */
export async function startInterview(v: Viewer, avatarId?: string | null): Promise<InterviewResult> {
  if (!(await canInterview(v))) return { ok: false, error: NO_KEY };
  let fields = fieldsToAsk(null);
  if (avatarId) {
    const a = await ownAvatar(v, avatarId);
    if (!a || a.archivedAt) return { ok: false, error: "That avatar isn't yours or isn't there any more." };
    fields = fieldsToAsk(a);
    if (!fields.length) return { ok: false, error: `Every field on "${a.name}" is filled already.` };
  }
  const going = await db.query.avatarInterviews.findFirst({ where: and(mine(v), inArray(schema.avatarInterviews.status, ["open", "draft"]), avatarId ? eq(schema.avatarInterviews.avatarId, avatarId) : isNull(schema.avatarInterviews.avatarId)), orderBy: desc(schema.avatarInterviews.updatedAt) });
  if (going) return { ok: true, interview: going };
  const first = nextTurn([], fields)!;
  const id = newId();
  await db.insert(schema.avatarInterviews).values({ id, ...memberOf(v), avatarId: avatarId ?? null, turns: [first] });
  return { ok: true, interview: (await ownInterview(v, id))! };
}

/** The draft: the AI's reading of the answers, then the server's checks. Stays open (with the reason) when the AI doesn't answer. */
async function makeDraft(v: Viewer, row: AvatarInterview): Promise<InterviewResult> {
  const fields = await fieldsOf(v, row);
  const said = transcript(row.turns);
  if (!said) return { ok: false, error: "Answer at least one question first." };
  const reply = await draft(DRAFT_TASK, said, 3000, { feature: FEATURE, viewer: v, essence: false });
  let raw: unknown = null;
  try {
    const json = reply?.match(/\{[\s\S]*\}/)?.[0];
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  if (!raw) return { ok: false, error: "The AI didn't send a draft back. Press That's enough, show me to try again; your answers are kept." };
  const c = checkDraft(raw, row.turns, fields);
  return { ok: true, interview: await update(row, { status: "draft", draft: { name: c.name, fields: c.fields, dropped: c.dropped }, turns: row.turns.filter((t) => t.answer !== null) }) };
}

/**
 * One answer to the open question (blank skips it). Then one follow-up from the AI when the answer was thin, else the next
 * field; the draft when every field is asked, the hard stop is reached, or the member says that's enough.
 */
export async function answerInterview(v: Viewer, id: string, answer: string | null, enough = false): Promise<InterviewResult> {
  const row = await ownInterview(v, id);
  if (!row || (row.status !== "open" && row.status !== "draft")) return { ok: false, error: "That interview isn't open any more." };
  if (row.status === "draft") return enough ? makeDraft(v, row) : { ok: true, interview: row };
  if (!(await canInterview(v))) return { ok: false, error: NO_KEY };
  let turns: InterviewTurn[] = row.turns;
  const open = openTurn(turns);
  const text = (answer ?? "").trim().slice(0, 4000);
  if (open && (text || !enough)) turns = [...turns.slice(0, -1), { ...open, answer: text }];
  if (enough) return makeDraft(v, await update(row, { turns }));
  const fields = await fieldsOf(v, row);
  let followUp: string | null = null;
  const last = turns.at(-1);
  if (last && text && !last.followUp) {
    const r = await draft(FOLLOW_UP_TASK, `Question: ${last.question}\nAnswer: ${text}`, 200, { feature: FEATURE, viewer: v, essence: false });
    const q = (r ?? "").trim().split("\n")[0];
    if (q && q.toUpperCase() !== "NEXT" && q.endsWith("?")) followUp = q;
  }
  const next = nextTurn(turns, fields, followUp);
  if (!next) return makeDraft(v, await update(row, { turns }));
  return { ok: true, interview: await update(row, { turns: [...turns, next] }) };
}

/**
 * Saves the fields the member kept or edited, and only those: into a new avatar (named by them), or into the avatar it was for,
 * never over a field that is filled there now. The interview is marked saved against the avatar.
 */
export async function saveInterview(v: Viewer, id: string, choices: Partial<Record<AvatarField, FieldChoice>>, name: string): Promise<{ ok: true; avatarId: string; saved: AvatarField[] } | { ok: false; error: string }> {
  const row = await ownInterview(v, id);
  if (!row || row.status !== "draft" || !row.draft) return { ok: false, error: "There's no draft to save yet." };
  const existing = row.avatarId ? await ownAvatar(v, row.avatarId) : null;
  if (row.avatarId && !existing) return { ok: false, error: "That avatar isn't yours or isn't there any more." };
  const fields = fieldsToSave(row.draft, choices, existing ?? null);
  const saved = Object.keys(fields) as AvatarField[];
  if (!saved.length) return { ok: false, error: "Keep or edit at least one field to save." };
  const r = await saveAvatar(memberOf(v), existing?.id ?? null, existing ? fields : { name: name.trim() || row.draft.name || "", ...fields });
  if ("error" in r) return { ok: false, error: r.error };
  await update(row, { status: "saved", savedAvatarId: r.avatar.id });
  return { ok: true, avatarId: r.avatar.id, saved };
}

/** Stops an interview for good; its answers stay for the member to read. */
export async function stopInterview(v: Viewer, id: string): Promise<void> {
  const row = await ownInterview(v, id);
  if (row && (row.status === "open" || row.status === "draft")) await update(row, { status: "stopped" });
}

/** The interviews an avatar was saved from, oldest first, for the avatar's page and the coach's view: the questions and answers. */
export async function interviewsBehind(m: { workspaceId: string; userId: string }, avatarId: string): Promise<AvatarInterview[]> {
  return db.query.avatarInterviews.findMany({ where: and(eq(schema.avatarInterviews.workspaceId, m.workspaceId), eq(schema.avatarInterviews.userId, m.userId), eq(schema.avatarInterviews.savedAvatarId, avatarId)), orderBy: asc(schema.avatarInterviews.createdAt) });
}

/** The member's interviews still under way, newest first, for "Pick up where you left off". */
export async function openInterviews(v: Viewer): Promise<AvatarInterview[]> {
  return db.query.avatarInterviews.findMany({ where: and(mine(v), inArray(schema.avatarInterviews.status, ["open", "draft"])), orderBy: desc(schema.avatarInterviews.updatedAt) });
}
