import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashSecret, verifyEd25519 } from "../crypto";
import { toCsv } from "../export";

describe("inbound webhook authentication", () => {
  it("hashes secrets deterministically and never reversibly", () => {
    const h = hashSecret("hx_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashSecret("hx_abc"));
    expect(h).not.toBe(hashSecret("hx_abd"));
    expect(h).not.toContain("hx_abc");
  });

  it("verifies GoHighLevel's Ed25519 signature over the raw body, in every key encoding the developer portal shows", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({ type: "ContactCreate", locationId: "loc_1", email: "a@b.c" });
    const sig = sign(null, Buffer.from(body), privateKey).toString("base64");
    const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
    const raw = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(12);
    expect(verifyEd25519(body, sig, pem)).toBe(true);
    expect(verifyEd25519(body, sig, raw.toString("base64"))).toBe(true);
    expect(verifyEd25519(body, sig, raw.toString("hex"))).toBe(true);
    expect(verifyEd25519(body + " ", sig, pem)).toBe(false);
    expect(verifyEd25519(body, sig.slice(0, -4) + "AAAA", pem)).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(verifyEd25519(body, sig, other)).toBe(false);
    expect(verifyEd25519(body, sig, "not a key")).toBe(false);
  });
});

describe("data export CSV", () => {
  it("quotes, escapes, unions columns and neutralises formulas", () => {
    const csv = toCsv([
      { id: 1, name: 'Ann "The Closer" Lee', note: "line1\nline2", tags: ["a", "b"] },
      { id: 2, name: "=SUM(A1)", extra: null },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,name,note,tags,extra");
    expect(lines[1]).toBe('1,"Ann ""The Closer"" Lee","line1\nline2","[""a"",""b""]",');
    expect(lines[2]).toBe("2,'=SUM(A1),,,");
    expect(toCsv([])).toBe("");
  });
});
