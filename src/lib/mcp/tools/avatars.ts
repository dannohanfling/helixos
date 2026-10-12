/**
 * The connector's Avatars tools (rev 501 §6, built by Body at rev 508), on the existing Offers scope: list the member's buyer
 * avatars with their offers, add one, update one, and link one to an offer. Through the same functions the Avatars page uses
 * (src/lib/avatars.ts), scoped to the member. Nothing here deletes or archives; the member's words are kept as given.
 */
import { siteUrl } from "@/lib/app-url";
import { z } from "zod";
import type { Viewer } from "@/lib/auth";
import { AVATAR_FIELDS, type Avatar, type AvatarField, type AvatarInterview } from "@/db/schema";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { avatarData, byName, linkOffer, saveAvatar, type AvatarInput } from "@/lib/avatars";
import { AVATAR_FIELD_INFO, avatarTree, offersOf, type LinkRow, type OfferRef } from "@/lib/engine/avatars";
import { answerInterview, openInterviews, startInterview } from "@/lib/avatar-interview";
import { draftSummary, openTurn, progressWords } from "@/lib/engine/avatar-interview";

const member = (v: Viewer) => ({ workspaceId: v.workspace.id, userId: v.user.id });

/** One avatar as the tools speak of it: every field, its parent by name, and its offers with the main marked. */
const avatarOut = (a: Avatar, rows: Avatar[], links: LinkRow[], offers: OfferRef[]) => ({
  name: a.name,
  oneLine: a.oneLine,
  subSegmentOf: a.parentId ? (rows.find((p) => p.id === a.parentId)?.name ?? null) : null,
  primary: a.primary,
  importedPleaseReview: a.imported,
  ...Object.fromEntries(AVATAR_FIELDS.map((f) => [f, a[f]])),
  offers: offersOf(a.id, links, offers).map((o) => ({ name: o.name, main: o.main })),
});

/** The ten fields as tool inputs, each optional, described in the page's words. */
const fieldInputs = Object.fromEntries(AVATAR_FIELDS.map((f) => [f, z.string().max(4000).optional().describe(`${AVATAR_FIELD_INFO[f].label}, in the member's own words`)])) as Record<AvatarField, z.ZodOptional<z.ZodString>>;
const fieldsOf = (input: Record<string, unknown>): Partial<Record<AvatarField, string>> => Object.fromEntries(AVATAR_FIELDS.filter((f) => typeof input[f] === "string").map((f) => [f, String(input[f])]));

function offerByName(offers: OfferRef[], words: string): OfferRef {
  const w = words.trim().toLowerCase();
  const exact = offers.filter((o) => o.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const some = offers.filter((o) => o.name.toLowerCase().includes(w));
  if (some.length === 1) return some[0];
  if (!some.length) throw new Error(`No offer is called "${words}". The member's offers: ${offers.map((o) => o.name).join("; ") || "none yet"}.`);
  throw new Error(`"${words}" fits ${some.length} offers: ${some.map((o) => o.name).join("; ")}. Say which.`);
}

export const avatarsList = defineTool({
  name: "avatars_list",
  scope: "offers",
  kind: "read",
  description: "The member's buyer avatars as the Avatars page shows them: each with its sub-segments, the Primary starred, every filled field in their own words, and the offers it's linked to (the offer's main avatar marked). Use these words when writing for them; never add a pain, number or quote they didn't write.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    const m = member(v);
    const { rows, links, offers } = await avatarData(m);
    const tree = avatarTree(rows);
    if (!tree.length) return { text: "No avatars yet. Add one with avatar_add.", data: { avatars: [] } };
    const line = (a: Avatar) => `${a.primary ? "★ " : ""}${a.name}${a.imported ? " (imported, please review)" : ""}${offersOf(a.id, links, offers).length ? ` → ${offersOf(a.id, links, offers).map((o) => `${o.name}${o.main ? " (main)" : ""}`).join(", ")}` : " → no offer linked"}`;
    const text = tree.map((n) => [line(n.avatar as Avatar), ...n.children.map((c) => `  · ${line(c as Avatar)}`)].join("\n")).join("\n");
    return { text, data: { avatars: tree.map((n) => ({ ...avatarOut(n.avatar as Avatar, rows, links, offers), subSegments: n.children.map((c) => avatarOut(c as Avatar, rows, links, offers)) })) } };
  },
});

