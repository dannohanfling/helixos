/**
 * Anything token-shaped is taken out of text on its way to a log or a note: a Private Integration token, a bearer value,
 * a JWT, a long base64 run. A credential in a log line is a credential in a log line whoever put it there.
 */
const PATTERNS: [RegExp, string][] = [
  [/\bpit-[A-Za-z0-9_-]{6,}/g, "pit-[redacted]"],
  [/\/api\/iwh\/[A-Za-z0-9]{8,}/g, "/api/iwh/[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g, "[jwt redacted]"],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, "[redacted]"],
];
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out;
}
