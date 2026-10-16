/**
 * Voice pack 2 (rev 642): the member's day by voice. Log a DM, save a win to the Proof Bank, drop an idea on the Content board,
 * hear a call sheet before a call, turn a call's action steps into tasks, and ask for Office Hours. Every write goes through
 * the same function the page uses (contacts-core, proofs-core, content-core, recordings' addStepTask, office-hours-core), so
 * points, counts and checks come out exactly as in the app. Answers are read aloud: one sentence first, lists numbered, ids
 * only in the data.
 *
 * A proof is only ever a draft here (approval, with its attachment check, stays on its page); Office Hours goes to the coach,
 * so it is read back and sent only with confirm: true after the member's yes. A team member is refused wherever the app
 * refuses them (proofs, recordings, the call sheet, Office Hours).
 */
import { siteUrl } from "@/lib/app-url";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { createContact, logMessage, updateContact } from "@/lib/contacts-core";
import { createProof } from "@/lib/proofs-core";
import { createContentItem } from "@/lib/content-core";
import { followUpTask as sharedFollowUp } from "@/lib/tasks-core";
import { addStepTask, stepGroupsFor, visibleRecordings } from "@/lib/recordings";
import { saveOohRequest } from "@/lib/office-hours-core";
import { OOH_LOCKED_LINE, OOH_OUTCOME_LABEL, upcomingFridays } from "@/lib/engine/office-hours";
import { oohAccessFor } from "@/lib/office-hours-access";
import { assemble, callSheet } from "@/lib/engine/socrates";
import { fillsFor, visibleQuestions } from "@/lib/queries/socrates";
import { itemMoment } from "@/lib/engine/recording-members";
import { shownTitle } from "@/lib/engine/recordings";
import { numbered } from "@/lib/engine/voice-ship";
import { STAGE_WORDS, contentTypeFrom, dayFrom, dayWords, findByName, fridayFrom, fridayWords, oohReadBack, pickCall, proofFrom, quickSheet, sheetForVoice, stageFrom } from "@/lib/engine/voice-pack";
import { formatDate, todayInTz } from "@/lib/dates";

const appUrl = siteUrl;
const first = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const member = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id, today: v.today });
/** The app refuses a team member here; so does the connector. */
function ownerOnly(v: Viewer, what: string) {
  if (v.team) throw new Error(`A team member can't ${what} for the account owner. They can do it themselves.`);
}

/* ───────────────────────── DMs ───────────────────────── */

const myContacts = (v: Viewer) => db.query.contacts.findMany({ where: and(eq(schema.contacts.workspaceId, v.workspace.id), eq(schema.contacts.userId, v.user.id)), orderBy: desc(schema.contacts.createdAt) });
const waitingOnYou = (c: schema.Contact) => Boolean(c.lastInboundAt) && (!c.lastOutboundAt || c.lastInboundAt! > c.lastOutboundAt);
const followUpOpen = (c: schema.Contact) => c.stage !== "cold" && c.stage !== "client";

/** The one open "Follow up with …" task for this person (tasks-core's, shared with the Board's set-up). */
const followUpTask = (v: Viewer, c: schema.Contact, day: string) => sharedFollowUp(v, c, day, `From DMs: ${appUrl()}/conversations/${c.id}`);

