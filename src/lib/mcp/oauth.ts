/**
 * HelixOS as an OAuth 2.1 authorization server for its own MCP server (rev 224, approved rev 247). Clients register
 * themselves (public, no secret); a member approves scopes on the consent screen; a code becomes an access token (one hour)
 * and a refresh token (thirty days, rotated on use, the whole grant revoked on reuse). Codes and tokens are random 256-bit
 * strings stored as sha256 only. Disconnect, the revoke endpoint, a removed membership and a closed workspace switch all end
 * access on the next call, because every call reads the grant.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { viewerFor, type Viewer } from "@/lib/auth";
import { appUrl } from "@/lib/branded-email";
import { hashSecret, signValue } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { ACCESS_TTL_MS, CODE_TTL_MS, MCP_PATH, REFRESH_TTL_MS, isScope, pkceOk, type Scope } from "@/lib/engine/mcp";

/** The server's own address: the deployed URL in production, the request's origin otherwise (the walks run on localhost). */
export function issuer(request: Request): string {
  return issuerFor(new URL(request.url).origin);
}
export function issuerFor(origin: string): string {
  return process.env.NODE_ENV === "production" ? appUrl() : origin;
}
export const resourceFor = (iss: string): string => `${iss}${MCP_PATH}`;

const random = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

export async function registerClient(name: string, redirectUris: string[]): Promise<schema.OauthClient> {
  const row = { id: `mcpc_${randomBytes(12).toString("base64url")}`, name, redirectUris };
  await db.insert(schema.oauthClients).values(row);
  return (await db.query.oauthClients.findFirst({ where: eq(schema.oauthClients.id, row.id) }))!;
}

export const clientById = async (id: string) => (await db.query.oauthClients.findFirst({ where: eq(schema.oauthClients.id, id) })) ?? null;

export async function issueCode(input: { v: Viewer; clientId: string; redirectUri: string; codeChallenge: string; resource: string | null; scopes: Scope[] }): Promise<string> {
  const code = random("mcpx_");
  await db.insert(schema.oauthCodes).values({ id: newId(), workspaceId: input.v.workspace.id, userId: input.v.user.id, membershipId: input.v.membership.id, clientId: input.clientId, codeHash: hashSecret(code), codeChallenge: input.codeChallenge, redirectUri: input.redirectUri, resource: input.resource, scopes: input.scopes, expiresAt: at(CODE_TTL_MS) });
  return code;
}

export type TokenPair = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };
type Fail = { error: "invalid_grant" | "invalid_request" | "invalid_client"; error_description: string };

async function mintPair(app: schema.ConnectedApp): Promise<TokenPair> {
  const access = random("mcpa_");
  const refresh = random("mcpr_");
  await db.insert(schema.oauthTokens).values([
    { id: newId(), appId: app.id, kind: "access", tokenHash: hashSecret(access), expiresAt: at(ACCESS_TTL_MS) },
    { id: newId(), appId: app.id, kind: "refresh", tokenHash: hashSecret(refresh), expiresAt: at(REFRESH_TTL_MS) },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: app.scopes.join(" ") };
}

/** The code, once, with the verifier that matches its challenge, from the client and URI it was issued to. */
export async function exchangeCode(input: { code: string; verifier: string; clientId: string; redirectUri: string; resource: string | null; expectedResource: string }): Promise<TokenPair | Fail> {
  const row = await db.query.oauthCodes.findFirst({ where: eq(schema.oauthCodes.codeHash, hashSecret(input.code)) });
  if (!row) return { error: "invalid_grant", error_description: "unknown code" };
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) return { error: "invalid_grant", error_description: "the code was issued to another client or redirect URI" };
  if (input.resource && input.resource !== input.expectedResource) return { error: "invalid_grant", error_description: "the code is for another resource" };
  if (!pkceOk(input.verifier, row.codeChallenge)) return { error: "invalid_grant", error_description: "the code verifier does not match" };
  if (Date.parse(row.expiresAt) <= Date.now()) return { error: "invalid_grant", error_description: "the code has expired" };
  // Single use, atomically: a second exchange of the same code finds usedAt set and revokes what the first one issued.
  const claimed = await db.update(schema.oauthCodes).set({ usedAt: nowIso() }).where(and(eq(schema.oauthCodes.id, row.id), isNull(schema.oauthCodes.usedAt))).returning({ id: schema.oauthCodes.id });
  if (!claimed.length) {
    const apps = await db.query.connectedApps.findMany({ where: and(eq(schema.connectedApps.userId, row.userId), eq(schema.connectedApps.clientId, row.clientId), isNull(schema.connectedApps.revokedAt)) });
    for (const a of apps) if (a.createdAt >= row.createdAt) await revokeApp(a.id);
    return { error: "invalid_grant", error_description: "the code was already used" };
  }
  const client = await clientById(row.clientId);
  const app = { id: newId(), workspaceId: row.workspaceId, userId: row.userId, membershipId: row.membershipId, clientId: row.clientId, name: client?.name ?? "An app", scopes: row.scopes };
  await db.insert(schema.connectedApps).values(app);
  return mintPair((await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, app.id) }))!);
}

