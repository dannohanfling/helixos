import { describe, expect, it } from "vitest";
import { describeSendGridError, parseFrom } from "../email";

describe("SendGrid adapter", () => {
  it("parses EMAIL_FROM as name + address or a bare address, and refuses to guess", () => {
    expect(parseFrom("HelixOS <helixos@evolveomega.com>")).toEqual({ email: "helixos@evolveomega.com", name: "HelixOS" });
    expect(parseFrom('"Evolve Omega" <hello@evolveomega.com>')).toEqual({ email: "hello@evolveomega.com", name: "Evolve Omega" });
    expect(parseFrom("helixos@evolveomega.com")).toEqual({ email: "helixos@evolveomega.com" });
    expect(() => parseFrom(undefined)).toThrow(/EMAIL_FROM is not set/);
    expect(() => parseFrom("")).toThrow(/EMAIL_FROM is not set/);
    expect(() => parseFrom("HelixOS <not an address>")).toThrow(/not a valid sender/);
    expect(() => parseFrom("onboarding@resend")).toThrow(/not a valid sender/);
  });

  it("surfaces SendGrid's errors array with message and field, and falls back to the raw body", () => {
    expect(describeSendGridError(403, JSON.stringify({ errors: [{ message: "The from address does not match a verified Sender Identity.", field: "from", help: "http://sendgrid.com/docs/sender-identity" }] }))).toBe(
      "SendGrid failed: 403 The from address does not match a verified Sender Identity. (field: from) help: http://sendgrid.com/docs/sender-identity",
    );
    expect(describeSendGridError(401, JSON.stringify({ errors: [{ message: "The provided authorization grant is invalid, expired, or revoked", field: null, help: null }] }))).toBe("SendGrid failed: 401 The provided authorization grant is invalid, expired, or revoked");
    expect(describeSendGridError(502, "<html>bad gateway</html>")).toBe("SendGrid failed: 502 <html>bad gateway</html>");
  });
});