defineTool({
  name: "dm_log",
  scope: "dms",
  kind: "write",
  description:
    "Logs a DM conversation on the member's DMs page, the same as logging it there: finds the person by name (several matches are read back numbered and nothing changes; no match adds them), logs the note as a message so the day's DMs started counts it once, sets the stage (Reached out, Replied, In conversation, Call booked, Client, Cold) and, with follow_up, the follow-up date and one \"Follow up with …\" task in Sales. Call booked and Client need an email or phone first, as in the app. Left out, an existing person's stage stays; a new person starts In conversation.",
  input: {
    person: z.string().min(1).max(120).describe("The person's name as the member said it"),
    where: z.string().max(40).optional().describe("Optional: where the conversation is (Facebook, Instagram, LinkedIn, Skool, Email, SMS, Other); default Facebook for a new person"),
    status: z.string().max(40).optional().describe("Optional: Reached out, Replied, In conversation, Call booked, Client or Cold"),
    note: z.string().max(4000).optional().describe("What happened, in the member's words; logged on the conversation"),
    follow_up: z.string().max(40).optional().describe("Optional: when to follow up, as YYYY-MM-DD, today, tomorrow, a weekday or \"in N days\""),
    email: z.string().max(200).optional().describe("Optional: their email, needed before Call booked or Client"),
    phone: z.string().max(40).optional().describe("Optional: their phone, needed before Call booked or Client"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const said = String(input.person ?? "").trim();
    const askedStage = input.status ? stageFrom(String(input.status)) : null;
    if (input.status && !askedStage) throw new Error(`"${input.status}" isn't a DMs stage. The stages: ${Object.values(STAGE_WORDS).join(", ")}.`);
    const follow = input.follow_up ? dayFrom(String(input.follow_up), v.today) : null;
    if (input.follow_up && !follow) throw new Error(`I couldn't read "${input.follow_up}" as a day. Say a date as YYYY-MM-DD, today, tomorrow, a weekday or "in N days".`);
    const found = findByName(await myContacts(v), said);
    if ("several" in found) {
      const lines = found.several.slice(0, 8).map((c) => `${c.name} (${STAGE_WORDS[c.stage]}${c.platform ? `, ${c.platform}` : ""})`);
      return { text: `"${said}" fits ${found.several.length} people, so nothing changed. Which one?\n${numbered(lines)}`, data: { logged: false, matches: found.several.slice(0, 8).map((c, i) => ({ n: i + 1, id: c.id, name: c.name, stage: c.stage })) } };
    }
    const m = member(v);
    let contact: schema.Contact;
    let added = false;
    if ("one" in found) contact = found.one;
    else {
      const id = await createContact(m, { name: said, platform: input.where ? String(input.where) : null, email: input.email ? String(input.email) : null, phone: input.phone ? String(input.phone) : null, source: "Voice" });
      contact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, id) }))!;
      added = true;
    }
    const note = input.note ? String(input.note).trim() : "";
    if (note) {
      await logMessage(m, contact, { direction: "out", body: note, nextFollowUpAt: follow });
      contact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contact.id) }))!;
    }
    const stage = askedStage ?? (added ? "conversation" : undefined);
    const change = { stage, email: input.email ? String(input.email) : undefined, phone: input.phone ? String(input.phone) : undefined, nextFollowUpAt: follow ?? undefined };
    const out = await updateContact(m, contact, change);
    if (!out.ok) {
      const kept = note ? " The note is logged; the stage stays." : " Nothing else changed.";
      return { text: `${STAGE_WORDS[out.needsIdentity]} needs ${first(contact.name)}'s email or phone first, as in the app.${kept} Say it and I'll move them.`, data: { logged: Boolean(note), id: contact.id, needsIdentity: out.needsIdentity } };
    }
    contact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contact.id) }))!;
    if (follow && followUpOpen(contact)) await followUpTask(v, contact, follow);
    const parts = [`${added ? "Added and logged" : "Logged"} ${contact.name}: ${STAGE_WORDS[contact.stage].toLowerCase()}`, contact.nextFollowUpAt && followUpOpen(contact) ? `follow-up ${dayWords(contact.nextFollowUpAt, v.today)}` : ""].filter(Boolean);
    return { text: `${parts.join(", ")}.`, data: { logged: true, added, id: contact.id, name: contact.name, stage: contact.stage, nextFollowUpAt: contact.nextFollowUpAt, link: `${appUrl()}/conversations/${contact.id}` } };
  },
});

