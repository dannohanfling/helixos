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

type Db = ReturnType<typeof drizzle<typeof schema>>;

function create(): Db {
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

/** The real client is created on first use, so importing this module (for example while Next collects build data) never opens a connection. */
function lazy(): Db {
  let real: Db | undefined;
  const get = () => {
    if (!real) {
      real = globalThis.__helixDb ?? create();
      if (process.env.NODE_ENV !== "production") globalThis.__helixDb = real;
    }
    return real;
  };
  return new Proxy({} as Db, {
    get(_t, prop) {
      const target = get() as unknown as Record<string | symbol, unknown>;
      const v = target[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export const db: Db = lazy();

/**
 * Applies pending migrations. Only for scripts (npm run db:migrate, db:seed, db:bootstrap), never from a request handler:
 * calling this during a request means Next's build-time prerender runs it too, in parallel workers, against production.
 */
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
