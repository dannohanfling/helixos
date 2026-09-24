import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The keep-warm ping (24 Sep): pages sat on "Loading…" for 45 seconds after a quiet spell, a cold start, not a live read. The
 * smallest fix is the existing cron list calling the health route, which reads one row, every five minutes, so an instance and
 * its database connection stay warm. The reminders cron stays hourly and authenticated; the ping needs no secret.
 */
describe("the crons", () => {
  const crons = (JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
  it("keep an instance warm with the health route every five minutes, and still send the hourly reminders", () => {
    expect(crons).toContainEqual({ path: "/api/health", schedule: "*/5 * * * *" });
    expect(crons).toContainEqual({ path: "/api/cron/reminders", schedule: "0 * * * *" });
    expect(crons).toHaveLength(2);
  });
  it("the health route reads the database, so the ping warms the connection too, and returns no data", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/health/route.ts"), "utf8");
    expect(route).toMatch(/db\.select\(/);
    expect(route).toMatch(/NextResponse\.json\(\{ ok: true, seeded: Boolean\(row\) \}\)/);
  });
});