defineTool({
  name: "dms_list",
  scope: "dms",
  kind: "read",
  description: "The member's DMs: who's waiting on their reply, today's and overdue follow-ups, then the latest 10, numbered. Optionally only one stage, or names matching words.",
  input: {
    stage: z.string().max(40).optional().describe("Optional: only this stage (Reached out, Replied, In conversation, Call booked, Client, Cold)"),
    name: z.string().max(120).optional().describe("Optional: only people whose name has these words"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    let rows = await myContacts(v);
    const stage = input.stage ? stageFrom(String(input.stage)) : null;
    if (input.stage && !stage) throw new Error(`"${input.stage}" isn't a DMs stage. The stages: ${Object.values(STAGE_WORDS).join(", ")}.`);
    if (stage) rows = rows.filter((c) => c.stage === stage);
    if (input.name) {
      const f = findByName(rows, String(input.name));
      rows = "one" in f ? [f.one] : "several" in f ? f.several : [];
    }
    if (!rows.length) return { text: "No conversations match.", data: { waiting: [], due: [], latest: [] } };
    const line = (c: schema.Contact) => `${c.name} (${STAGE_WORDS[c.stage]}${c.nextFollowUpAt && followUpOpen(c) ? `, follow up ${dayWords(c.nextFollowUpAt, v.today)}` : ""})`;
    const waiting = rows.filter((c) => followUpOpen(c) && waitingOnYou(c));
    const due = rows.filter((c) => followUpOpen(c) && c.nextFollowUpAt && c.nextFollowUpAt <= v.today && !waiting.includes(c));
    const latest = rows.slice(0, 10);
    const text = [
      `${waiting.length} waiting on your reply, ${due.length} follow-up${due.length === 1 ? "" : "s"} due.`,
      waiting.length ? `Waiting on you:\n${numbered(waiting.map(line))}` : "",
      due.length ? `Follow up today or overdue:\n${numbered(due.map(line))}` : "",
      `Latest:\n${numbered(latest.map(line))}`,
    ].filter(Boolean).join("\n\n");
    const d = (c: schema.Contact) => ({ id: c.id, name: c.name, stage: c.stage, platform: c.platform, nextFollowUpAt: c.nextFollowUpAt });
    return { text, data: { waiting: waiting.map(d), due: due.map(d), latest: latest.map(d) } };
  },
});

/* ───────────────────────── Proof Bank ───────────────────────── */

defineTool({
  name: "proof_add",
  scope: "proofs",
  kind: "write",
  description:
    "Saves a client win to the member's Proof Bank as a draft, private until they approve it on the proof's page. The result and numbers are stored word for word. client_agreed is true only when the member says the client agreed to it being used; then the Proof Bank's permission tick is recorded, marked as given by voice. Never approves.",
  input: {
    who: z.string().max(120).optional().describe("The client's name, as the member said it"),
    result: z.string().min(3).max(2000).describe("The win, in the member's words"),
    numbers: z.string().max(300).optional().describe("Optional: the numbers exactly as said (\"$4,200 in 3 weeks\")"),
    date: z.string().max(20).optional().describe("Optional: when it happened, YYYY-MM-DD"),
    source: z.string().max(60).optional().describe("Optional: where it came from (a call, a DM, a post)"),
    client_agreed: z.boolean().optional().describe("true only when the member said the client agreed to it being used"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "add to the Proof Bank");
    const p = proofFrom({ who: input.who as string | undefined, result: String(input.result ?? ""), numbers: input.numbers as string | undefined, date: input.date as string | undefined, source: input.source as string | undefined });
    const agreed = input.client_agreed === true && Boolean(p.who);
    const id = await createProof(member(v), { name: p.name, type: "result", who: p.who, resultAfter: p.resultAfter, tags: agreed ? [...p.tags, "permission by voice"] : p.tags }, { permission: agreed });
    const whose = p.who ? `${first(p.who)}'s win` : "the win";
    const perm = input.client_agreed === true && !p.who ? " Say whose win it is and the client's agreement can be noted." : agreed ? " Their agreement is noted." : "";
    return { text: `Saved ${whose} to your Proof Bank, private until you approve it.${perm}`, data: { id, status: "draft", permission: agreed, resultAfter: p.resultAfter, tags: p.tags, link: `${appUrl()}/proof/${id}` } };
  },
});

const proofState = (p: schema.Proof) => (p.status === "approved" ? "approved" : p.permissionAt ? "permission given" : "draft");
defineTool({
  name: "proof_list",
  scope: "proofs",
  kind: "read",
  description: "The member's recent Proof Bank wins, newest first and numbered, each with its state: draft, permission given, or approved.",
  input: { limit: z.number().int().min(1).max(20).optional().describe("How many, default 10") },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "read the Proof Bank");
    const rows = await db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, v.workspace.id), eq(schema.proofs.userId, v.user.id)), orderBy: desc(schema.proofs.createdAt), limit: Number(input.limit ?? 10) });
    if (!rows.length) return { text: "Your Proof Bank is empty. Tell me a client win and I'll save it.", data: { proofs: [] } };
    const lines = rows.map((p) => `${p.name} (${proofState(p)})`);
    return { text: `${rows.length} recent win${rows.length === 1 ? "" : "s"}:\n${numbered(lines)}`, data: { proofs: rows.map((p, i) => ({ n: i + 1, id: p.id, name: p.name, who: p.who, state: proofState(p), created: p.createdAt })) } };
  },
});

