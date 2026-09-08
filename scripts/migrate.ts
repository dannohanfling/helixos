/** Applies pending migrations to DATABASE_URL. Run before `next start` on a new deploy: `npm run db:migrate`. Idempotent. */
import { sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import stages from "@/data/seed/stages.json";
import library from "@/data/seed/task_library.json";
import socratesQuestions from "@/data/seed/socrates/questions.json";
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
  for (const q of socratesQuestions) {
    const row = { key: q.id, workspaceId: null, userId: null, question: q.question, clarityStage: q.clarityStage, nepqCategory: q.nepqCategory, source: q.source, scriptTypes: q.scriptTypes };
    await db
      .insert(schema.socratesQuestions)
      .values({ id: `socrates-${q.id}`, ...row })
      .onConflictDoUpdate({ target: schema.socratesQuestions.key, set: row });
  }
}
