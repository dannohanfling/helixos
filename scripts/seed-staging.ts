/**
 * Seeds the demo workspace on the staging database from a laptop (H-349 §1), the same seed the preview route runs:
 *   DATABASE_URL=libsql://helixos-staging-… DATABASE_AUTH_TOKEN=… ALLOW_DEMO_SEED=1 npx tsx --tsconfig tsconfig.json scripts/seed-staging.ts
 * Refuses a production database and any database that already holds a real workspace; prints counts only.
 */
export {};

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "1") throw new Error("Set ALLOW_DEMO_SEED=1 to say this database is staging and may be wiped.");
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) throw new Error("Point DATABASE_URL at the staging database (libsql://…), not a local file.");
  const { seedStaging } = await import("@/lib/staging-seed");
  const counts = await seedStaging();
  console.log(`staging seeded: ${counts.workspaces} workspace(s), ${counts.users} user(s), ${counts.memberships} membership(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
