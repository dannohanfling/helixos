/**
 * Drafts that follow a member to another device (rev 444, part two). Pure: what a draft's name may be, how large it may grow,
 * how long it is kept, and which of two copies (this browser's, the server's) is the one to put back.
 */
export const DRAFT_KEY = /^[a-z][a-z0-9_-]*(\.[A-Za-z0-9_-]{1,80}){1,4}$/;
export const DRAFT_MAX_BYTES = 64_000;
export const DRAFT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type DraftCopy = { at: number; sent: boolean };

/** A name this app gives a draft ("month.<who>.<month>", "webinar.<who>.<id>.run"), never anything else. */
export const validDraftKey = (key: string): boolean => key.length <= 160 && DRAFT_KEY.test(key);

/** The copy to put back: the newer of the two, so a draft typed on the phone wins over an older one left on the laptop. */
export function newerDraft<T extends DraftCopy>(local: T | null, server: T | null): T | null {
  if (!local) return server;
  if (!server) return local;
  return server.at > local.at ? server : local;
}

/** Old enough to let go: a draft untouched for 30 days. */
export const draftExpired = (at: number, now: number): boolean => now - at > DRAFT_KEEP_MS;
