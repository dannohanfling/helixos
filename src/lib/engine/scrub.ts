/**
 * What may leave the server in an error report (H-349 §2): causes, ids, counts and times. Never a member's name, email, phone,
 * HumanOS data, a key, a token or a request body. Pure, so the rule is tested without Sentry: beforeSend hands the event here.
 */
/** Key words that mean a value is someone's, or a credential: a key is dropped whole when any of its words is one of these. */
const SENSITIVE_WORDS = new Set(["name", "first", "last", "email", "mail", "phone", "mobile", "address", "dob", "birth", "body", "weight", "health", "token", "key", "secret", "password", "passphrase", "authorization", "cookie", "session", "bearer", "dsn", "signature"]);
const wordsOf = (k: string): string[] => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const isSensitiveKey = (k: string): boolean => wordsOf(k).some((w) => SENSITIVE_WORDS.has(w));
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Seven or more digits with separators: a phone number, a card, an id of someone's; a short count stays. */
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const BEARER = /\b(Bearer|Basic|token|key|secret)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{12,}/gi;

export const REDACTED = "[redacted]";

/** A string with anything that reads like an address, a number of someone's or a credential taken out. */
export function scrubText(s: string): string {
  return s.replace(BEARER, (m, word: string) => `${word} ${REDACTED}`).replace(EMAIL, REDACTED).replace(PHONE, REDACTED);
}

/** Deep: sensitive keys dropped whole, every string scrubbed, arrays kept, cycles cut. */
export function scrubValue<T>(v: T, depth = 0): T {
  if (depth > 12) return undefined as T;
  if (typeof v === "string") return scrubText(v) as T;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = scrubValue(x, depth + 1);
    }
    return out as T;
  }
  return v;
}

/** The shape of a Sentry event this touches; anything else passes through unread. */
export type ErrorEventLike = {
  message?: string;
  request?: { url?: string; method?: string; data?: unknown; headers?: unknown; cookies?: unknown; query_string?: unknown; env?: unknown } | undefined;
  user?: { id?: string | number; [k: string]: unknown } | undefined;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: { message?: string; data?: Record<string, unknown>; category?: string; [k: string]: unknown }[];
  exception?: { values?: { value?: string; [k: string]: unknown }[] };
  [k: string]: unknown;
};

/**
 * The event as it may be sent: no request body, headers, cookies or query string (the path and method stay); the user is
 * an id and nothing else; extra, contexts, tags and breadcrumbs scrubbed deep; messages scrubbed.
 */
export function scrubEvent<T extends ErrorEventLike>(event: T): T {
  const out: ErrorEventLike = { ...event };
  if (out.request) {
    const url = typeof out.request.url === "string" ? out.request.url.split("?")[0] : undefined;
    out.request = { ...(url ? { url } : {}), ...(out.request.method ? { method: out.request.method } : {}) };
  }
  if (out.user) out.user = out.user.id ? { id: String(out.user.id) } : undefined;
  if (out.extra) out.extra = scrubValue(out.extra);
  if (out.contexts) out.contexts = scrubValue(out.contexts);
  if (out.tags) out.tags = scrubValue(out.tags);
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => scrubValue(b));
  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (out.exception?.values) out.exception = { ...out.exception, values: out.exception.values.map((x) => (typeof x.value === "string" ? { ...x, value: scrubText(x.value) } : x)) };
  return out as T;
}
