"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { emailConfigured, sendEmail } from "@/lib/email";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { hashPassword, verifyPassword } from "@/lib/password";
import { allow, clientIp } from "@/lib/rate-limit";
import { writeSession } from "@/lib/session";
import { cookies } from "next/headers";
import { SETUP_RESULT_COOKIE, anyWorkspaceExists, createWorkspace } from "@/lib/setup";
import { ctx } from "@/lib/action-helpers";

export type SetupState = { error?: string } | undefined;
export type ForgotState = { error?: string; message?: string; devLink?: string } | undefined;
export type ResetState = { error?: string } | undefined;
export type PasswordState = { error?: string; ok?: true } | undefined;

const RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** First-run setup. Fails closed without SETUP_TOKEN, refuses once any workspace exists, and never reveals which of those it was. */
export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const expected = process.env.SETUP_TOKEN ?? "";
  const given = String(formData.get("token") ?? "");
  if (!expected || !safeEqual(given, expected)) return { error: "Setup isn't available." };
  const ip = await clientIp();
  if (!(await allow(`setup:ip:${ip}`, 5, 15 * 60000))) return { error: "Too many attempts. Wait 15 minutes and try again." };
  if (await anyWorkspaceExists()) return { error: "Setup isn't available." };
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const r = await createWorkspace({
    name: String(formData.get("name") ?? ""),
    timezone: String(formData.get("timezone") ?? "America/Los_Angeles"),
    coachEmail: String(formData.get("coachEmail") ?? ""),
    coachName: String(formData.get("coachName") ?? ""),
    password,
  });
  if (!r.ok) return { error: r.error };
  const coach = await db.query.users.findFirst({ where: eq(schema.users.id, r.data.coachId) });
  await writeSession({ userId: r.data.coachId, workspaceId: r.data.workspaceId, role: "coach", sv: coach?.sessionVersion ?? 0 });
  // The invite links are shown once on /setup/done, carried in a short-lived cookie rather than the URL. /setup itself is a 404 from now on.
  const jar = await cookies();
  jar.set(SETUP_RESULT_COOKIE, JSON.stringify({ clientLink: `${appUrl()}/join/${r.data.clientInviteCode}`, coachLink: `${appUrl()}/join/${r.data.coachInviteCode}`, existingUser: r.data.existingUser }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/setup", maxAge: 600 });
  redirect("/setup/done");
}


/** Sends a reset link. The reply is identical whether or not the email belongs to an account. */
export async function forgotAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter the email you log in with." };
  if (!emailConfigured() && process.env.NODE_ENV === "production") return { error: "Password reset email isn't set up on this server yet (SENDGRID_API_KEY). Ask your coach to reset your password for you." };
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([allow(`forgot:ip:${ip}`, 10, 15 * 60000), allow(`forgot:email:${email}`, 3, 15 * 60000)]);
  const message = "If that email has an account, a reset link is on its way. It works for 60 minutes.";
  if (!ipOk || !emailOk) return { message };
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) return { message };
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.passwordResets).values({ id: newId(), userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString() });
  const link = `${appUrl()}/reset/${token}`;
  const delivery = await sendEmail(user.email, "Reset your HelixOS password", `Hi ${user.name.split(" ")[0]},\n\nSomeone asked to reset the password for this email. If it was you, open this link within 60 minutes:\n\n${link}\n\nIf it wasn't you, ignore this and nothing changes.`);
  return { message, ...(delivery === "logged" && process.env.NODE_ENV !== "production" ? { devLink: link } : {}) };
}

/** Sets a new password from a reset link: single use, 60 minutes, and it signs every other session out. */
export async function resetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const ip = await clientIp();
  if (!(await allow(`reset:ip:${ip}`, 10, 15 * 60000))) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const row = await db.query.passwordResets.findFirst({ where: and(eq(schema.passwordResets.tokenHash, hashToken(token)), isNull(schema.passwordResets.usedAt), gt(schema.passwordResets.expiresAt, nowIso())) });
  if (!row) return { error: "This reset link has expired or was already used. Request a new one." };
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  if (!user) return { error: "This reset link has expired or was already used. Request a new one." };
  const sessionVersion = user.sessionVersion + 1;
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), sessionVersion }).where(eq(schema.users.id, user.id));
  await db.update(schema.passwordResets).set({ usedAt: nowIso() }).where(and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt)));
  const membership = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) });
  if (!membership) return { error: "Password updated, but this account isn't in a workspace yet. Ask your coach for an invite link." };
  await writeSession({ userId: user.id, workspaceId: membership.workspaceId, role: membership.role, sv: sessionVersion });
  redirect("/today");
}

/** Signed-in password change. Needs the current password; signs every other session out and keeps this one. */
export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const { v } = await ctx();
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!(await verifyPassword(current, v.user.passwordHash))) return { error: "That isn't your current password." };
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  if (password === current) return { error: "Pick a password you haven't used here." };
  const sessionVersion = v.user.sessionVersion + 1;
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), sessionVersion }).where(eq(schema.users.id, v.user.id));
  await writeSession({ userId: v.user.id, workspaceId: v.workspace.id, role: v.role, sv: sessionVersion });
  return { ok: true };
}
