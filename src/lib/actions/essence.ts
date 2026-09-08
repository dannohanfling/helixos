"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ESSENCE_CAP, essenceChars, normalizeEssence, sectionByKey, type EssenceData, type Story } from "@/lib/engine/essence";
import { essenceFor } from "@/lib/queries/essence";
import { ctx, refresh, str } from "@/lib/action-helpers";

/**
 * Saves one section of the client's Essence. Every value is the client's own words; a story may be picked from their own
 * proof bank or story bank (their material, not invented). Refused over the 20,000-character cap, with nothing saved.
 */
export async function saveEssenceSectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const section = sectionByKey(str(formData, "section"));
  if (!section) return;
  const current = await essenceFor(workspaceId, userId);
  const values: Record<string, unknown> = {};
  for (const f of section.fields) {
    if (f.kind === "stories") {
      const names = formData.getAll("story_name").map(String);
      const summaries = formData.getAll("story_summary").map(String);
      const whens = formData.getAll("story_when").map(String);
      const stories: Story[] = names.map((name, i) => ({ name, summary: summaries[i] ?? "", when_to_use: whens[i] ?? "" }));
      const pick = str(formData, "story_from_bank");
      if (pick) {
        const [kind, id] = pick.split(":");
        if (kind === "proof") {
          const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) });
          if (p) stories.push({ name: p.name, summary: p.longVersion ?? p.shortVersion ?? p.resultAfter ?? "", when_to_use: p.beliefBroken !== "none" ? `Breaks the ${p.beliefBroken} belief` : "" });
        } else if (kind === "asset") {
          const a = await db.query.libraryAssets.findFirst({ where: and(eq(schema.libraryAssets.id, id), eq(schema.libraryAssets.userId, userId)) });
          if (a) stories.push({ name: a.name, summary: a.summary ?? a.body, when_to_use: a.useWhen ?? "" });
        }
      }
      values[f.key] = stories;
    } else {
      values[f.key] = str(formData, `${section.key}.${f.key}`);
    }
  }
  const next: EssenceData = normalizeEssence({ ...current, [section.key]: values });
  const chars = essenceChars(next);
  if (chars > ESSENCE_CAP) redirect(`/essence?step=${section.key}&over=${chars}`);
  const existing = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, workspaceId), eq(schema.essences.userId, userId)) });
  if (existing) await db.update(schema.essences).set({ data: next, updatedAt: nowIso() }).where(eq(schema.essences.id, existing.id));
  else await db.insert(schema.essences).values({ id: newId(), workspaceId, userId, data: next });
  refresh();
  const nextStep = str(formData, "next");
  redirect(`/essence?step=${sectionByKey(nextStep) ? nextStep : section.key}&saved=1`);
}
