/** Applies pending migrations to DATABASE_URL. Run before `next start` on a new deploy: `npm run db:migrate`. Idempotent. */
import { sql } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import stages from "@/data/seed/stages.json";
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
  await syncStageCopy();
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
 * The Pathway stages' words (name, tagline, description, criteria, duration) come from src/data/seed/stages.json and are
 * upserted on every migrate, so approved copy reaches production with the deploy. Progress rows reference stages by key
 * and are untouched.
 */
async function syncStageCopy(): Promise<void> {
  for (const s of stages) {
    await db
      .insert(schema.pathwayStages)
      .values({ ...s, tagline: s.tagline ?? null, description: s.description ?? null, entryCriteria: s.entryCriteria ?? null, exitCriteria: s.exitCriteria ?? null })
      .onConflictDoUpdate({ target: schema.pathwayStages.key, set: { ...s } });
  }
}
