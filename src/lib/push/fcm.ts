import { getVercelOidcToken } from "@vercel/oidc";

/**
 * Firebase Cloud Messaging for the Android app (H-881), with no key file (H-1580, plan H-1584).
 *
 * Google's org policy refuses service-account keys, so the site proves who it is instead:
 *  1. Vercel gives every Production function a short-lived OIDC token (OIDC Federation on in the Vercel project).
 *  2. Google's token service swaps it for a federated token, through the Workload Identity pool and provider that
 *     trust only this project's Production (the provider's attribute condition).
 *  3. That token asks IAM Credentials for a one-hour token of the Firebase Admin service account, scope
 *     firebase.messaging, which sends through the FCM HTTP v1 API.
 *
 * Five plain Vercel settings, none of them secret: GCP_PROJECT_ID, GCP_PROJECT_NUMBER, GCP_WIF_POOL_ID,
 * GCP_WIF_PROVIDER_ID and GCP_SERVICE_ACCOUNT_EMAIL. Missing any of them, Android push reads "not configured".
 * Errors carry a step and a status code only, never a token.
 */
export type FcmResult = { ok: true } | { ok: false; gone: boolean; reason: string };
export type FcmConfig = { projectId: string; projectNumber: string; poolId: string; providerId: string; serviceAccount: string };

export function fcmConfig(env: Record<string, string | undefined> = process.env): FcmConfig | null {
  const c = {
    projectId: env.GCP_PROJECT_ID?.trim() ?? "",
    projectNumber: env.GCP_PROJECT_NUMBER?.trim() ?? "",
    poolId: env.GCP_WIF_POOL_ID?.trim() ?? "",
    providerId: env.GCP_WIF_PROVIDER_ID?.trim() ?? "",
    serviceAccount: env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() ?? "",
  };
  if (!c.projectId || !/^\d+$/.test(c.projectNumber) || !c.poolId || !c.providerId || !c.serviceAccount.includes("@")) return null;
  return c;
}

export function fcmConfigured(): boolean {
  return fcmConfig() !== null;
}

/** The pool provider's full name, which Google's token service takes as the audience. */
export function providerAudience(c: FcmConfig): string {
  return `//iam.googleapis.com/projects/${c.projectNumber}/locations/global/workloadIdentityPools/${c.poolId}/providers/${c.providerId}`;
}

let cached: { token: string; until: number } | null = null;

/** For tests: forget the cached Google token. */
export function resetFcmToken(): void {
  cached = null;
}

async function accessToken(c: FcmConfig, oidc: () => Promise<string>): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;

  const subjectToken = await oidc();
  const sts = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: providerAudience(c),
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!sts.ok) throw new Error(`Google token exchange: status ${sts.status}`);
  const federated = ((await sts.json()) as { access_token: string }).access_token;

  const iam = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(c.serviceAccount)}:generateAccessToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${federated}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/firebase.messaging"], lifetime: "3600s" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!iam.ok) throw new Error(`Google service account token: status ${iam.status}`);
  const j = (await iam.json()) as { accessToken: string; expireTime: string };
  const expires = Date.parse(j.expireTime);
  // Keep it until five minutes before Google's expiry (about 55 minutes).
  cached = { token: j.accessToken, until: (Number.isFinite(expires) ? expires : Date.now() + 3600_000) - 300_000 };
  return j.accessToken;
}

export async function sendFcm(
  token: string,
  msg: { title: string; body: string; path: string },
  oidc: () => Promise<string> = () => getVercelOidcToken(),
): Promise<FcmResult> {
  const c = fcmConfig();
  if (!c) return { ok: false, gone: false, reason: "not configured" };
  let bearer: string;
  try {
    bearer = await accessToken(c, oidc);
  } catch (e) {
    // A refused exchange is a setup problem (Vercel OIDC off, the pool's condition, the role), not a bad phone token.
    return { ok: false, gone: false, reason: e instanceof Error && e.message.startsWith("Google") ? e.message : "Google auth: no Vercel token" };
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { path: msg.path }, android: { priority: "high" } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  // UNREGISTERED (404) or an invalid token: the app was removed, or the token was replaced.
  const gone = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(text);
  // A 401 means our Google token went stale early: forget it so the next send exchanges afresh.
  if (res.status === 401) cached = null;
  return { ok: false, gone, reason: `status ${res.status}` };
}
