"use server";

import { demoLoginEnabled } from "@/lib/demo";
import { allow, clientIp } from "@/lib/rate-limit";

import { and, eq, isNull, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearSession, readSession, writeSession, type SessionPayload } from "@/lib/session";
import { seedNewClient } from "@/lib/queries/onboarding";
import { markSignedIn } from "@/lib/email-gate";
import { hashSecret } from "@/lib/crypto";
import { choicesFor, logTeamEvent, type Choice } from "@/lib/team";
import { inviteState } from "@/lib/engine/team";

export type AuthState = { error?: string; email?: string } | undefined;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase(), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const ip = await clientIp();
  const [ipOk, emailOk] = await Promise.all([allow(`login:ip:${ip}`, 30, 15 * 60000), allow(`login:email:${parsed.data.email}`, 8, 15 * 60000)]);
  if (!ipOk || !emailOk) return { error: "Too many attempts. Wait 15 minutes and try again.", email: parsed.data.email };
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, parsed.data.email) });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "That email and password don't match.", email: parsed.data.email };
  // Every HelixOS this person may be in (Danno, 6 Oct): their own memberships, coach first, then the teams they are on. One
  // signs them straight in; more than one signs them into the first and asks which. Before, the first membership found, in
  // no order, removed or not.
  const choices = await choicesFor(user.id);
  if (!choices.length) {
    // Removed everywhere: a session to the removed place, so /removed can say so (as before, for a removed client).
    const removedOwn = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) });
    const removedTeam = removedOwn ? null : await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.teamUserId, user.id) });
    if (!removedOwn && !removedTeam) return { error: "You're not part of a workspace yet. Ask your coach for an invite link." };
    await markSignedIn(user.id);
    await writeSession(removedOwn ? { userId: user.id, workspaceId: removedOwn.workspaceId, role: removedOwn.role, sv: user.sessionVersion } : { userId: user.id, workspaceId: removedTeam!.workspaceId, role: "client", sv: user.sessionVersion, tm: removedTeam!.id });
    redirect("/removed");
  }
  await markSignedIn(user.id);
  await writeSession(sessionFor(user, choices[0]));
  await noteTeamSignIn(user.id, choices[0]);
  const next = String(formData.get("next") ?? "");
  const to = next.startsWith("/") && !next.startsWith("//") ? next : "/today";
  redirect(choices.length > 1 ? `/choose?next=${encodeURIComponent(to)}` : to);
}

/** The session for one of a person's HelixOS: their own membership, or a team they are on. */
function sessionFor(user: { id: string; sessionVersion: number }, c: Choice): SessionPayload {
  return c.kind === "team" ? { userId: user.id, workspaceId: c.workspaceId, role: "client", sv: user.sessionVersion, tm: c.key.slice(2) } : { userId: user.id, workspaceId: c.workspaceId, role: c.role, sv: user.sessionVersion };
}

/** A team member's sign-in, on the owner's team log. */
async function noteTeamSignIn(userId: string, c: Choice): Promise<void> {
  if (c.kind !== "team") return;
  const tm = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, c.key.slice(2)) });
  if (tm) await logTeamEvent({ workspaceId: tm.workspaceId, ownerMembershipId: tm.ownerMembershipId, userId: tm.userId, teamMemberId: tm.id, teamUserId: userId, kind: "sign_in", action: "Signed in" });
}

/**
 * Which HelixOS to be in (Danno, 6 Oct): from the picker after sign-in, or the sidebar's "Switch HelixOS". Only one of the
 * signed-in person's own, live choices; the session is rewritten whole, so nothing of the one they leave stays in it.
 */
export async function chooseMembershipAction(formData: FormData): Promise<void> {
  const session = await readSession();
  if (!session) redirect("/login");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user) redirect("/login");
  const key = String(formData.get("choice") ?? "");
  const c = (await choicesFor(user.id)).find((x) => x.key === key);
  if (!c) redirect("/choose");
  await markSignedIn(user.id);
  await writeSession(sessionFor(user, c));
  await noteTeamSignIn(user.id, c);
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/today");
}

