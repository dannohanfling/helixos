/** First-run workspace creation, shared by /setup and scripts/bootstrap.ts. Never creates a second workspace with the same slug. */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { seedLibrary } from "@/db/seed";
import { inviteCode, newId } from "@/lib/ids";
import { hashPassword } from "@/lib/password";
import { todayInTz } from "@/lib/dates";

export const SETUP_RESULT_COOKIE = "helix_setup_result";

export type SetupInput = { name: string; slug?: string; timezone: string; coachEmail: string; coachName: string; password: string };
export type SetupResult = { workspaceId: string; coachId: string; slug: string; clientInviteCode: string; coachInviteCode: string; existingUser: boolean };

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace";
}

export async function anyWorkspaceExists(): Promise<boolean> {
  const rows = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
  return rows.length > 0;
}

export async function createWorkspace(input: SetupInput): Promise<{ ok: true; data: SetupResult } | { ok: false; error: string }> {
  const name = input.name.trim();
  const coachEmail = input.coachEmail.trim().toLowerCase();
  const coachName = input.coachName.trim();
  if (!name || !coachEmail || !coachName) return { ok: false, error: "Workspace name, coach name and coach email are required." };
  if (input.password.length < 8) return { ok: false, error: "Use a password of at least 8 characters." };
  const slug = input.slug?.trim() || slugify(name);
  const existing = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, slug) });
  if (existing) return { ok: false, error: `A workspace with slug "${slug}" already exists. Nothing changed.` };

  await seedLibrary();
  const existingUser = await db.query.users.findFirst({ where: eq(schema.users.email, coachEmail) });
  const workspaceId = newId();
  const clientInviteCode = inviteCode();
  const coachInviteCode = inviteCode();
  await db.insert(schema.workspaces).values({ id: workspaceId, name, slug, timezone: input.timezone, clientInviteCode, coachInviteCode });
  const coachId = existingUser?.id ?? newId();
  if (!existingUser) await db.insert(schema.users).values({ id: coachId, email: coachEmail, name: coachName, passwordHash: await hashPassword(input.password), avatarEmoji: "🔱" });
  await db.insert(schema.memberships).values({ id: newId(), workspaceId, userId: coachId, role: "coach", startedAt: todayInTz(input.timezone) });
  return { ok: true, data: { workspaceId, coachId, slug, clientInviteCode, coachInviteCode, existingUser: Boolean(existingUser) } };
}
