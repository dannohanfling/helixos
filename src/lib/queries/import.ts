import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ImportPlan } from "@/lib/engine/airtable-import";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { essenceChars, normalizeEssence, type EssenceData } from "@/lib/engine/essence";

/** What the client already holds from an earlier run, as "area:sourceRef", so the dry run can say update, not create. */
export async function existingRefs(workspaceId: string, userId: string): Promise<Set<string>> {
  const [pathways, offers, magnets, assets, goals, tasks, groups] = await Promise.all([
    db.query.pathways.findMany({ where: and(eq(schema.pathways.workspaceId, workspaceId), eq(schema.pathways.userId, userId)) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, workspaceId), eq(schema.offers.userId, userId)) }),
    db.query.leadMagnets.findMany({ where: and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.userId, userId)) }),
    db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.workspaceId, workspaceId), eq(schema.libraryAssets.userId, userId)) }),
    db.query.goals.findMany({ where: and(eq(schema.goals.workspaceId, workspaceId), eq(schema.goals.userId, userId)) }),
    db.query.tasks.findMany({ where: and(eq(schema.tasks.workspaceId, workspaceId), eq(schema.tasks.userId, userId), eq(schema.tasks.source, "airtable")) }),
    db.query.groups.findMany({ where: and(eq(schema.groups.workspaceId, workspaceId), eq(schema.groups.userId, userId)) }),
  ]);
  const out = new Set<string>();
  const put = (area: string, refs: (string | null)[]) => refs.forEach((r) => r && out.add(`${area}:${r}`));
  put("pathways", pathways.map((p) => p.sourceRef));
  for (const o of offers) if (o.sourceRef) out.add(`${o.status === "retired" ? "archived offers" : "offers"}:${o.sourceRef}`);
  put("lead magnets", magnets.map((m) => m.sourceRef));
  const areaOf = { story: "stories", belief: "beliefs", framework: "frameworks", journey_stage: "journey" } as Record<string, string>;
  for (const a of assets) if (a.sourceRef && areaOf[a.type]) out.add(`${areaOf[a.type]}:${a.sourceRef}`);
  put("revenue goals", goals.map((g) => g.sourceRef));
  put("tasks", tasks.map((t) => t.sourceRef));
  put("groups", groups.map((g) => g.sourceRef));
  const essence = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, workspaceId), eq(schema.essences.userId, userId)) });
  if ((essence?.data as Record<string, unknown> | undefined)?.brand) out.add("brand:*");
  return out;
}

/** The client's Essence with the plan's keys set, as Approve writes it; the dry run measures it against the cap. */
export async function mergedEssence(plan: ImportPlan, workspaceId: string, userId: string) {
  const row = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, workspaceId), eq(schema.essences.userId, userId)) });
  const data = normalizeEssence(row?.data ?? {}) as Record<string, Record<string, unknown>>;
  for (const [section, fields] of Object.entries(plan.essence)) data[section] = { ...(data[section] ?? {}), ...fields };
  return { row, data, chars: essenceChars(data as EssenceData) };
}