/** A refresh token rotates: the old pair dies, a new one is issued. A refresh token seen twice means it leaked: the grant is revoked. */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<TokenPair | Fail> {
  const row = await db.query.oauthTokens.findFirst({ where: and(eq(schema.oauthTokens.tokenHash, hashSecret(refreshToken)), eq(schema.oauthTokens.kind, "refresh")) });
  if (!row) return { error: "invalid_grant", error_description: "unknown refresh token" };
  const app = await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, row.appId) });
  if (!app || app.revokedAt || app.clientId !== clientId) return { error: "invalid_grant", error_description: "the connection was disconnected" };
  if (row.usedAt || row.revokedAt) {
    await revokeApp(app.id);
    return { error: "invalid_grant", error_description: "the refresh token was already used; the connection has been disconnected for safety" };
  }
  if (Date.parse(row.expiresAt) <= Date.now()) return { error: "invalid_grant", error_description: "the refresh token has expired" };
  const claimed = await db.update(schema.oauthTokens).set({ usedAt: nowIso() }).where(and(eq(schema.oauthTokens.id, row.id), isNull(schema.oauthTokens.usedAt))).returning({ id: schema.oauthTokens.id });
  if (!claimed.length) {
    await revokeApp(app.id);
    return { error: "invalid_grant", error_description: "the refresh token was already used; the connection has been disconnected for safety" };
  }
  // The old access token goes with the old refresh token.
  await db.update(schema.oauthTokens).set({ revokedAt: nowIso() }).where(and(eq(schema.oauthTokens.appId, app.id), eq(schema.oauthTokens.kind, "access"), isNull(schema.oauthTokens.revokedAt)));
  return mintPair(app);
}

/** Disconnect: the grant and every token of it, at once. */
export async function revokeApp(appId: string): Promise<void> {
  const now = nowIso();
  await db.update(schema.connectedApps).set({ revokedAt: now }).where(and(eq(schema.connectedApps.id, appId), isNull(schema.connectedApps.revokedAt)));
  await db.update(schema.oauthTokens).set({ revokedAt: now }).where(and(eq(schema.oauthTokens.appId, appId), isNull(schema.oauthTokens.revokedAt)));
}

/** The revocation endpoint: either token of a grant ends the grant. Unknown tokens are fine (RFC 7009 says 200 either way). */
export async function revokeByToken(token: string): Promise<void> {
  const row = await db.query.oauthTokens.findFirst({ where: eq(schema.oauthTokens.tokenHash, hashSecret(token)) });
  if (row) await revokeApp(row.appId);
}

export type Grant = { app: schema.ConnectedApp; scopes: Scope[]; viewer: Viewer };

/**
 * A bearer token to the member it acts as: the token unexpired and unrevoked, the grant live, the member still in the
 * workspace, and, for a client, the coach's "Connected apps open to clients" still on.
 */
export async function authenticateBearer(token: string): Promise<Grant | null> {
  if (!/^mcpa_[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const row = await db.query.oauthTokens.findFirst({ where: and(eq(schema.oauthTokens.tokenHash, hashSecret(token)), eq(schema.oauthTokens.kind, "access")) });
  if (!row || row.revokedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
  const app = await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, row.appId) });
  if (!app || app.revokedAt) return null;
  const viewer = await viewerFor(app.userId, app.workspaceId);
  if (!viewer || viewer.membership.id !== app.membershipId) return null;
  if (viewer.role === "client" && !viewer.workspace.connectedAppsOpen) return null;
  return { app, scopes: app.scopes.filter(isScope), viewer };
}

/** What the consent form signs, so a POST can only approve the request the page rendered for this member. */
export function consentSignature(fields: { clientId: string; redirectUri: string; state: string; codeChallenge: string; resource: string; scope: string; userId: string }): string {
  return signValue([fields.clientId, fields.redirectUri, fields.state, fields.codeChallenge, fields.resource, fields.scope, fields.userId].join("\n"));
}
