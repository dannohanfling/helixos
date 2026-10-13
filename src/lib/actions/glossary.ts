"use server";

/**
 * Coach → Glossary (rev 768): edit, add or hide an entry of the workspace's glossary. The seed stays as written in
 * src/content/glossary.ts; a change is a row on top of it, and "Back to the original" takes the row away again.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { GLOSSARY_SEED } from "@/content/glossary";
import { GLOSSARY_HEADINGS, GLOSSARY_MAX, glossarySlug } from "@/lib/engine/glossary";

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const headingOf = (raw: string) => (GLOSSARY_HEADINGS.includes(raw) ? raw : GLOSSARY_HEADINGS[GLOSSARY_HEADINGS.length - 1]);

export async function saveGlossaryEntryAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const slug = str(formData, "slug");
  const term = clean(str(formData, "term"), GLOSSARY_MAX.term);
  const meaning = clean(str(formData, "meaning"), GLOSSARY_MAX.meaning);
  if (!slug || !term || !meaning) return;
  const values = { term, meaning, heading: headingOf(str(formData, "heading")), hidden: formData.get("hidden") === "on", updatedAt: nowIso() };
  const had = await db.query.glossaryEntries.findFirst({ where: and(eq(schema.glossaryEntries.workspaceId, coach.workspace.id), eq(schema.glossaryEntries.slug, slug)) });
  if (had) await db.update(schema.glossaryEntries).set(values).where(eq(schema.glossaryEntries.id, had.id));
  else if (GLOSSARY_SEED.some((s) => s.entries.some((e) => e.slug === slug))) await db.insert(schema.glossaryEntries).values({ id: newId(), workspaceId: coach.workspace.id, slug, ...values });
  refresh();
}

export async function addGlossaryEntryAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const term = clean(str(formData, "term"), GLOSSARY_MAX.term);
  const meaning = clean(str(formData, "meaning"), GLOSSARY_MAX.meaning);
  if (!term || !meaning) return;
  const rows = await db.query.glossaryEntries.findMany({ where: eq(schema.glossaryEntries.workspaceId, coach.workspace.id), columns: { slug: true } });
  const taken = new Set([...rows.map((r) => r.slug), ...GLOSSARY_SEED.flatMap((s) => s.entries.map((e) => e.slug))]);
  await db.insert(schema.glossaryEntries).values({ id: newId(), workspaceId: coach.workspace.id, slug: glossarySlug(term, taken), term, meaning, heading: headingOf(str(formData, "heading")), hidden: false, updatedAt: nowIso() });
  refresh();
}

/** A seeded entry goes back to Danno's words; an added one comes out of the glossary. */
export async function resetGlossaryEntryAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await db.delete(schema.glossaryEntries).where(and(eq(schema.glossaryEntries.workspaceId, coach.workspace.id), eq(schema.glossaryEntries.slug, str(formData, "slug"))));
  refresh();
}