/** Rows written in groups: one round trip per group, so a base of a thousand rows stays inside a request. */
async function inBatches(statements: Parameters<typeof db.batch>[0][number][]): Promise<void> {
  for (let i = 0; i < statements.length; i += 50) {
    const chunk = statements.slice(i, i + 50);
    if (chunk.length) await db.batch(chunk as unknown as Parameters<typeof db.batch>[0]);
  }
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "magnet";

/**
 * Write the plan the coach approved into the client's HelixOS. Every row is matched on its Airtable id for this client, so a
 * re-run updates in place. Essence keys the base provides are set; the rest of the client's Essence is left as it is.
 */
export async function applyImport(plan: ImportPlan, workspaceId: string, userId: string): Promise<{ written: number }> {
  const now = nowIso();
  const by = <T extends { sourceRef: string | null; id: string }>(rows: T[]) => new Map(rows.filter((r) => r.sourceRef).map((r) => [r.sourceRef as string, r.id]));
  let written = 0;

  // Pathways, then offers (they point at a pathway), then the archived ones' replacement link.
  const pathwayIds = by(await db.query.pathways.findMany({ where: and(eq(schema.pathways.workspaceId, workspaceId), eq(schema.pathways.userId, userId)) }));
  const stmts: Parameters<typeof db.batch>[0][number][] = [];
  for (const p of plan.pathways) {
    const values = { name: p.name, tierPrefix: p.tierPrefix, order: p.order, founderStory: p.founderStory, tagline: p.tagline, audiencePromise: p.audiencePromise, promiseEvidence: p.promiseEvidence };
    const id = pathwayIds.get(p.sourceRef);
    if (id) stmts.push(db.update(schema.pathways).set(values).where(eq(schema.pathways.id, id)));
    else {
      const nid = newId();
      pathwayIds.set(p.sourceRef, nid);
      stmts.push(db.insert(schema.pathways).values({ id: nid, workspaceId, userId, sourceRef: p.sourceRef, ...values }));
    }
  }
  await inBatches(stmts.splice(0));
  written += plan.pathways.length;

  const offerIds = by(await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, workspaceId), eq(schema.offers.userId, userId)) }));
  for (const o of plan.offers) {
    const values = {
      name: o.name,
      status: o.status,
      price: o.price,
      currency: "NZD",
      tierCode: o.tierCode,
      tierOrder: o.tierOrder,
      pathwayId: o.pathway ? (pathwayIds.get(`pathway:${o.pathway}`) ?? null) : null,
      arcStage: o.arcStage,
      headline: o.headline,
      promise: o.promise,
      coreProblem: o.coreProblem,
      oneBelief: o.oneBelief,
      currentSituation: o.currentSituation,
      desiredSituation: o.desiredSituation,
      coreComponents: o.coreComponents,
      deliverables: o.deliverables,
      oneLiners: o.oneLiners,
      guarantee: o.guarantee,
      trust: o.trust,
      getStarted: o.getStarted,
      purpose: o.purpose,
      objMoney: o.objMoney,
      objTime: o.objTime,
      objTriedBefore: o.objTriedBefore,
      objPartner: o.objPartner,
      objWrongTime: o.objWrongTime,
    };
    const id = offerIds.get(o.sourceRef);
    if (id) stmts.push(db.update(schema.offers).set(values).where(eq(schema.offers.id, id)));
    else {
      const nid = newId();
      offerIds.set(o.sourceRef, nid);
      stmts.push(db.insert(schema.offers).values({ id: nid, workspaceId, userId, sourceRef: o.sourceRef, ...values }));
    }
  }
  await inBatches(stmts.splice(0));
  for (const o of plan.offers) if (o.replacedBy) stmts.push(db.update(schema.offers).set({ replacedByOfferId: offerIds.get(o.replacedBy) ?? null }).where(eq(schema.offers.id, offerIds.get(o.sourceRef)!)));
  await inBatches(stmts.splice(0));
  written += plan.offers.length;

  // Lead magnets: a keyword and a page address each, made unique; the asset link and status kept in the notes.
  const magnets = await db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.workspaceId, workspaceId) });
  const magnetIds = by(magnets.filter((m) => m.userId === userId));
  const keywords = new Set(magnets.map((m) => m.keyword));
  for (const m of plan.magnets) {
    const notes = [m.link && `Asset link: ${m.link}`, m.status && `Status in Airtable: ${m.status}`, m.mergedWith && "Merged with the Lead Magnet table's row of the same name."].filter(Boolean).join("\n") || null;
    const id = magnetIds.get(m.sourceRef);
    if (id) stmts.push(db.update(schema.leadMagnets).set({ title: m.title, notes, updatedAt: now }).where(eq(schema.leadMagnets.id, id)));
    else {
      let keyword = m.title.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 12) || "MAGNET";
      for (let i = 2; keywords.has(keyword); i++) keyword = `${keyword.replace(/\d+$/, "")}${i}`;
      keywords.add(keyword);
      stmts.push(db.insert(schema.leadMagnets).values({ id: newId(), workspaceId, userId, sourceRef: m.sourceRef, title: m.title, keyword, slug: `${slugify(m.title)}-${newId().slice(0, 6)}`, notes, origin: "coach" }));
    }
  }
  await inBatches(stmts.splice(0));
  written += plan.magnets.length;

  // The bank: stories, beliefs, frameworks and the journey. A journey stage's offer links become this client's offer ids.
  const assetIds = by(await db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.workspaceId, workspaceId), eq(schema.libraryAssets.userId, userId)) }));
  for (const a of plan.assets) {
    const extra: Record<string, string | null> = { ...a.extra };
    if (extra.offer_refs) {
      extra.offer_ids = extra.offer_refs.split(",").map((r) => offerIds.get(r)).filter(Boolean).join(",") || null;
      delete extra.offer_refs;
    }
    const values = { type: a.type, name: a.name, body: a.body, summary: a.summary, useWhen: a.useWhen, tag: a.tag, extra };
    const id = assetIds.get(a.sourceRef);
    if (id) stmts.push(db.update(schema.libraryAssets).set(values).where(eq(schema.libraryAssets.id, id)));
    else stmts.push(db.insert(schema.libraryAssets).values({ id: newId(), workspaceId, userId, sourceRef: a.sourceRef, ...values }));
  }
  await inBatches(stmts.splice(0));
  written += plan.assets.length;

  const goalIds = by(await db.query.goals.findMany({ where: and(eq(schema.goals.workspaceId, workspaceId), eq(schema.goals.userId, userId)) }));
  for (const g of plan.goals) {
    const values = { title: g.title, target: g.target, unit: g.unit, period: g.period, primary: false };
    const id = goalIds.get(g.sourceRef);
    if (id) stmts.push(db.update(schema.goals).set(values).where(eq(schema.goals.id, id)));
    else stmts.push(db.insert(schema.goals).values({ id: newId(), workspaceId, userId, sourceRef: g.sourceRef, ...values }));
  }
  await inBatches(stmts.splice(0));
  written += plan.goals.length;

  const taskIds = by(await db.query.tasks.findMany({ where: and(eq(schema.tasks.workspaceId, workspaceId), eq(schema.tasks.userId, userId), eq(schema.tasks.source, "airtable")) }));
  for (const t of plan.tasks) {
    const values = { title: t.title, details: t.details, status: t.status, urgency: t.urgency, category: t.category, dueDate: t.dueDate, completedAt: t.status === "done" ? (t.completedAt ?? now) : null, assignee: t.assignee, importRefs: t.refs };
    const id = taskIds.get(t.sourceRef);
    if (id) stmts.push(db.update(schema.tasks).set(values).where(eq(schema.tasks.id, id)));
    else stmts.push(db.insert(schema.tasks).values({ id: newId(), workspaceId, userId, source: "airtable", sourceRef: t.sourceRef, ...values }));
  }
  await inBatches(stmts.splice(0));
  written += plan.tasks.length;

  const groupIds = by(await db.query.groups.findMany({ where: and(eq(schema.groups.workspaceId, workspaceId), eq(schema.groups.userId, userId)) }));
  for (const g of plan.groups) {
    const values = { name: g.name, url: g.url, notes: g.notes };
    const id = groupIds.get(g.sourceRef);
    if (id) stmts.push(db.update(schema.groups).set(values).where(eq(schema.groups.id, id)));
    else stmts.push(db.insert(schema.groups).values({ id: newId(), workspaceId, userId, sourceRef: g.sourceRef, ...values }));
  }
  await inBatches(stmts.splice(0));
  written += plan.groups.length;

  // Essence: each key the base provides, set; everything else the client wrote stays.
  if (Object.keys(plan.essence).length) {
    const { row, data } = await mergedEssence(plan, workspaceId, userId);
    if (row) await db.update(schema.essences).set({ data }).where(eq(schema.essences.id, row.id));
    else await db.insert(schema.essences).values({ id: newId(), workspaceId, userId, data });
    written += 1;
  }
  return { written };
}