/* ───────────────────────── Content ideas ───────────────────────── */

defineTool({
  name: "idea_add",
  scope: "content:write",
  kind: "write",
  description: "Adds an idea to the Ideas column of the member's Content board, with optional notes and a format hint (a ladder, a story, a client win, a question, a tip, a video...). Nothing is posted. ladder_create can then write a ladder from it.",
  input: {
    idea: z.string().min(2).max(300).describe("The idea, in the member's words"),
    notes: z.string().max(4000).optional().describe("Optional: more about it"),
    format_hint: z.string().max(60).optional().describe("Optional: what kind of post it might be"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const contentType = contentTypeFrom(input.format_hint as string | undefined);
    const id = await createContentItem({ workspaceId: v.workspace.id, userId: v.user.id }, { title: String(input.idea ?? "").trim(), contentType, notes: input.notes ? String(input.notes).trim() : null });
    return { text: `Added to your ideas: "${String(input.idea).trim()}" (${contentType}).`, data: { id, status: "idea", contentType, link: `${appUrl()}/content/${id}` } };
  },
});

defineTool({
  name: "ideas_list",
  scope: "content",
  kind: "read",
  description: "The latest ideas on the member's Content board, newest first and numbered. Use the words of one with ladder_create's idea.",
  input: { limit: z.number().int().min(1).max(20).optional().describe("How many, default 10") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, v.workspace.id), eq(schema.contentItems.userId, v.user.id), eq(schema.contentItems.status, "idea")), orderBy: desc(schema.contentItems.createdAt), limit: Number(input.limit ?? 10) });
    if (!rows.length) return { text: "No ideas saved yet. Say one and I'll add it.", data: { ideas: [] } };
    return { text: `${rows.length} idea${rows.length === 1 ? "" : "s"}:\n${numbered(rows.map((r) => `${r.title} (${r.contentType})`))}`, data: { ideas: rows.map((r, i) => ({ n: i + 1, id: r.id, title: r.title, contentType: r.contentType, notes: r.notes })) } };
  },
});

/** An idea on the member's board by its id or words from its title, for ladder_create. */
export async function ideaFor(v: Viewer, words: string): Promise<schema.ContentItem> {
  const rows = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, v.workspace.id), eq(schema.contentItems.userId, v.user.id), inArray(schema.contentItems.status, ["idea", "creating"])), orderBy: desc(schema.contentItems.createdAt) });
  const byId = rows.find((r) => r.id === words.trim());
  if (byId) return byId;
  const f = findByName(rows.map((r) => ({ ...r, name: r.title })), words);
  if ("one" in f) return f.one;
  if ("several" in f) throw new Error(`"${words}" fits ${f.several.length} ideas: ${f.several.map((r) => r.title).join("; ")}. Say which.`);
  throw new Error(`No idea matches "${words}". Your ideas: ${rows.slice(0, 10).map((r) => r.title).join("; ") || "none yet"}.`);
}

