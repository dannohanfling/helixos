"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { AirtableError, airtableProblem, readSource, type BaseAccess } from "@/lib/airtable";
import { buildPlan, planSummary, type ImportPlan, type PlanLine } from "@/lib/engine/airtable-import";
import { ESSENCE_CAP } from "@/lib/engine/essence";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { applyImport, existingRefs, mergedEssence } from "@/lib/queries/import";
import { allow } from "@/lib/rate-limit";
import { todayInTz } from "@/lib/dates";

/** What the page shows after a dry run. No token is ever in here: the form keeps them in its own inputs until Approve. */
export type ImportPreview = {
  key: string;
  who: string;
  summary: { area: string; create: number; update: number }[];
  lines: PlanLine[];
  unfilled: string[];
  missing: string[];
  notInPhase1: { table: string; rows: number }[];
  essenceChars: number;
  overCap: boolean;
};
export type ImportState = { error?: string; changed?: boolean; preview?: ImportPreview } | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const newClient = z.object({ name: z.string().min(1, "Give the new client a name.").max(80), email: z.string().email("Give the new client's login email."), businessName: z.string().max(120) });

type Target = { kind: "existing"; membershipId: string; userId: string; who: string } | { kind: "new"; name: string; email: string; businessName: string; who: string };

/** The client the import writes to: one of the coach's, or a new one described on the form (created only on Approve). */
async function target(workspaceId: string, f: FormData): Promise<Target | { error: string }> {
  const pick = s(f, "client");
  if (pick === "new") {
    const p = newClient.safeParse({ name: s(f, "newName"), email: s(f, "newEmail").toLowerCase(), businessName: s(f, "newBusiness") });
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the new client's details." };
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, p.data.email) });
    if (user) {
      const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.workspaceId, workspaceId)) });
      if (m) return { error: "That email already has an account here. Pick them from the list instead." };
      return { error: "That email already has a HelixOS account elsewhere. Use a different email for this workspace." };
    }
    return { kind: "new", ...p.data, who: `${p.data.name} (new)` };
  }
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, pick), eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  if (!m) return { error: "Pick one of your clients, or create a new one." };
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  return { kind: "existing", membershipId: m.id, userId: m.userId, who: u?.name ?? "Client" };
}

function access(f: FormData): { source: BaseAccess; fallback: BaseAccess | null } {
  const fb = { baseId: s(f, "fallbackBase"), token: s(f, "fallbackToken") };
  return { source: { baseId: s(f, "sourceBase"), token: s(f, "sourceToken") }, fallback: fb.baseId || fb.token ? fb : null };
}

/** Read the bases and build the plan against what the client already holds. The tokens live only inside this call. */
async function prepare(workspaceId: string, coachId: string, f: FormData): Promise<{ error: string } | { t: Target; plan: ImportPlan; preview: ImportPreview }> {
  if (!(await allow(`import:${coachId}`, 30, 15 * 60000))) return { error: "That's a lot of runs in a row. Wait 15 minutes and try again." };
  const t = await target(workspaceId, f);
  if ("error" in t) return t;
  const since = s(f, "since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return { error: "The cut-off date is a date, like 2026-06-10, or empty." };
  let read: Awaited<ReturnType<typeof readSource>>;
  try {
    const a = access(f);
    read = await readSource(a.source, a.fallback);
  } catch (e) {
    if (e instanceof AirtableError) return { error: airtableProblem(e) };
    console.error("[import] read failed", JSON.stringify({ kind: e instanceof Error ? e.name : typeof e }));
    return { error: "Couldn't read the base. Nothing was imported; try again in a minute." };
  }
  if (!read.source.v2.offersos && !read.source.v2.vision) return { error: "Source base: this doesn't look like a HelixOS-template base (no Vision or OffersOS table). Check the base id." };
  const existing = t.kind === "existing" ? await existingRefs(workspaceId, t.userId) : new Set<string>();
  const plan = buildPlan(read.source, { createdSince: since || null }, existing);
  const { chars } = await mergedEssence(plan, workspaceId, t.kind === "existing" ? t.userId : "");
  const key = createHash("sha256")
    .update(JSON.stringify([t.kind === "existing" ? t.membershipId : t.email, plan]))
    .digest("hex")
    .slice(0, 32);
  return {
    t,
    plan,
    preview: { key, who: t.who, summary: planSummary(plan), lines: plan.lines, unfilled: plan.unfilled, missing: read.missing, notInPhase1: plan.notInPhase1, essenceChars: chars, overCap: chars > ESSENCE_CAP },
  };
}

type Coach = Awaited<ReturnType<typeof requireCoach>>;

/** Dry run: read, map, show. Nothing is written. */
async function dryRun(coach: Coach, f: FormData): Promise<ImportState> {
  const r = await prepare(coach.workspace.id, coach.user.id, f);
  if ("error" in r) return { error: r.error };
  return { preview: r.preview };
}

/**
 * Approve: read again, rebuild, and write only if the plan is the one the coach saw. A new client is created here, with a random
 * password nobody knows and no email sent; the coach sends a reset link from the client's page when it's time.
 */
async function approve(coach: Coach, f: FormData): Promise<ImportState> {
  const r = await prepare(coach.workspace.id, coach.user.id, f);
  if ("error" in r) return { error: r.error };
  if (r.preview.key !== s(f, "key")) return { changed: true, preview: r.preview };
  if (r.preview.overCap) return { preview: r.preview };
  let membershipId: string;
  let userId: string;
  if (r.t.kind === "new") {
    userId = newId();
    membershipId = newId();
    await db.insert(schema.users).values({ id: userId, email: r.t.email, name: r.t.name, passwordHash: await hashPassword(randomBytes(32).toString("base64url")), avatarEmoji: "🧭" });
    await db.insert(schema.memberships).values({ id: membershipId, workspaceId: coach.workspace.id, userId, role: "client", businessName: r.t.businessName || null, startedAt: todayInTz(coach.workspace.timezone) });
  } else {
    userId = r.t.userId;
    membershipId = r.t.membershipId;
  }
  const { written } = await applyImport(r.plan, coach.workspace.id, userId);
  redirect(`/coach/import?done=${written}&to=${membershipId}&at=${Date.now()}`);
}

/** The page's one form: the pressed button says which. */
export async function importAction(_prev: ImportState, f: FormData): Promise<ImportState> {
  const coach = await requireCoach();
  return s(f, "intent") === "approve" ? approve(coach, f) : dryRun(coach, f);
}
