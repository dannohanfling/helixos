"use server";

import { demoLoginEnabled } from "@/lib/demo";
import { allow, clientIp } from "@/lib/rate-limit";

import { and, eq, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearSession, writeSession } from "@/lib/session";
import { seedNewClient } from "@/lib/queries/onboarding";

export type AuthState = { error?: string } | undefined;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase(), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([allow(`login:ip:${ip}`, 30, 15 * 60000), allow(`login:email:${parsed.data.email}`, 8, 15 * 60000)]);
  if (!ipOk || !emailOk) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, parsed.data.email) });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "That email and password don't match." };
  const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) });
  if (!membership) return { error: "You're not part of a workspace yet. Ask your coach for an invite link." };
  await writeSession({ userId: user.id, workspaceId: membership.workspaceId, role: membership.role });
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/today");
}

const joinSchema = z.object({
  code: z.string().min(4),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8, "Use at least 8 characters."),
  businessName: z.string().max(120).optional(),
});

export async function joinAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = joinSchema.safeParse({
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: formData.get("password"),
    businessName: String(formData.get("businessName") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { code, name, email, password, businessName } = parsed.data;
  const ip = await clientIp();
  if (!(await allow(`join:ip:${ip}`, 20, 15 * 60000))) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const workspace = await db.query.workspaces.findFirst({
    where: or(eq(schema.workspaces.clientInviteCode, code), eq(schema.workspaces.coachInviteCode, code)),
  });
  if (!workspace) return { error: "That invite code isn't valid. Double-check it with your coach." };
  const role: "coach" | "client" = workspace.coachInviteCode === code ? "coach" : "client";

  let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (user) {
    if (!(await verifyPassword(password, user.passwordHash))) return { error: "An account with that email exists. Use its password to join." };
  } else {
    user = { id: newId(), email, name, passwordHash: await hashPassword(password), avatarEmoji: "🧭", createdAt: new Date().toISOString() };
    await db.insert(schema.users).values(user);
  }
  const existing = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.workspaceId, workspace.id)),
  });
  if (!existing) {
    const membershipId = newId();
    await db.insert(schema.memberships).values({ id: membershipId, workspaceId: workspace.id, userId: user.id, role, businessName });
    if (role === "client") await seedNewClient(workspace.id, user.id);
  }
  await writeSession({ userId: user.id, workspaceId: workspace.id, role: existing?.role ?? role });
  redirect("/today");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}

/** Signs in as one of the demo accounts created by `npm run db:seed`. */
export async function demoLoginAction(formData: FormData): Promise<void> {
  if (!demoLoginEnabled()) redirect("/login");
  const who = String(formData.get("who") ?? "client");
  const email = who === "coach" ? "coach@demo.helixos.app" : "client@demo.helixos.app";
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) redirect("/login?error=demo");
  const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) });
  if (!membership) redirect("/login?error=demo");
  await writeSession({ userId: user.id, workspaceId: membership.workspaceId, role: membership.role });
  redirect("/today");
}