export const avatarAdd = defineTool({
  name: "avatar_add",
  scope: "offers",
  kind: "write",
  description: "Adds a buyer avatar for the member: a name, an optional one-line description, optionally a sub-segment of another avatar (by name), and any of the ten fields (who they are, pains, wants, tried, objections, hangouts, phrases, why now, how the framework helps, not for). Write only what the member said.",
  input: {
    name: z.string().min(1).max(80).describe("The avatar's name, e.g. 'The booked-out coach'"),
    one_line: z.string().max(300).optional().describe("One line on who they are"),
    sub_segment_of: z.string().optional().describe("The name of the avatar this is a sub-segment of"),
    primary: z.boolean().optional().describe("Make it the member's Primary avatar"),
    ...fieldInputs,
  },
  handler: async (v, input): Promise<ToolResult> => {
    const m = member(v);
    const { rows } = await avatarData(m);
    const parent = input.sub_segment_of ? byName(rows, String(input.sub_segment_of)) : null;
    const r = await saveAvatar(m, null, { name: String(input.name ?? ""), oneLine: (input.one_line as string) ?? null, parentId: parent?.id ?? null, ...(input.primary ? { primary: true } : {}), ...fieldsOf(input) } as AvatarInput);
    if ("error" in r) throw new Error(r.error);
    const after = await avatarData(m);
    return { text: `Added "${r.avatar.name}"${parent ? `, a sub-segment of ${parent.name}` : ""}${r.avatar.primary ? ", the Primary" : ""}. Link it to an offer with offer_link_avatar.`, data: { avatar: avatarOut(r.avatar, after.rows, after.links, after.offers) } };
  },
});

export const avatarUpdate = defineTool({
  name: "avatar_update",
  scope: "offers",
  kind: "write",
  description: "Updates one of the member's avatars by its name (or words only one avatar's name contains). Only the fields given change; a field given as an empty string is cleared. Can rename it, make it Primary, or move it under another avatar as a sub-segment.",
  input: {
    avatar: z.string().min(1).describe("The avatar's name, or words from it"),
    new_name: z.string().max(80).optional().describe("A new name"),
    one_line: z.string().max(300).optional().describe("One line on who they are"),
    sub_segment_of: z.string().optional().describe("The name of the avatar to move it under, or an empty string to make it its own"),
    primary: z.boolean().optional().describe("true makes it the member's Primary avatar"),
    ...fieldInputs,
  },
  handler: async (v, input): Promise<ToolResult> => {
    const m = member(v);
    const { rows } = await avatarData(m);
    const a = byName(rows, String(input.avatar ?? ""));
    const parentId = input.sub_segment_of === undefined ? undefined : String(input.sub_segment_of).trim() ? byName(rows, String(input.sub_segment_of)).id : null;
    const fields = fieldsOf(input);
    const r = await saveAvatar(m, a.id, { ...(input.new_name ? { name: String(input.new_name) } : {}), ...(input.one_line !== undefined ? { oneLine: String(input.one_line) } : {}), ...(parentId !== undefined ? { parentId } : {}), ...(input.primary ? { primary: true } : {}), ...fields } as AvatarInput);
    if ("error" in r) throw new Error(r.error);
    const changed = [...(input.new_name ? ["name"] : []), ...(input.one_line !== undefined ? ["one line"] : []), ...(parentId !== undefined ? ["where it sits"] : []), ...(input.primary ? ["Primary"] : []), ...Object.keys(fields).map((f) => AVATAR_FIELD_INFO[f as AvatarField].short.toLowerCase())];
    const after = await avatarData(m);
    return { text: `Saved "${r.avatar.name}": ${changed.length ? changed.join(", ") : "nothing changed"}.`, data: { avatar: avatarOut(r.avatar, after.rows, after.links, after.offers) } };
  },
});