/* ───────────────────────── The call sheet ───────────────────────── */

defineTool({
  name: "callsheet_read",
  scope: "sales",
  kind: "read",
  description:
    "Reads the member's call sheet before a sales call: first the 30-second version (the opening line of the first five beats and three things to listen for), then the full sheet beat by beat with follow-ups, listen-fors and pushback branches. Picked by script name; left out, the most recently edited script. With a person who is in their DMs, one line from that conversation too. Read-only.",
  input: {
    script: z.string().max(200).optional().describe("Optional: the script's name or words from it"),
    person: z.string().max(120).optional().describe("Optional: who the call is with, to add their last DM note"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "read the call sheet");
    const scripts = await db.query.socratesScripts.findMany({ where: and(eq(schema.socratesScripts.workspaceId, v.workspace.id), eq(schema.socratesScripts.userId, v.user.id)), orderBy: desc(schema.socratesScripts.updatedAt) });
    if (!scripts.length) return { text: "You haven't built a call script yet. Build one in Socrates and I can read it to you.", data: { script: null } };
    let s = scripts[0];
    if (input.script) {
      const f = findByName(scripts, String(input.script));
      if ("several" in f) return { text: `"${input.script}" fits ${f.several.length} scripts. Which one?\n${numbered(f.several.map((x) => x.name))}`, data: { scripts: f.several.map((x, i) => ({ n: i + 1, id: x.id, name: x.name })) } };
      if ("none" in f) throw new Error(`No script matches "${input.script}". Your scripts: ${scripts.map((x) => x.name).join("; ")}.`);
      s = f.one;
    }
    const assembled = assemble(s.beats, await visibleQuestions(v.user.id));
    const sheet = callSheet(s.name, s.scriptType, assembled, (await fillsFor(assembled, s.fills, v.user.id)).fills);
    const quick = quickSheet(sheet);
    let dmLine = "";
    let dm: { id: string; name: string; stage: string } | null = null;
    if (input.person) {
      const f = findByName(await myContacts(v), String(input.person));
      if ("one" in f) {
        const last = await db.query.messages.findFirst({ where: eq(schema.messages.contactId, f.one.id), orderBy: desc(schema.messages.sentAt) });
        dmLine = `${f.one.name}: ${last ? `last note "${last.body.replace(/\s+/g, " ").slice(0, 160)}"` : "no notes yet"} · ${STAGE_WORDS[f.one.stage]}`;
        dm = { id: f.one.id, name: f.one.name, stage: f.one.stage };
      }
    }
    const text = [
      `"${s.name}", ${sheet.beats.length} beats.`,
      dmLine,
      `The 30-second version:\n${numbered(quick.lines)}`,
      quick.listenFors.length ? `Listen for:\n${numbered(quick.listenFors)}` : "",
      `The full sheet:\n${sheetForVoice(sheet)}`,
    ].filter(Boolean).join("\n\n");
    return { text, data: { script: { id: s.id, name: s.name, type: s.scriptType }, dm, beats: sheet.beats.map((b) => ({ n: b.n, name: b.name })), link: `${appUrl()}/socrates/scripts/${s.id}/sheet` } };
  },
});

/* ───────────────────────── Recordings ───────────────────────── */

const seerOf = (v: Viewer) => ({ userId: v.user.id, programTier: v.membership.programTier, role: v.role });
/** The member's own steps and Everyone's, in that order and call order: the numbers both recording tools use. */
async function stepsOf(v: Viewer, r: schema.Recording) {
  const groups = (await stepGroupsFor(v, r)).filter((g) => g.own || g.everyone);
  return groups.flatMap((g) => g.items.map((x) => ({ ...x, own: g.own })));
}
async function callFor(v: Viewer, said: string | undefined) {
  const rows = (await visibleRecordings(v.workspace.id, seerOf(v))).filter((r) => r.actionItems.length);
  const r = pickCall(rows, said, (iso) => todayInTz(v.tz, new Date(iso)));
  if (!r) throw new Error(rows.length ? `No call you can open matches "${said}". The latest: ${rows.slice(0, 5).map((x) => shownTitle(x)).join("; ")}.` : "No call with action steps is open to you yet.");
  return r;
}

