/**
 * No server secret reaches the browser. After a production build, this reads every file the client is served (.next/static)
 * and fails if it finds a secret's VALUE or a token-shaped string. It does not flag a bare environment-variable NAME: under
 * Next.js only NEXT_PUBLIC_* variables are inlined with their values, so a client reference to any other name resolves to
 * undefined and ships no value. (The @vercel/blob client SDK, for instance, ships the literal "BLOB_READ_WRITE_TOKEN" to read
 * it client-side; that read is undefined and no token travels.) The leak is a value in the browser, and that is what this
 * catches: the "secrets never reach the browser" box of the beta checklist, enforced in the gate rather than by hand.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

// Server-only variables whose VALUE must never appear in the client bundle (checked only when the value is set in this shell).
const SERVER_ENV = [
  "SESSION_SECRET", "DATABASE_AUTH_TOKEN", "ENCRYPTION_KEY", "CRON_SECRET", "SETUP_TOKEN",
  "GHL_WEBHOOK_PUBLIC_KEY", "SENDGRID_API_KEY", "AIRTABLE_API_KEY",
  "BLOB_READ_WRITE_TOKEN", "PROOF_BLOB_READ_WRITE_TOKEN", "OPENALEX_API_KEY",
];
// Secret value shapes that must never appear whatever variable they came from, whether or not it is set in this shell.
const VALUE_PATTERNS: RegExp[] = [/vercel_blob_rw_[A-Za-z0-9_]{6,}/, /sk-ant-[A-Za-z0-9-]{6,}/, /\bSG\.[A-Za-z0-9_.-]{16,}/];

const dir = path.join(process.cwd(), ".next/static");
if (!existsSync(dir)) {
  console.error("check-bundle-secrets: no .next/static; run a production build first (verify.sh --build)");
  process.exit(1);
}
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(js|css|json|map)$/.test(e.name)) files.push(full);
  }
};
walk(dir);

const setValues = SERVER_ENV.map((n) => ({ n, v: process.env[n] })).filter((x): x is { n: string; v: string } => Boolean(x.v) && x.v!.length >= 8);
const hits: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = path.relative(process.cwd(), f);
  for (const { n, v } of setValues) if (src.includes(v)) hits.push(`${rel} carries the VALUE of ${n}`);
  for (const re of VALUE_PATTERNS) {
    const m = src.match(re);
    if (m) hits.push(`${rel} matches a secret shape ${re} (${m[0].slice(0, 16)}…)`);
  }
}
if (hits.length) {
  console.error("check-bundle-secrets: a server secret is in the client bundle:\n" + [...new Set(hits)].join("\n"));
  process.exit(1);
}
console.log(`check-bundle-secrets: ${files.length} client files, no secret value or token-shaped string in any of them (set values checked: ${setValues.map((x) => x.n).join(", ") || "none in this shell"})`);
