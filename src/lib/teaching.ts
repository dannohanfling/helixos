import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { TAKE, ftsQuery, rank, readLibrary, readStoryBank, searchWords, type StoryItem, type TeachingEntry } from "@/lib/engine/teaching";

/**
 * Danno's teaching library and story bank on the server (rev 615 plan, rev 618 answers): the upload's import (re-runs update,
 * never double), the full-text index beside each table (FTS5, kept in step here, the one writer), and what a ladder is given
 * and used. The coach's own: a client's ladder never reads any of it.
 */
const sum = (o: unknown) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 24);
export type ImportCounts = { kind: "library" | "stories"; added: number; updated: number; unchanged: number; priced: number; unreadable: string[] };

/** Which file is which: the story bank by its name, everything else a library file. */
export const kindOfFile = (name: string): "library" | "stories" => (/story[\s_-]*bank/i.test(name) ? "stories" : "library");

export async function importTeachingText(workspaceId: string, userId: string, fileName: string, text: string): Promise<ImportCounts> {
  const kind = kindOfFile(fileName);
  return kind === "stories" ? importStories(workspaceId, userId, text) : importLibrary(workspaceId, userId, fileName, text);
}

async function importLibrary(workspaceId: string, userId: string, fileName: string, text: string): Promise<ImportCounts> {
  const read = readLibrary(text);
  const counts: ImportCounts = { kind: "library", added: 0, updated: 0, unchanged: 0, priced: 0, unreadable: read.unreadable };
  const keys = read.entries.map((e) => e.key);
  const existing = new Map<string, { id: string; digest: string }>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db.query.teachingEntries.findMany({ where: and(eq(schema.teachingEntries.userId, userId), inArray(schema.teachingEntries.key, keys.slice(i, i + 500))), columns: { id: true, key: true, digest: true } });
    for (const r of rows) existing.set(r.key, r);
  }
  for (const e of read.entries) {
    if (e.hasPrice) counts.priced++;
    const h = sum([e.question, e.answer, e.topic, e.category, e.taughtOn, e.callType, fileName]);
    const was = existing.get(e.key);
    if (was && was.digest === h) { counts.unchanged++; continue; }
    const row = { file: fileName, question: e.question, answer: e.answer, topic: e.topic, category: e.category, taughtOn: e.taughtOn, callType: e.callType, hasPrice: e.hasPrice, digest: h, updatedAt: nowIso() };
    const id = was?.id ?? newId();
    if (was) { await db.update(schema.teachingEntries).set(row).where(and(eq(schema.teachingEntries.id, id), eq(schema.teachingEntries.userId, userId))); counts.updated++; }
    else { await db.insert(schema.teachingEntries).values({ id, workspaceId, userId, key: e.key, ...row }); counts.added++; }
    await db.run(sql`DELETE FROM teaching_fts WHERE entry_id = ${id}`);
    await db.run(sql`INSERT INTO teaching_fts (question, answer, topic, category, entry_id, user_id) VALUES (${e.question}, ${e.answer}, ${e.topic ?? ""}, ${e.category ?? ""}, ${id}, ${userId})`);
  }
  return counts;
}