defineTool({
  name: "action_steps_read",
  scope: "recordings",
  kind: "read",
  description: "The action steps from one of the member's recorded calls (by a date YYYY-MM-DD, words from its title such as the call type, or latest): their own and Everyone's, in call order and numbered, each with its moment in the call. Only recordings the member can open. Use the number with action_step_to_task.",
  input: { call: z.string().max(200).optional().describe("Which call: YYYY-MM-DD, words from its title, or latest (the default)") },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "read the recordings");
    const r = await callFor(v, input.call as string | undefined);
    const steps = await stepsOf(v, r);
    const when = r.startedAt ? formatDate(todayInTz(v.tz, new Date(r.startedAt))) : "date unknown";
    if (!steps.length) return { text: `"${shownTitle(r)}" (${when}) has no steps for you or for everyone.`, data: { recordingId: r.id, steps: [] } };
    const done = await db.query.recordingSteps.findMany({ where: and(eq(schema.recordingSteps.recordingId, r.id), eq(schema.recordingSteps.userId, v.user.id), isNotNull(schema.recordingSteps.taskId)) });
    const added = new Set(done.map((d) => d.itemIndex));
    const lines = steps.map((s) => {
      const m = itemMoment(s.item, r.shareUrl || r.url);
      return `${s.item.description}${s.own ? "" : " (everyone)"}${m ? ` at ${m.label.replace("▶ ", "")}` : ""}${added.has(s.index) ? ", already on your tasks" : ""}`;
    });
    return {
      text: `"${shownTitle(r)}" (${when}), ${steps.length} step${steps.length === 1 ? "" : "s"}:\n${numbered(lines)}`,
      data: { recordingId: r.id, title: shownTitle(r), steps: steps.map((s, i) => ({ n: i + 1, description: s.item.description, own: s.own, moment: itemMoment(s.item, r.shareUrl || r.url)?.href ?? null, onTasks: added.has(s.index) })) },
    };
  },
});

defineTool({
  name: "action_step_to_task",
  scope: "recordings",
  kind: "write",
  description: "Adds one action step from a recorded call to the member's tasks, the same as \"+ Add to my Tasks\" on the recording: by the call and the step's number from action_steps_read. Only their own steps and Everyone's; a step already added isn't added twice.",
  input: {
    call: z.string().max(200).optional().describe("The same call as action_steps_read: YYYY-MM-DD, words from its title, or latest"),
    step: z.number().int().min(1).max(200).describe("The step's number, as action_steps_read numbered it"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "add recording steps to tasks");
    const r = await callFor(v, input.call as string | undefined);
    const steps = await stepsOf(v, r);
    const s = steps[Number(input.step) - 1];
    if (!s) throw new Error(`There's no step ${input.step} on "${shownTitle(r)}"; it has ${steps.length}.`);
    const out = await addStepTask(v, r.id, s.index);
    if (!out.ok) throw new Error(out.error);
    return { text: out.already ? `"${s.item.description}" is already on your tasks.` : `Added to today's tasks: "${s.item.description}".`, data: { taskId: out.taskId, already: out.already } };
  },
});

/* ───────────────────────── Office Hours ───────────────────────── */

