/**
 * WHOOP's developer platform (B6, rev 237 phase 11): OAuth per member, the v2 API, and the webhook check. The client id and
 * secret are WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET on the server; WHOOP_AUTH_URL and WHOOP_API_URL point the walk at
 * scripts/mock-whoop.ts. Nothing here logs a token or a secret, and no error carries one. The endpoints are from memory of the
 * docs (blocked from the build container) and are checked on the first real connect.
 */
import { verifyWebhook } from "@/lib/engine/body-whoop";

const AUTH = () => process.env.WHOOP_AUTH_URL || "https://api.prod.whoop.com/oauth/oauth2";
const API = () => process.env.WHOOP_API_URL || "https://api.prod.whoop.com";
export const WHOOP_SCOPES = "offline read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout";

export const whoopConfigured = (): boolean => !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET);

export type WhoopProblem = "not_configured" | "unreachable" | "denied" | "expired" | "busy" | "other";
export const isWhoopProblem = (s: string): s is WhoopProblem => ["not_configured", "unreachable", "denied", "expired", "busy", "other"].includes(s);
export class WhoopError extends Error {
  constructor(readonly problem: WhoopProblem) {
    super(`whoop ${problem}`);
  }
}
const SAYS: Record<WhoopProblem, string> = {
  not_configured: "WHOOP isn't set up on this server yet.",
  unreachable: "Couldn't reach WHOOP. Try again in a minute.",
  denied: "WHOOP refused the connection. Connect again from HumanOS settings.",
  expired: "WHOOP's access has expired. Connect again from HumanOS settings.",
  busy: "WHOOP asked us to slow down. Try again in a minute.",
  other: "WHOOP couldn't answer just now. Try again in a minute.",
};
export const whoopProblem = (e: WhoopError): string => SAYS[e.problem];

/** Where the member is sent to say yes. `state` is this session's nonce, checked on return. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: process.env.WHOOP_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code", scope: WHOOP_SCOPES, state });
  return `${AUTH()}/auth?${q.toString()}`;
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string | null };

async function tokenCall(form: Record<string, string>): Promise<Tokens> {
  if (!whoopConfigured()) throw new WhoopError("not_configured");
  let res: Response;
  try {
    res = await fetch(`${AUTH()}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ ...form, client_id: process.env.WHOOP_CLIENT_ID!, client_secret: process.env.WHOOP_CLIENT_SECRET! }).toString(), cache: "no-store" });
  } catch {
    throw new WhoopError("unreachable");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new WhoopError("denied");
  if (res.status === 429) throw new WhoopError("busy");
  if (!res.ok) throw new WhoopError("other");
  const data = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
  if (typeof data.access_token !== "string") throw new WhoopError("other");
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scopes: typeof data.scope === "string" ? data.scope : null };
}

export const exchangeCode = (code: string, redirectUri: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
export const refreshTokens = (refreshToken: string) => tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" });

/** One GET on the v2 API with the member's token. */
export async function apiGet<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${API()}/developer/v2${path}${q ? `?${q}` : ""}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new WhoopError("unreachable");
  }
  if (res.status === 401) throw new WhoopError("expired");
  if (res.status === 403) throw new WhoopError("denied");
  if (res.status === 429) throw new WhoopError("busy");
  if (res.status === 404) return null as T;
  if (!res.ok) throw new WhoopError("other");
  return (await res.json()) as T;
}

/** Every record of a collection since `start`, following next_token, capped so a runaway page list ends. */
export async function apiAll<T>(accessToken: string, path: string, start: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  for (let i = 0; i < 40; i++) {
    const page = await apiGet<{ records?: T[]; next_token?: string } | null>(accessToken, path, { start, limit: "25", ...(next ? { nextToken: next } : {}) });
    out.push(...(page?.records ?? []));
    next = page?.next_token || undefined;
    if (!next) break;
  }
  return out;
}

/** The webhook's proof, with this app's secret. */
export const webhookOk = (timestamp: string | null, signature: string | null, rawBody: string): boolean => verifyWebhook(process.env.WHOOP_CLIENT_SECRET ?? "", timestamp, signature, rawBody);