async function importStories(workspaceId: string, userId: string, text: string): Promise<ImportCounts> {
  const read = readStoryBank(text);
  const counts: ImportCounts = { kind: "stories", added: 0, updated: 0, unchanged: 0, priced: 0, unreadable: read.unreadable };
  const rows = await db.query.storyItems.findMany({ where: eq(schema.storyItems.userId, userId), columns: { id: true, key: true, digest: true, statusSetBy: true } });
  const existing = new Map(rows.map((r) => [r.key, r]));
  for (const e of read.entries) {
    if (e.hasPrice) counts.priced++;
    const h = sum([e.title, e.type, e.what, e.exactWords, e.numbers, e.goodFor, e.rawStatus, e.sourceCall, e.sourceDate, e.fathomUrl]);
    const was = existing.get(e.key);
    if (was && was.digest === h) { counts.unchanged++; continue; }
    const row = { title: e.title, type: e.type, what: e.what, exactWords: e.exactWords, numbers: e.numbers, goodFor: e.goodFor, rawStatus: e.rawStatus, sourceCall: e.sourceCall, sourceDate: e.sourceDate, fathomUrl: e.fathomUrl, hasPrice: e.hasPrice, digest: h, updatedAt: nowIso() };
    const id = was?.id ?? newId();
    // A status Danno set in the app stands over the file's on a re-upload.
    if (was) { await db.update(schema.storyItems).set({ ...row, ...(was.statusSetBy ? {} : { status: e.status }) }).where(and(eq(schema.storyItems.id, id), eq(schema.storyItems.userId, userId))); counts.updated++; }
    else { await db.insert(schema.storyItems).values({ id, workspaceId, userId, key: e.key, status: e.status, ...row }); counts.added++; }
    await db.run(sql`DELETE FROM story_fts WHERE item_id = ${id}`);
    await db.run(sql`INSERT INTO story_fts (title, what, exact_words, numbers, good_for, item_id, user_id) VALUES (${e.title}, ${e.what}, ${e.exactWords ?? ""}, ${e.numbers ?? ""}, ${e.goodFor ?? ""}, ${id}, ${userId})`);
  }
  return counts;
}

export type Material = { teaching: (TeachingEntry & { id: string })[]; stories: (StoryItem & { id: string })[] };

/**
 * What the writer is given for one ladder of the coach's own: the best 12 library entries and 8 ready stories for its words,
 * never a price, never a story that isn't ready, the ones used in the last 10 ladders behind the fresh ones.
 */
export async function materialFor(userId: string, input: { topic: string; formatName: string; target?: string | null; source?: string | null }): Promise<Material> {
  const words = searchWords(input);
  if (!words.length) return { teaching: [], stories: [] };
  const q = ftsQuery(words);
  const recent = await db.query.ladders.findMany({ where: eq(schema.ladders.userId, userId), orderBy: desc(schema.ladders.createdAt), limit: 10, columns: { id: true } });
  const used = recent.length ? await db.query.ladderMaterial.findMany({ where: and(eq(schema.ladderMaterial.userId, userId), inArray(schema.ladderMaterial.ladderId, recent.map((l) => l.id)), eq(schema.ladderMaterial.used, true)), columns: { itemId: true } }) : [];
  const usedIds = new Set(used.map((u) => u.itemId));
  const tHits = (await db.all<{ entry_id: string; score: number }>(sql`SELECT entry_id, -bm25(teaching_fts) AS score FROM teaching_fts WHERE teaching_fts MATCH ${q} AND user_id = ${userId} ORDER BY bm25(teaching_fts) LIMIT 80`));
  const sHits = (await db.all<{ item_id: string; score: number }>(sql`SELECT item_id, -bm25(story_fts) AS score FROM story_fts WHERE story_fts MATCH ${q} AND user_id = ${userId} ORDER BY bm25(story_fts) LIMIT 60`));
  const tRows = tHits.length ? await db.query.teachingEntries.findMany({ where: and(eq(schema.teachingEntries.userId, userId), inArray(schema.teachingEntries.id, tHits.map((h) => h.entry_id)), eq(schema.teachingEntries.hasPrice, false)) }) : [];
  const sRows = sHits.length ? await db.query.storyItems.findMany({ where: and(eq(schema.storyItems.userId, userId), inArray(schema.storyItems.id, sHits.map((h) => h.item_id)), eq(schema.storyItems.status, "ready"), eq(schema.storyItems.hasPrice, false)) }) : [];
  const tById = new Map(tRows.map((r) => [r.id, r]));
  const sById = new Map(sRows.map((r) => [r.id, r]));
  const teaching = rank(tHits.flatMap((h) => (tById.has(h.entry_id) ? [{ item: { ...tById.get(h.entry_id)!, key: h.entry_id, goodFor: null }, score: h.score }] : [])), { formatName: input.formatName, usedRecently: usedIds, take: TAKE.teaching });
  const stories = rank(sHits.flatMap((h) => (sById.has(h.item_id) ? [{ item: { ...sById.get(h.item_id)!, key: h.item_id }, score: h.score }] : [])), { formatName: input.formatName, usedRecently: usedIds, take: TAKE.stories });
  return { teaching: teaching as unknown as Material["teaching"], stories: stories as unknown as Material["stories"] };
}