defineTool({
  name: "office_hours_submit",
  scope: "office_hours",
  kind: "write",
  description:
    "Asks for help at a Friday Open Office Hours call. It goes to the coach, so: call it first without confirm to get the read-back, read it to the member (it ends with them being there on that Friday), and only after their yes call again with confirm: true; their yes is their promise to attend. Ask for what they've tried and the outcome they want if they didn't say. The category must be one of the workspace's; the Friday one of the next four.",
  input: {
    question: z.string().min(3).max(4000).describe("The issue, in the member's words"),
    tried: z.string().min(3).max(4000).describe("How they've tried to solve it themselves"),
    outcome: z.string().min(3).max(2000).describe("The solution they want to reach on the call"),
    category: z.string().max(80).optional().describe("One of the workspace's Office Hours categories"),
    friday: z.string().max(40).optional().describe("Which Friday: YYYY-MM-DD, \"the 17th\", or left out for the next one"),
    tools: z.string().max(500).optional().describe("Optional: the tools involved"),
    confirm: z.boolean().optional().describe("true only after the member said yes to the read-back"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    ownerOnly(v, "ask for Office Hours");
    // Office Hours by program level (H-470): the connector refuses the same way the page does, no prices.
    if (!(await oohAccessFor(v)).open) throw new Error(OOH_LOCKED_LINE);
    const fridays = upcomingFridays(v.today);
    const friday = fridayFrom(input.friday as string | undefined, fridays);
    if (!friday) throw new Error(`Pick one of the next four Fridays: ${fridays.map(fridayWords).join(", ")}.`);
    const cats = v.workspace.oohCategories;
    const category = cats.find((c) => c.toLowerCase() === String(input.category ?? "").trim().toLowerCase());
    if (!category) throw new Error(`Which category? ${cats.join(", ")}.`);
    const said = { question: String(input.question ?? "").trim(), tried: String(input.tried ?? "").trim(), outcome: String(input.outcome ?? "").trim(), category, friday, tools: input.tools ? String(input.tools).trim() : null };
    if (input.confirm !== true) return { text: `${oohReadBack(said)}\n\nNot sent yet: read this back and send it only after their yes.`, data: { sent: false, friday, category } };
    const saved = await saveOohRequest({ ...member(v), categories: cats }, { friday, description: said.question, triedSelf: said.tried, tools: said.tools ?? "", goal: said.outcome, category, triedGate: "yes", promise: true });
    if (!saved.ok) throw new Error("goBack" in saved ? saved.goBack : saved.error);
    return { text: `Sent to your coach for ${fridayWords(friday)}. See you there.`, data: { sent: true, id: saved.id, friday, category, link: `${appUrl()}/office-hours#mine` } };
  },
});

defineTool({
  name: "office_hours_list",
  scope: "office_hours",
  kind: "read",
  description: "The member's own Office Hours requests, newest Friday first and numbered: the Friday, the category, the question, and how it went (pending, covered, no-show).",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    ownerOnly(v, "read Office Hours requests");
    const locked = (await oohAccessFor(v)).open ? "" : ` ${OOH_LOCKED_LINE} Past requests stay readable; new ones can't be sent.`;
    const rows = await db.query.officeHoursRequests.findMany({ where: and(eq(schema.officeHoursRequests.workspaceId, v.workspace.id), eq(schema.officeHoursRequests.userId, v.user.id)), orderBy: [desc(schema.officeHoursRequests.friday), desc(schema.officeHoursRequests.createdAt)], limit: 10 });
    if (!rows.length) return { text: `You haven't asked for Office Hours yet.${locked}`, data: { requests: [], locked: Boolean(locked) } };
    const how = (r: schema.OfficeHoursRequest) => (r.outcome ? OOH_OUTCOME_LABEL[r.outcome] : "pending");
    const lines = rows.map((r) => `${fridayWords(r.friday)}, ${r.category}: ${r.description.replace(/\s+/g, " ").slice(0, 120)} (${how(r)})`);
    return { text: `${rows.length} request${rows.length === 1 ? "" : "s"}:\n${numbered(lines)}${locked}`, data: { locked: Boolean(locked), requests: rows.map((r, i) => ({ n: i + 1, id: r.id, friday: r.friday, category: r.category, outcome: r.outcome ?? "pending", submitted: r.createdAt, edited: r.editedAt })) } };
  },
});
