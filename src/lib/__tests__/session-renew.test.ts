import { describe, expect, it } from "vitest";
import { RENEW_AFTER_SECONDS, renewedSessionToken, signSession, verifySessionToken } from "@/lib/session";

/** Signed in stays signed in while in use (Speed 2): a token is renewed once a day, with the same payload, and never otherwise. */
describe("renewedSessionToken", () => {
  const payload = { userId: "u1", workspaceId: "w1", role: "client" as const, sv: 3, tm: "t1" };
  const now = () => Math.floor(Date.now() / 1000);

  it("is null while the token is under a day old", async () => {
    const token = await signSession(payload);
    expect(await renewedSessionToken(token, now() + 60)).toBeNull();
    expect(await renewedSessionToken(token, now() + RENEW_AFTER_SECONDS - 60)).toBeNull();
  });

  it("gives a fresh token with the same payload once a day has passed", async () => {
    const token = await signSession(payload);
    const fresh = await renewedSessionToken(token, now() + RENEW_AFTER_SECONDS + 60);
    expect(fresh).toBeTruthy();
    expect(await verifySessionToken(fresh!)).toEqual(await verifySessionToken(token));
  });

  it("never renews a token that doesn't verify", async () => {
    const token = await signSession(payload);
    const forged = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await renewedSessionToken(forged, now() + 2 * RENEW_AFTER_SECONDS)).toBeNull();
    expect(await renewedSessionToken("not-a-token", now() + 2 * RENEW_AFTER_SECONDS)).toBeNull();
  });
});