export type Offered = { kind: "teaching" | "story"; itemId: string; tag: string };
/** The ids the writer saw, T1… for library answers and S1… for stories, in the order the block lists them. */
export const offeredOf = (m: Material): Offered[] => [...m.teaching.map((t, i) => ({ kind: "teaching" as const, itemId: t.id, tag: `T${i + 1}` })), ...m.stories.map((s, i) => ({ kind: "story" as const, itemId: s.id, tag: `S${i + 1}` }))];

/** What one ladder was given and which of it the writer said it used. A rewrite replaces the ladder's rows. */
export async function recordMaterial(workspaceId: string, userId: string, ladderId: string, offered: Offered[], used: string[]): Promise<void> {
  await db.delete(schema.ladderMaterial).where(and(eq(schema.ladderMaterial.ladderId, ladderId), eq(schema.ladderMaterial.userId, userId)));
  if (!offered.length) return;
  const named = new Set(used);
  await db.insert(schema.ladderMaterial).values(offered.map((o) => ({ id: newId(), workspaceId, userId, ladderId, kind: o.kind, itemId: o.itemId, tag: o.tag, used: named.has(o.tag) })));
}

export type MaterialLine = { tag: string; kind: "teaching" | "story"; type: string; title: string; firstLine: string; status: string | null; fathomUrl: string | null; source: string | null };
/** The Material used panel: each item the writer named, with where it came from. Items deleted since are left out. */
export async function materialUsedFor(userId: string, ladderId: string): Promise<MaterialLine[]> {
  const rows = await db.query.ladderMaterial.findMany({ where: and(eq(schema.ladderMaterial.ladderId, ladderId), eq(schema.ladderMaterial.userId, userId), eq(schema.ladderMaterial.used, true)) });
  if (!rows.length) return [];
  const tIds = rows.filter((r) => r.kind === "teaching").map((r) => r.itemId);
  const sIds = rows.filter((r) => r.kind === "story").map((r) => r.itemId);
  const [ts, ss] = await Promise.all([
    tIds.length ? db.query.teachingEntries.findMany({ where: and(eq(schema.teachingEntries.userId, userId), inArray(schema.teachingEntries.id, tIds)) }) : [],
    sIds.length ? db.query.storyItems.findMany({ where: and(eq(schema.storyItems.userId, userId), inArray(schema.storyItems.id, sIds)) }) : [],
  ]);
  const first = (x: string) => x.split("\n").find((l) => l.trim())?.trim().slice(0, 160) ?? "";
  return rows.flatMap((r): MaterialLine[] => {
    if (r.kind === "teaching") {
      const t = ts.find((x) => x.id === r.itemId);
      return t ? [{ tag: r.tag, kind: "teaching", type: "Answer", title: t.question, firstLine: first(t.answer), status: null, fathomUrl: null, source: [t.file, [t.topic, t.taughtOn, t.callType].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null }] : [];
    }
    const s = ss.find((x) => x.id === r.itemId);
    return s ? [{ tag: r.tag, kind: "story", type: s.type, title: s.title, firstLine: first(s.what), status: s.status, fathomUrl: s.fathomUrl, source: [s.sourceCall, s.sourceDate].filter(Boolean).join(", ") || null }] : [];
  }).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
}
