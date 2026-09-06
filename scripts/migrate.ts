/** Applies pending migrations to DATABASE_URL. Run before `next start` on a new deploy: `npm run db:migrate`. Idempotent. */
import { ensureMigrated } from "@/db";

ensureMigrated()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
