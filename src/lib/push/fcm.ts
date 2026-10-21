import { SignJWT, importPKCS8 } from "jose";

/**
 * Firebase Cloud Messaging for the Android app (H-881). FIREBASE_SERVICE_ACCOUNT in Vercel holds the whole service-account
 * JSON Danno downloads from Firebase; it signs a short-lived Google token that sends through the HTTP v1 API.
 */
export type FcmResult = { ok: true } | { ok: false; gone: boolean; reason: string };
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function account(): ServiceAccount | null {
  try {
    const a = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? "") as Partial<ServiceAccount>;
    return a.project_id && a.client_email && a.private_key ? (a as ServiceAccount) : null;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return account() !== null;
}

let cached: { token: string; until: number } | null = null;

async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const key = await importPKCS8(a.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(a.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token: status ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 120) * 1000 };
  return j.access_token;
}

export async function sendFcm(token: string, msg: { title: string; body: string; path: string }): Promise<FcmResult> {
  const a = account();
  if (!a) return { ok: false, gone: false, reason: "not configured" };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken(a)}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { path: msg.path }, android: { priority: "high" } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  // UNREGISTERED (404) or an invalid token: the app was removed, or the token was replaced.
  const gone = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(text);
  return { ok: false, gone, reason: `status ${res.status}` };
}
