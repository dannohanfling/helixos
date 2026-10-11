/**
 * My Board, "Set it up for me" on the server (revs 660, 664 §5): what the proposals are checked against (the member's own rows
 * only), and applying the ones the member ticked, through each area's own writer. Nothing here runs without their approval:
 * the page's "Approve N selected" and board_apply after a read-back and a yes are the only callers of applySetup. Everything it
 * creates is a draft or private, links back to the decision, and is listed on it; it never deletes, and a change to something
 * that exists was shown before → after with its own tick. Office Hours goes through saveOohRequest, its own gate.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BoardApplied, BoardProposal } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { appUrl } from "@/lib/branded-email";
import { addTask, followUpTask } from "@/lib/tasks-core";
import { updateContact } from "@/lib/contacts-core";
import { createContentItem } from "@/lib/content-core";
import { createWebinar } from "@/lib/webinars-core";
import { createOffer } from "@/lib/offers-core";
import { setTarget } from "@/lib/targets-core";
import { saveWeekIntention } from "@/lib/intentions-core";
import { saveOohRequest } from "@/lib/office-hours-core";
import { readIntention, weekOf } from "@/lib/engine/intentions";
import { monthOf } from "@/lib/engine/targets";
import { upcomingFridays } from "@/lib/engine/office-hours";
import type { SetupLook } from "@/lib/engine/board-setup";

const mine = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });
export const decisionLink = (id: string) => `${appUrl()}/my-board/${id}`;

/** The member's rows the proposals are checked against. */
export async function setupLook(v: Viewer, decisionId: string, question: string, known: string): Promise<SetupLook> {
  const { workspaceId, userId } = mine(v);
  const month = monthOf(v.today);
  const [intention, targets, contacts, offers] = await Promise.all([
    db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, weekOf(v.today))) }),
    db.query.targets.findMany({ where: and(eq(schema.targets.workspaceId, workspaceId), eq(schema.targets.userId, userId), eq(schema.targets.month, month)) }),
    db.query.contacts.findMany({ where: and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.userId, userId)), columns: { id: true, name: true, stage: true, nextFollowUpAt: true } }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, workspaceId), eq(schema.offers.userId, userId)), columns: { id: true, name: true } }),
  ]);
  return {
    today: v.today,
    link: decisionLink(decisionId),
    question,
    known,
    intention: intention ? { word: intention.word, keyResults: intention.keyResults.map((k) => k.text), initiative: intention.initiative, tasks: intention.tasks.map((t) => t.title) } : null,
    month,
    targets: Object.fromEntries(targets.map((t) => [t.metric, t.target])),
    contacts,
    offers,
    oohCategories: v.workspace.oohCategories,
    fridays: upcomingFridays(v.today),
  };
}

export type Applied = { ok: true; applied: BoardApplied[]; skipped: string[] } | { ok: false; error: string };

/**
 * Applies the ticked proposals of one of the member's decisions, once each (one already set up is skipped). Refused for a team
 * member and while a coach is switched in. A proposal that would now change something that wasn't there when it was shown (a
 * 3-1-3 or a target set since) is skipped and said, so nothing is ever replaced without its own before → after tick.
 */
export async function applySetup(v: Viewer, decisionId: string, ids: string[]): Promise<Applied> {
  if (v.team) return { ok: false, error: "A team member can read the Board's decisions but can't approve its set-up." };
  if (v.switchedInto) return { ok: false, error: "The set-up changes their HelixOS, so it's theirs to approve." };
  const m = mine(v);
  const d = await db.query.boardDecisions.findFirst({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId), eq(schema.boardDecisions.id, decisionId)) });
  if (!d || !d.answer) return { ok: false, error: "That decision isn't yours or has no answer to set up." };
  const done = new Set(d.applied.map((a) => a.proposalId));
  const picked = d.proposals.filter((p) => ids.includes(p.id) && !done.has(p.id));
  if (!picked.length) return { ok: false, error: ids.length ? "Those are already set up." : "Tick what you'd like set up first." };
  const top = d.parentId ?? d.id;
  const link = decisionLink(top);
  const applied: BoardApplied[] = [];
  const skipped: string[] = [];
  const stepTasks = [...d.stepTasks];
  const at = nowIso();
  const look = await setupLook(v, top, d.question, "");
  for (const p of picked) {
    const r = await applyOne(v, p, look, link);
    if ("skip" in r) {
      skipped.push(`${p.title}: ${r.skip}`);
      continue;
    }
    applied.push({ proposalId: p.id, kind: p.kind, ref: r.ref, href: r.href, at });
    if (p.kind === "task" && typeof p.payload.step === "number") stepTasks[p.payload.step] = r.ref;
  }
  await db.update(schema.boardDecisions).set({ applied: [...d.applied, ...applied], stepTasks, updatedAt: at }).where(eq(schema.boardDecisions.id, d.id));
  return { ok: true, applied, skipped };
}

