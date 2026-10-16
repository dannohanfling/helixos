import { NextResponse } from "next/server";
import { seedStaging, stagingSeedRefusal } from "@/lib/staging-seed";

export const dynamic = "force-dynamic";

/**
 * GET /api/setup/seed-staging?token=SETUP_TOKEN (H-349 §1): seeds the demo workspace on a Vercel preview whose Preview
 * environment carries ALLOW_DEMO_SEED=1 and SETUP_TOKEN. Anything else is a 404 that names no reason, like /setup. Danno
 * opens it once after the staging database is set, then removes SETUP_TOKEN from Preview.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const refusal = stagingSeedRefusal(process.env, token);
  if (refusal) {
    console.warn("[seed-staging] refused", JSON.stringify({ reason: refusal }));
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const counts = await seedStaging();
    return NextResponse.json({ ok: true, ...counts });
  } catch (e) {
    // The seed's own guards (a real workspace here, a production database) stop it with a reason that stays in the log.
    console.error("[seed-staging] refused by the seed", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "refused" }, { status: 409 });
  }
}