const joinSchema = z.object({
  code: z.string().min(4, "Enter the invite code from your coach."),
  firstName: z.string().min(1, "Enter your first name.").max(40),
  lastName: z.string().min(1, "Enter your last name.").max(40),
  businessName: z.string().min(1, "Enter your business name.").max(120),
  email: z.string().email("Enter your email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  confirm: z.string(),
});

/** The browser's IANA zone from the join form, when it's one the runtime knows. */
function browserTimezone(tz: string): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export async function joinAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = joinSchema.safeParse({
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    businessName: String(formData.get("businessName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: formData.get("password"),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { code, firstName, lastName, businessName, email, password, confirm } = parsed.data;
  if (confirm !== password) return { error: "The two passwords don't match." };
  // One name, as every account before this one has it (rev 387): first and last are asked for apart and kept together.
  const name = `${firstName} ${lastName}`;
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
    user = { id: newId(), email, name, passwordHash: await hashPassword(password), avatarEmoji: "🧭", sessionVersion: 0, firstSignedInAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    await db.insert(schema.users).values(user);
  }
  const existing = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.workspaceId, workspace.id)),
  });
  if (!existing) {
    const membershipId = newId();
    await db.insert(schema.memberships).values({ id: membershipId, workspaceId: workspace.id, userId: user.id, role, businessName, timezone: browserTimezone(String(formData.get("timezone") ?? "")) });
    if (role === "client") await seedNewClient(workspace.id, user.id);
  }
  await markSignedIn(user.id);
  await writeSession({ userId: user.id, workspaceId: workspace.id, role: existing?.role ?? role, sv: user.sessionVersion });
  redirect("/today");
}

const joinTeamSchema = z.object({
  code: z.string().min(8, "This invite link isn't complete."),
  firstName: z.string().min(1, "Enter your first name.").max(40),
  lastName: z.string().min(1, "Enter your last name.").max(40),
  email: z.string().email("Enter your email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  confirm: z.string(),
});

const INVITE_GONE = "This invite link has expired or was already used. Ask for a new one.";

/**
 * Joining a member's team (Danno, 6 Oct) through a one-time link: the invitee makes their own login (or signs in to the account
 * that email already has) and lands in the owner's HelixOS as a team member. The link must be open (unused, not cancelled,
 * under a week old), the owner still a member, and a seat free. The invite is spent and the team row made together, so the
 * same link can't be used twice.
 */
export async function joinTeamAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = joinTeamSchema.safeParse({
    code: String(formData.get("code") ?? "").trim(),
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: formData.get("password"),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { code, firstName, lastName, email, password, confirm } = parsed.data;
  if (confirm !== password) return { error: "The two passwords don't match." };
  const ip = await clientIp();
  if (!(await allow(`join:ip:${ip}`, 20, 15 * 60000))) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const invite = await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.codeHash, hashSecret(code)) });
  if (!invite || inviteState(invite) !== "open") return { error: INVITE_GONE };
  const owner = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, invite.ownerMembershipId), eq(schema.memberships.workspaceId, invite.workspaceId)) });
  if (!owner || owner.removedAt) return { error: INVITE_GONE };
  const live = await db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.ownerMembershipId, owner.id), isNull(schema.teamMembers.removedAt)) });
  if (live.length >= owner.teamCap) return { error: "This team has no seat free right now. Ask the owner to make room, then try the link again." };

  let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (user) {
    if (!(await verifyPassword(password, user.passwordHash))) return { error: "An account with that email exists. Use its password to join." };
  } else {
    user = { id: newId(), email, name: `${firstName} ${lastName}`, passwordHash: await hashPassword(password), avatarEmoji: "🧭", sessionVersion: 0, firstSignedInAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    await db.insert(schema.users).values(user);
  }
  if (user.id === owner.userId) return { error: "That's the owner's own login. Sign in with it instead." };
  const already = live.find((t) => t.teamUserId === user!.id);
  const teamMemberId = already?.id ?? newId();
  await db.transaction(async (tx) => {
    // Spend the invite first, and only if it is still open: two joins racing on one link leave one of them with nothing.
    const spent = await tx.update(schema.teamInvites).set({ usedAt: new Date().toISOString(), usedByUserId: user!.id }).where(and(eq(schema.teamInvites.id, invite.id), isNull(schema.teamInvites.usedAt), isNull(schema.teamInvites.revokedAt)));
    if ((spent.rowsAffected ?? 0) !== 1) throw new Error("invite gone");
    if (!already) await tx.insert(schema.teamMembers).values({ id: teamMemberId, workspaceId: owner.workspaceId, ownerMembershipId: owner.id, userId: owner.userId, teamUserId: user!.id, addedBy: invite.createdBy });
  }).catch(() => redirect("/join/team/gone"));
  await logTeamEvent({ workspaceId: owner.workspaceId, ownerMembershipId: owner.id, userId: owner.userId, teamMemberId, teamUserId: user.id, kind: "joined", action: already ? "Joined again" : "Joined the team" });
  await markSignedIn(user.id);
  await writeSession({ userId: user.id, workspaceId: owner.workspaceId, role: "client", sv: user.sessionVersion, tm: teamMemberId });
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
  // The demo account's own live membership (never a removed one, never a team): the walks sign in here.
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), isNull(schema.memberships.removedAt)) });
  if (!membership) redirect("/login?error=demo");
  await markSignedIn(user.id);
  await writeSession({ userId: user.id, workspaceId: membership.workspaceId, role: membership.role, sv: user.sessionVersion });
  redirect("/today");
}