type One = { ref: string | null; href: string | null } | { skip: string };
const str = (x: unknown) => (typeof x === "string" ? x : "");

async function applyOne(v: Viewer, p: BoardProposal, look: SetupLook, link: string): Promise<One> {
  const m = mine(v);
  const q = p.payload;
  switch (p.kind) {
    case "task":
    case "checkin":
    case "proof": {
      const r = await addTask(v, { title: str(q.title), details: str(q.details) || `From My Board: ${link}`, urgency: p.kind === "task" ? str(q.urgency) : p.kind === "proof" ? "high" : "medium", category: p.kind === "task" ? str(q.category) : p.kind === "proof" ? "sales" : "admin", dueDate: str(q.dueDate) });
      if (!r) return { skip: "no title" };
      await db.update(schema.tasks).set({ sourceRef: `board:${link.split("/").pop()}` }).where(eq(schema.tasks.id, r.task.id));
      return { ref: r.task.id, href: "/tasks" };
    }
    case "intention": {
      if (!p.before && look.intention) return { skip: "this week's 3-1-3 was set since; ask again to see the change" };
      const read = readIntention({ word: str(q.word), kr: (q.keyResults as string[]) ?? [], initiative: str(q.initiative), tasks: (q.tasks as string[]) ?? [] });
      if ("error" in read) return { skip: read.error };
      await saveWeekIntention({ ...m, today: v.today }, read.value);
      return { ref: weekOf(v.today), href: "/intentions#week" };
    }
    case "target": {
      if (!p.before && look.targets[str(q.metric)] && str(q.month) === look.month) return { skip: "that target was set since; ask again to see the change" };
      if (str(q.month) !== look.month) return { skip: "that was last month's target" };
      await setTarget(m, look.month, str(q.metric), Number(q.value));
      return { ref: str(q.metric), href: "/numbers" };
    }
    case "followup": {
      const c = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.workspaceId, m.workspaceId), eq(schema.contacts.userId, m.userId), eq(schema.contacts.id, str(q.contactId))) });
      if (!c) return { skip: "they're no longer in your DMs" };
      const r = await updateContact({ ...m, today: v.today }, c, { nextFollowUpAt: str(q.by) });
      if (!r.ok) return { skip: "their stage doesn't take a follow-up" };
      await followUpTask(v, c, str(q.by), `From My Board: ${link}`);
      return { ref: c.id, href: `/conversations/${c.id}` };
    }
    case "content": {
      const date = str(q.date) || null;
      const id = await createContentItem(m, { title: str(q.title), hook: str(q.hook) || null, status: date ? "creating" : "idea", postDate: date, notes: str(q.notes) || `From My Board: ${link}` });
      return { ref: id, href: `/content/${id}` };
    }
    case "webinar": {
      const offerId = str(q.offerId) || null;
      const ok = offerId ? await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, m.userId), eq(schema.offers.id, offerId)), columns: { id: true } }) : null;
      const date = str(q.date) || null;
      const id = await createWebinar(m, { title: str(q.title), promise: str(q.promise) || null, offerId: ok?.id ?? null, scheduledAt: date ? `${date}T18:00` : null, notes: `From My Board: ${link}` });
      return { ref: id, href: `/webinars/${id}` };
    }
    case "offer": {
      const id = await createOffer(m, { name: str(q.name), promise: str(q.promise) || null, price: typeof q.price === "number" ? q.price : null, notes: `Draft from Board: ${link}` });
      return { ref: id, href: `/offers/${id}` };
    }
    case "office_hours": {
      const saved = await saveOohRequest({ ...m, today: v.today, categories: v.workspace.oohCategories }, { friday: str(q.friday), description: str(q.question), triedSelf: str(q.tried), tools: "", goal: str(q.outcome), category: str(q.category), triedGate: "yes", promise: true });
      if (!saved.ok) return { skip: "goBack" in saved ? saved.goBack : saved.error };
      return { ref: saved.id, href: "/office-hours#mine" };
    }
  }
  return { skip: "unknown kind" };
}
