/**
 * Where to go after signing in (rev 843): only one of HelixOS's own pages. A path that starts with one slash, with no second
 * slash or backslash after it (browsers read "/\host" as "//host"), and no control characters. Anything else is Today.
 */
export function safeNext(raw: string | null | undefined, fallback = "/today"): string {
  const next = String(raw ?? "");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  // Sign-in pages never send you back to a sign-in page.
  if (/^\/(login|api\/session)(\/|\?|$)/.test(next)) return fallback;
  return next;
}

/** Wrong passwords before sign-in pauses for an email, and for one network; the window both count in. */
export const LOGIN_LIMITS = { perEmail: 8, perIp: 60, windowMs: 15 * 60_000 } as const;

/** What a paused sign-in says (rev 843): how long, that even the right password waits, and the way out. */
export function pausedLine(retryInMs: number): string {
  const mins = Math.max(1, Math.ceil(retryInMs / 60_000));
  return `Sign-in for this email is paused for ${mins} more minute${mins === 1 ? "" : "s"} after too many wrong passwords. Even the right password waits until then. If your browser filled in an old saved password, type yours in yourself, or use "Forgot your password?" below.`;
}
