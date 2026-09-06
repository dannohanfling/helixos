import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

declare global {
  var __helixDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
  var __helixMigrated: Promise<void> | undefined;
}

function create() {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

export const db = globalThis.__helixDb ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__helixDb = db;

/** Applies pending migrations once per process. Safe to call from any request. */
export function ensureMigrated(): Promise<void> {
  if (!globalThis.__helixMigrated) {
    globalThis.__helixMigrated = migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") }).catch((err) => {
      globalThis.__helixMigrated = undefined;
      throw err;
    });
  }
  return globalThis.__helixMigrated;
}

export { schema };