export const offerLinkAvatar = defineTool({
  name: "offer_link_avatar",
  scope: "offers",
  kind: "write",
  description: "Links one of the member's avatars to one of their offers (both by name), or unlinks it with unlink true. main true makes it the offer's main avatar, the one its drafts, webinar and deck are written for; an offer's first avatar is its main.",
  input: {
    avatar: z.string().min(1).describe("The avatar's name, or words from it"),
    offer: z.string().min(1).describe("The offer's name, or words from it"),
    main: z.boolean().optional().describe("Make it the offer's main avatar"),
    unlink: z.boolean().optional().describe("Unlink instead"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const m = member(v);
    const { rows, offers } = await avatarData(m);
    const a = byName(rows, String(input.avatar ?? ""));
    const o = offerByName(offers, String(input.offer ?? ""));
    const r = await linkOffer(m, a.id, o.id, { linked: !input.unlink, ...(input.main ? { main: true } : {}) });
    const text = input.unlink ? `Unlinked "${a.name}" from ${o.name}.` : `Linked "${a.name}" to ${o.name}${r.main ? " as its main avatar" : ""}.`;
    return { text, data: { avatar: a.name, offer: o.name, linked: !input.unlink, main: r.main } };
  },
});

/* ───────── Avatars by interview (rev 642): spoken, one question at a time; saved interviews make stop and resume work. ───────── */

const appUrl = siteUrl;
/** Where the interview stands, in words to read aloud: the next question, or the draft's summary with the page to keep it on. */
function interviewOut(row: AvatarInterview, rows: Avatar[]) {
  const target = row.avatarId ? (rows.find((a) => a.id === row.avatarId)?.name ?? "an avatar") : "a new avatar";
  const open = openTurn(row.turns);
  const fields: AvatarField[] = row.avatarId ? [...new Set(row.turns.map((t) => t.field))] : [...AVATAR_FIELDS];
  const link = `${appUrl()}/avatars/interview/${row.id}`;
  if (row.status === "draft" && row.draft) {
    const d = row.draft;
    const lines = fields.map((f) => `${AVATAR_FIELD_INFO[f].label}: ${d.fields[f]?.text.replace(/\n/g, " / ") ?? "not covered"}`);
    const text = [`The draft for ${target} is ready: ${draftSummary(d, fields)}.`, ...lines, d.dropped.length ? `Left out: ${d.dropped.join("; ")}.` : "", `Nothing is saved yet. Open it to keep, edit or skip each field and save: ${link}`].filter(Boolean).join("\n");
    return { text, data: { id: row.id, status: row.status, target, draft: d, link } };
  }
  if (row.status !== "open") return { text: `That interview is ${row.status}.`, data: { id: row.id, status: row.status, link } };
  if (!open) return { text: `Every question for ${target} is answered. Call avatar_interview_answer with enough: true to draft it.`, data: { id: row.id, status: row.status, link } };
  return { text: `${progressWords(row.turns, fields.length ? fields : [...AVATAR_FIELDS])} for ${target}: ${open.question}`, data: { id: row.id, status: row.status, question: open.question, field: open.field, followUp: open.followUp, answered: row.turns.filter((t) => t.answer !== null).length, link } };
}
async function currentInterview(v: Viewer): Promise<AvatarInterview> {
  const [row] = await openInterviews(v);
  if (!row) throw new Error("There's no interview under way. Start one with avatar_interview_start.");
  return row;
}

defineTool({
  name: "avatar_interview_start",
  scope: "offers",
  kind: "write",
  description:
    "Starts an interview that builds a buyer avatar from the member's own answers, or fills the empty fields of an avatar they name; picks up the one already under way, so stopping and coming back works. Read the question aloud and pass their answer, in their words, to avatar_interview_answer. Never answer for them or suggest an answer. Needs their AI key in HelixOS.",
  input: { avatar: z.string().max(120).optional().describe("Optional: the avatar to fill, by name; left out, a new avatar") },
  handler: async (v, input): Promise<ToolResult> => {
    const { rows } = await avatarData(member(v));
    const target = input.avatar ? byName(rows, String(input.avatar)) : null;
    const r = await startInterview(v, target?.id ?? null);
    if (!r.ok) throw new Error(r.error);
    return interviewOut(r.interview, rows);
  },
});

defineTool({
  name: "avatar_interview_answer",
  scope: "offers",
  kind: "write",
  description:
    "Gives the member's answer to the interview's current question, word for word as they said it (an empty answer skips it), and returns the next question, or the draft once every field is asked. enough: true drafts it now from the answers so far. The draft keeps only what they said; nothing is saved until they keep each field in HelixOS.",
  input: {
    answer: z.string().max(4000).optional().describe("Their answer, as they said it"),
    enough: z.boolean().optional().describe("true when the member says that's enough and wants the draft"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const row = await currentInterview(v);
    const r = await answerInterview(v, row.id, input.answer ? String(input.answer) : "", input.enough === true);
    if (!r.ok) throw new Error(r.error);
    return interviewOut(r.interview, (await avatarData(member(v))).rows);
  },
});

defineTool({
  name: "avatar_interview_status",
  scope: "offers",
  kind: "read",
  description: "Where the member's interview stands: the question waiting for an answer, or the draft with what was left out and the link to keep it. Read-only.",
  input: {},
  handler: async (v): Promise<ToolResult> => interviewOut(await currentInterview(v), (await avatarData(member(v))).rows),
});
