/** Applies pending migrations to DATABASE_URL. Run before `next start` on a new deploy: `npm run db:migrate`. Idempotent. */
import { sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import stages from "@/data/seed/stages.json";
import library from "@/data/seed/task_library.json";
import socratesQuestions from "@/data/seed/socrates/questions.json";
import researchSeed from "@/data/research-library-seed-v2.json";
import objectionSeed from "@/data/seed/webinar/objections.json";
import { and, eq, isNull } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { ADMIN_ONBOARDING_KEYS } from "@/lib/engine/pathway";
import { hashSecret } from "@/lib/crypto";

/**
 * Inbound webhook secrets used to be stored in plain text (integrations.inbound_secret). Migration 0011 drops that column, so the
 * plaintext is read first and its sha256 written to inbound_secret_hash afterwards. Existing secrets already pasted into
 * GoHighLevel or Community Loyalty keep working. No-op on databases that never had the column.
 */
async function readLegacyInboundSecrets(): Promise<{ id: string; secret: string }[]> {
  try {
    const rows = await db.all<{ id: string; inbound_secret: string | null }>(sql`select id, inbound_secret from integrations where inbound_secret is not null`);
    return rows.map((r) => ({ id: r.id, secret: r.inbound_secret ?? "" })).filter((r) => r.secret);
  } catch {
    return [];
  }
}

async function main() {
  const legacy = await readLegacyInboundSecrets();
  await ensureMigrated();
  await syncLibrary();
  for (const { id, secret } of legacy) {
    await db.run(sql`update integrations set inbound_secret_hash = ${hashSecret(secret)} where id = ${id} and inbound_secret_hash is null`);
  }
  console.log(legacy.length ? `Migrations applied. ${legacy.length} inbound secret(s) moved to hashed storage.` : "Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * The Pathway's words and shape come from src/data/seed/stages.json and task_library.json and are upserted on every
 * migrate, so approved copy and a moved task reach production with the deploy. Rows are keyed by stable keys; a member's
 * progress rows point at task keys and are untouched.
 */
async function syncLibrary(): Promise<void> {
  for (const s of stages) {
    await db
      .insert(schema.pathwayStages)
      .values({ ...s, tagline: s.tagline ?? null, description: s.description ?? null, entryCriteria: s.entryCriteria ?? null, exitCriteria: s.exitCriteria ?? null })
      .onConflictDoUpdate({ target: schema.pathwayStages.key, set: { ...s } });
  }
  for (const t of library) {
    const row = {
      key: t.key,
      stageKey: t.stage,
      order: t.order,
      name: t.name,
      teaching: t.teaching ?? null,
      howTo: t.howTo ?? null,
      submissionType: t.submissionType as schema.LibraryTask["submissionType"],
      points: t.points,
      effort: t.effort as schema.LibraryTask["effort"],
      priority: ADMIN_ONBOARDING_KEYS.has(t.key) ? ("optional" as const) : (t.priority as schema.LibraryTask["priority"]),
      unlocks: t.unlocks ?? null,
      trainingUrl: t.trainingUrl ?? null,
    };
    await db.insert(schema.libraryTasks).values(row).onConflictDoUpdate({ target: schema.libraryTasks.key, set: row });
  }
  // Socrates Domain's question library: keyed by the seed id, so an update reaches every workspace; a client's own questions have no key and are never touched.
  // The Evidence starter shelf: Danno's nine studies, every one with a DOI resolved through OpenAlex, keyed by seed id. A client's own rows live elsewhere.
  for (const s of researchSeed) {
    const row = { name: s.name, authorsSource: s.authorsSource, category: s.category, confidenceLevel: s.confidenceLevel, shortSummary: s.shortSummary, whyItMatters: s.whyItMatters, fifteenSecondScript: s.fifteenSecondScript, thirtySecondReelScript: s.thirtySecondReelScript, clipHook: s.clipHook, supports: s.supports, doi: s.doi, url: s.url, openalexId: s.openalexId, citationQuality: s.citationQuality, verifiedTitle: s.verifiedTitle, verifiedYear: s.verifiedYear, citedByCount: s.citedByCount };
    await db.insert(schema.evidenceShared).values({ id: s.id, ...row }).onConflictDoUpdate({ target: schema.evidenceShared.id, set: row });
  }
  // The shared objection set: the template's own entries, matched by name (they have no stable key), inserted where missing
  // and their belief mapping kept current. A client's own objections have a userId and are never touched.
  for (const ob of objectionSeed as { name: string; body: string; reframe?: string | null; proof?: string | null; stage?: string | null; objectionType?: string | null; universal?: boolean; belief?: string | null }[]) {
    const belief = (schema.BELIEF_KEYS as readonly string[]).includes(ob.belief ?? "") ? (ob.belief as schema.BeliefKey) : null;
    const existing = await db.query.libraryAssets.findFirst({ where: and(eq(schema.libraryAssets.type, "objection"), isNull(schema.libraryAssets.workspaceId), isNull(schema.libraryAssets.userId), eq(schema.libraryAssets.name, ob.name)) });
    if (existing) await db.update(schema.libraryAssets).set({ belief }).where(eq(schema.libraryAssets.id, existing.id));
    else await db.insert(schema.libraryAssets).values({ id: newId(), type: "objection", name: ob.name, body: ob.body, reframe: ob.reframe ?? null, proof: ob.proof ?? null, useWhen: ob.stage ?? null, tag: ob.objectionType ?? null, isExample: !ob.universal, belief });
  }
  for (const q of socratesQuestions) {
    const row = { key: q.id, workspaceId: null, userId: null, question: q.question, clarityStage: q.clarityStage, nepqCategory: q.nepqCategory, source: q.source, scriptTypes: q.scriptTypes };
    await db
      .insert(schema.socratesQuestions)
      .values({ id: `socrates-${q.id}`, ...row })
      .onConflictDoUpdate({ target: schema.socratesQuestions.key, set: row });
  }
}
