/**
 * Danno's frameworks on the server (H-1262, plan H-1270): the coach's import with a dry run first (re-runs update in place,
 * never double), publish and unpublish, what members read, and what the ladder writer is offered. The workspace's own.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { readFrameworks, rankFrameworks, type FrameworkEntry } from "@/lib/engine/frameworks";
import type { FrameworkStatus } from "@/lib/engine/teaching-kinds";

export type DryRun = { added: string[]; changed: string[]; unchanged: string[]; flagged: string[]; unreadable: string[] };
export type ImportCounts = { added: number; changed: number; unchanged: number; flagged: number; unreadable: string[] };

/** What an import would do, nothing saved: each framework named under new, changed, unchanged or flagged for a price. */
export async function dryRunFrameworks(workspaceId: string, text: string): Promise<DryRun> {
  const read = readFrameworks(text);
  const existing = await existingBySlug(workspaceId, read.entries);
  const out: DryRun = { added: [], changed: [], unchanged: [], flagged: [], unreadable: read.unreadable };
  for (const e of read.entries) {
    if (e.hasPrice) out.flagged.push(e.name);
    const was = existing.get(e.slug);
    if (!was) out.added.push(e.name);
    else if (was.digest === e.digest) out.unchanged.push(e.name);
    else out.changed.push(e.name);
  }
  return out;
}

async function existingBySlug(workspaceId: string, entries: FrameworkEntry[]) {
  const slugs = [...new Set(entries.map((e) => e.slug))];
  const rows = slugs.length ? await db.query.frameworks.findMany({ where: and(eq(schema.frameworks.workspaceId, workspaceId), inArray(schema.frameworks.slug, slugs)), columns: { id: true, slug: true, digest: true, status: true } }) : [];
  return new Map(rows.map((r) => [r.slug, r]));
}

/**
 * Saves the file: a new slug is inserted as a draft; a known slug is updated in place and keeps its status, except that a
 * framework now naming a price goes back to draft. Nothing is published here.
 */
export async function importFrameworks(workspaceId: string, text: string): Promise<ImportCounts> {
  const read = readFrameworks(text);
  const existing = await existingBySlug(workspaceId, read.entries);
  const counts: ImportCounts = { added: 0, changed: 0, unchanged: 0, flagged: 0, unreadable: read.unreadable };
  const seen = new Set<string>();
  for (const e of read.entries) {
    if (seen.has(e.slug)) continue; // the same name twice in one file: the first stands
    seen.add(e.slug);
    if (e.hasPrice) counts.flagged++;
    const was = existing.get(e.slug);
    if (was && was.digest === e.digest) {
      counts.unchanged++;
      continue;
    }
    const row = {
      name: e.name,
      pillar: e.pillar,
      rank: e.rank,
      idea: e.idea,
      steps: e.steps,
      whenToUse: e.whenToUse,
      mistakes: e.mistakes,
      story: e.story,
      exactWords: e.exactWords,
      sourceCall: e.sourceCall,
      sourceDate: e.sourceDate,
      fathomUrl: e.fathomUrl,
      contentAngles: e.contentAngles,
      borrowedFrom: e.borrowedFrom,
      evolution: e.evolution,
      rawStatus: e.rawStatus,
      hasPrice: e.hasPrice,
      digest: e.digest,
      updatedAt: nowIso(),
    };
    if (was) {
      await db.update(schema.frameworks).set({ ...row, ...(e.hasPrice && was.status === "published" ? { status: "draft" as const, publishedAt: null } : {}) }).where(and(eq(schema.frameworks.id, was.id), eq(schema.frameworks.workspaceId, workspaceId)));
      counts.changed++;
    } else {
      await db.insert(schema.frameworks).values({ id: newId(), workspaceId, slug: e.slug, status: "draft", ...row });
      counts.added++;
    }
  }
  return counts;
}

/** Publish or unpublish one. A framework that names a price can't be published: it stays a draft and the caller says why. */
export async function setFrameworkStatus(workspaceId: string, id: string, status: FrameworkStatus): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.query.frameworks.findFirst({ where: and(eq(schema.frameworks.id, id), eq(schema.frameworks.workspaceId, workspaceId)), columns: { id: true, hasPrice: true, name: true } });
  if (!row) return { ok: false, error: "That framework isn't here anymore." };
  if (status === "published" && row.hasPrice) return { ok: false, error: `${row.name} names a price, so it can't be published. Take the price out of the file and import again.` };
  await db.update(schema.frameworks).set({ status, publishedAt: status === "published" ? nowIso() : null, updatedAt: nowIso() }).where(eq(schema.frameworks.id, row.id));
  return { ok: true };
}

/** What a member sees on Doctrine: published, by pillar then name. The coach sees drafts too, marked. */
export async function frameworksFor(workspaceId: string, includeDrafts: boolean) {
  return db.query.frameworks.findMany({
    where: includeDrafts ? eq(schema.frameworks.workspaceId, workspaceId) : and(eq(schema.frameworks.workspaceId, workspaceId), eq(schema.frameworks.status, "published")),
    orderBy: [asc(schema.frameworks.pillar), asc(schema.frameworks.name)],
  });
}

export async function frameworkBySlug(workspaceId: string, slug: string, includeDrafts: boolean) {
  const row = await db.query.frameworks.findFirst({ where: and(eq(schema.frameworks.workspaceId, workspaceId), eq(schema.frameworks.slug, slug)) });
  if (!row) return null;
  return includeDrafts || row.status === "published" ? row : null;
}

/** The writer's picks (H-1270): published, never a price, the ones used in the last 10 ladders behind the fresh ones. */
export async function frameworkMaterial(workspaceId: string, briefWords: string[], usedRecently: Set<string>) {
  const rows = await db.query.frameworks.findMany({ where: and(eq(schema.frameworks.workspaceId, workspaceId), eq(schema.frameworks.status, "published"), eq(schema.frameworks.hasPrice, false)), orderBy: desc(schema.frameworks.updatedAt), limit: 200 });
  return rankFrameworks(rows, briefWords, usedRecently);
}
