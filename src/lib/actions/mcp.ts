"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { safeEqual, signValue } from "@/lib/crypto";
import { backToApp, isScope, parseScopes, redirectMatches, type Scope } from "@/lib/engine/mcp";
import { clientById, consentSignature, issueCode, revokeApp } from "@/lib/mcp/oauth";

const OWN = "Connected apps are {first}'s own: they can't be connected or cut from their HelixOS.";

/** The way back to the app after consent: a page of ours that sends the browser on, since a form's own redirect is bound by the CSP. */
const returnVia = (to: string) => `/oauth/authorize/return?to=${encodeURIComponent(to)}&sig=${encodeURIComponent(signValue(to))}`;

async function checked(formData: FormData, userId: string) {
  const fields = { clientId: str(formData, "client_id"), redirectUri: str(formData, "redirect_uri"), state: str(formData, "state"), codeChallenge: str(formData, "code_challenge"), resource: str(formData, "resource"), scope: str(formData, "scope"), userId };
  if (!safeEqual(consentSignature(fields), str(formData, "sig"))) return null;
  const client = await clientById(fields.clientId);
  if (!client || !redirectMatches(client.redirectUris, fields.redirectUri)) return null;
  return fields;
}

/** Approve: the ticked scopes (a subset of what was asked, Body only when the member has Body) become a ten-minute code. */
export async function approveConnectionAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const f = await checked(formData, v.user.id);
  if (!f) redirect("/connect?error=stale");
  if (v.role === "client" && !v.workspace.connectedAppsOpen) redirect("/connect?error=closed");
  const asked = parseScopes(f!.scope).scopes;
  const ticked = formData.getAll("scopes").map(String).filter(isScope);
  const scopes: Scope[] = asked.filter((s) => ticked.includes(s) && (s !== "body" || v.membership.bodyEnabled));
  if (!scopes.length) redirect(returnVia(backToApp(f!.redirectUri, { error: "access_denied", error_description: "no scope was allowed", state: f!.state })));
  const code = await issueCode({ v, clientId: f!.clientId, redirectUri: f!.redirectUri, codeChallenge: f!.codeChallenge, resource: f!.resource || null, scopes });
  redirect(returnVia(backToApp(f!.redirectUri, { code, state: f!.state })));
}

export async function denyConnectionAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const f = await checked(formData, v.user.id);
  if (!f) redirect("/connect?error=stale");
  redirect(returnVia(backToApp(f!.redirectUri, { error: "access_denied", error_description: "the member declined", state: f!.state })));
}

/** Disconnect, from Settings: the grant and its tokens end at once. */
export async function disconnectAppAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(formData, "id");
  const app = await db.query.connectedApps.findFirst({ where: and(eq(schema.connectedApps.id, id), eq(schema.connectedApps.workspaceId, workspaceId), eq(schema.connectedApps.userId, userId), isNull(schema.connectedApps.revokedAt)) });
  if (app) await revokeApp(app.id);
  redirect("/settings?apps=disconnected#connected-apps");
}

/** The coach's workspace switch (rev 247, B5): whether clients may connect apps at all. Off cuts their existing connections too. */
export async function setConnectedAppsOpenAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const on = str(formData, "connectedAppsOpen") === "on";
  await db.update(schema.workspaces).set({ connectedAppsOpen: on }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
  redirect(`/settings?apps=${on ? "open" : "closed"}#connected-apps`);
}
