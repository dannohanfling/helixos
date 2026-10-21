import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fcmConfig, providerAudience, resetFcmToken, sendFcm } from "@/lib/push/fcm";

const ENV = {
  GCP_PROJECT_ID: "helixos-test",
  GCP_PROJECT_NUMBER: "123456789012",
  GCP_WIF_POOL_ID: "vercel",
  GCP_WIF_PROVIDER_ID: "helixos",
  GCP_SERVICE_ACCOUNT_EMAIL: "sender@helixos-test.iam.gserviceaccount.com",
};
const MSG = { title: "Live now", body: "Your call is live.", path: "/calls" };
const oidc = () => Promise.resolve("vercel-oidc-test");

type Call = { url: string; init: RequestInit };
function fakeGoogle(fcmStatus = 200, fcmBody = "{}") {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://sts.googleapis.com")) return new Response(JSON.stringify({ access_token: "federated-test" }), { status: 200 });
    if (url.startsWith("https://iamcredentials.googleapis.com"))
      return new Response(JSON.stringify({ accessToken: "sa-test", expireTime: new Date(Date.now() + 3600_000).toISOString() }), { status: 200 });
    return new Response(fcmBody, { status: fcmStatus });
  });
  vi.stubGlobal("fetch", f);
  return calls;
}

describe("Android push with no key file (H-1580, plan H-1584)", () => {
  beforeEach(() => {
    resetFcmToken();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is not configured until all five settings are there, and a project number must be digits", () => {
    expect(fcmConfig(ENV)).not.toBeNull();
    for (const k of Object.keys(ENV)) expect(fcmConfig({ ...ENV, [k]: "" })).toBeNull();
    expect(fcmConfig({ ...ENV, GCP_PROJECT_NUMBER: "helixos-test" })).toBeNull();
    expect(fcmConfig({ ...ENV, GCP_SERVICE_ACCOUNT_EMAIL: "no-at-sign" })).toBeNull();
  });

  it("says not configured without calling Google", async () => {
    vi.stubEnv("GCP_WIF_POOL_ID", "");
    const calls = fakeGoogle();
    expect(await sendFcm("phone", MSG, oidc)).toEqual({ ok: false, gone: false, reason: "not configured" });
    expect(calls).toHaveLength(0);
  });

  it("swaps the Vercel token through the pool, then acts as the Firebase sender, then sends", async () => {
    const calls = fakeGoogle();
    expect(await sendFcm("phone", MSG, oidc)).toEqual({ ok: true });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["sts.googleapis.com", "iamcredentials.googleapis.com", "fcm.googleapis.com"]);

    const sts = JSON.parse(String(calls[0].init.body));
    expect(sts.audience).toBe(providerAudience(fcmConfig(ENV)!));
    expect(sts.audience).toBe("//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/helixos");
    expect(sts.subjectToken).toBe("vercel-oidc-test");
    expect(sts.subjectTokenType).toBe("urn:ietf:params:oauth:token-type:jwt");

    expect(calls[1].url).toContain(encodeURIComponent(ENV.GCP_SERVICE_ACCOUNT_EMAIL));
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer federated-test");
    expect(JSON.parse(String(calls[1].init.body)).scope).toEqual(["https://www.googleapis.com/auth/firebase.messaging"]);

    expect(calls[2].url).toBe("https://fcm.googleapis.com/v1/projects/helixos-test/messages:send");
    expect((calls[2].init.headers as Record<string, string>).authorization).toBe("Bearer sa-test");
    expect(JSON.parse(String(calls[2].init.body)).message).toMatchObject({ token: "phone", data: { path: "/calls" } });
  });

  it("reuses the Google token for later sends", async () => {
    const calls = fakeGoogle();
    await sendFcm("a", MSG, oidc);
    await sendFcm("b", MSG, oidc);
    expect(calls.filter((c) => c.url.includes("fcm.googleapis.com"))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes("sts.googleapis.com"))).toHaveLength(1);
  });

  it("reports a refused exchange by step and status only, and keeps the phone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    const r = await sendFcm("phone", MSG, oidc);
    expect(r).toEqual({ ok: false, gone: false, reason: "Google token exchange: status 400" });
  });

  it("says so when Vercel gives no token (OIDC off, or running outside Vercel)", async () => {
    const calls = fakeGoogle();
    const r = await sendFcm("phone", MSG, () => Promise.reject(new Error("The 'x-vercel-oidc-token' header is missing")));
    expect(r).toEqual({ ok: false, gone: false, reason: "Google auth: no Vercel token" });
    expect(calls).toHaveLength(0);
  });

  it("marks a phone gone when FCM says UNREGISTERED", async () => {
    fakeGoogle(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
    expect(await sendFcm("old-phone", MSG, oidc)).toEqual({ ok: false, gone: true, reason: "status 404" });
  });

  it("drops the Google token after a 401 so the next send exchanges afresh", async () => {
    const calls = fakeGoogle(401);
    await sendFcm("a", MSG, oidc);
    await sendFcm("b", MSG, oidc);
    expect(calls.filter((c) => c.url.includes("sts.googleapis.com"))).toHaveLength(2);
  });
});
