import { connect } from "node:http2";
import { SignJWT, importPKCS8 } from "jose";

/** The app's bundle id, as in mobile/capacitor.config.ts: Apple routes a push by it. */
const APP_ID = "com.evolveomega.helixos";

/**
 * Apple's push service (H-881: iPhone pushes go straight to Apple). Signed with Danno's Apple push key, read from Vercel:
 * APNS_KEY_P8 (the whole .p8 file), APNS_KEY_ID and HELIXOS_APPLE_TEAM_ID. TestFlight and App Store builds both use Apple's
 * production service; APNS_SANDBOX=1 is only for a build run straight from Xcode.
 */
export type ApnsResult = { ok: true } | { ok: false; gone: boolean; reason: string };

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.HELIXOS_APPLE_TEAM_ID);
}

let cached: { jwt: string; at: number } | null = null;

/** Apple wants a fresh token at most once every 20 minutes and refuses one older than an hour: kept for 40 minutes. */
async function providerToken(): Promise<string> {
  if (cached && Date.now() - cached.at < 40 * 60 * 1000) return cached.jwt;
  const key = await importPKCS8((process.env.APNS_KEY_P8 ?? "").replace(/\\n/g, "\n"), "ES256");
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: process.env.APNS_KEY_ID }).setIssuer(process.env.HELIXOS_APPLE_TEAM_ID ?? "").setIssuedAt().sign(key);
  cached = { jwt, at: Date.now() };
  return jwt;
}

export async function sendApns(token: string, msg: { title: string; body: string; path: string; badge?: number }): Promise<ApnsResult> {
  const host = process.env.APNS_SANDBOX === "1" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const jwt = await providerToken();
  const payload = JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default", ...(msg.badge !== undefined ? { badge: msg.badge } : {}) }, path: msg.path });
  return new Promise<ApnsResult>((resolve) => {
    const client = connect(host);
    const done = (r: ApnsResult) => {
      client.close();
      resolve(r);
    };
    client.on("error", () => done({ ok: false, gone: false, reason: "connection failed" }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": APP_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    req.setTimeout(10_000, () => {
      req.close();
      done({ ok: false, gone: false, reason: "timeout" });
    });
    let status = 0;
    let body = "";
    req.on("response", (h) => (status = Number(h[":status"] ?? 0)));
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      if (status === 200) return done({ ok: true });
      let reason = `status ${status}`;
      try {
        reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
      } catch {
        // Apple's body is JSON; anything else keeps the status.
      }
      // 410 Unregistered or 400 BadDeviceToken: the app was removed or the token is no longer valid.
      done({ ok: false, gone: status === 410 || reason === "BadDeviceToken" || reason === "Unregistered", reason });
    });
    req.end(payload);
  });
}
