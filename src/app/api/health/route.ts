import { NextResponse } from "next/server";
import { db, ensureMigrated, schema } from "@/db";

export async function GET() {
  await ensureMigrated();
  const [row] = await db.select({ key: schema.pathwayStages.key }).from(schema.pathwayStages).limit(1);
  return NextResponse.json({ ok: true, seeded: Boolean(row) });
}
