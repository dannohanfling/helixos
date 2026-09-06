/**
 * Secrets at rest. AES-256-GCM with a key derived from ENCRYPTION_KEY (or SESSION_SECRET when that's all that is set).
 * Values are stored as `enc:v1:<iv>.<tag>.<ciphertext>` (base64url). Anything without the prefix is returned as-is so older rows keep working.
 */
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const src = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!src || src.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY or SESSION_SECRET (32+ characters) is required to store integration secrets.");
    return createHash("sha256").update("dev-only-secret-change-me-please-32chars").digest();
  }
  return createHash("sha256").update(src).digest();
}

export function seal(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function open(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, ct] = value.slice(PREFIX.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Sealed under a different ENCRYPTION_KEY / SESSION_SECRET. Treat as missing so the user is asked to paste it again.
    return null;
  }
}

export function isSealed(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(PREFIX));
}

/** A URL-safe random secret for webhooks and invites. */
export function randomSecret(prefix = "hx_"): string {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

/** Constant-time string comparison that doesn't leak length through an early exit. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** One-way fingerprint for secrets that only ever need to be matched, never read back (inbound webhook secrets). */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verifies an Ed25519 signature over the raw request body, the way GoHighLevel signs marketplace webhooks (`x-ghl-signature`, base64).
 * The public key may be PEM, or the raw 32-byte key as base64 or hex, matching what the HighLevel developer portal shows.
 */
export function verifyEd25519(rawBody: Buffer | string, signatureB64: string, publicKey: string): boolean {
  try {
    const trimmed = publicKey.trim();
    let key;
    if (trimmed.includes("-----BEGIN")) key = createPublicKey({ key: trimmed, format: "pem" });
    else {
      const raw = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
      const der = raw.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, raw]) : raw;
      key = createPublicKey({ key: der, format: "der", type: "spki" });
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
    return verifySignature(null, body, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
