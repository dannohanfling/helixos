/**
 * Step D of the pass plan (H-734, approved in H-748): one Latest Message on the coach's own pass, sent only when the coach
 * presses Send. The message goes into the pass's Push_Notification field; the template's changeMessage "%@" turns it into
 * the lock-screen notice. The pure rules: what a message may be, and the words for each outcome.
 */

export const PASS_MESSAGE_DEFAULT = "Welcome to Evolve Omega";
export const PASS_MESSAGE_MAX = 120;

/** A typed message: one line, 1 to 120 characters after trimming. Anything else is refused. */
export function readPassMessage(input: string): { ok: true; value: string } | { ok: false } {
  const v = input.trim();
  if (!v || v.length > PASS_MESSAGE_MAX || /[\r\n]/.test(v)) return { ok: false };
  return { ok: true, value: v };
}

export type PassMessageOutcome = "sent" | "busy" | "nopass" | "notready" | "bad" | `failed-${number}`;

/** The outcome as a status code: 2xx is sent, 429 is busy, anything else (0 for no answer) is a failure with its status. */
export function passMessageOutcome(status: number): PassMessageOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 429) return "busy";
  return `failed-${Math.max(0, Math.round(status))}`;
}

/** The words on Coach for an outcome in the address (?passMessage=…), or null for anything unknown. */
export function passMessageWords(code: string | undefined): { good: boolean; text: string } | null {
  if (!code) return null;
  if (code === "sent") return { good: true, text: "Sent. Your phone should show it on the lock screen within a minute." };
  if (code === "busy") return { good: false, text: "eLoyalty is busy (429). Nothing was changed; try again in a minute." };
  if (code === "nopass") return { good: false, text: "Your pass isn't made yet. Make it on Rewards with Get my pass first." };
  if (code === "notready") return { good: false, text: "The program needs its key, template and a passed check first." };
  if (code === "bad") return { good: false, text: `The message must be one line of 1 to ${PASS_MESSAGE_MAX} characters.` };
  const m = /^failed-(\d{1,3})$/.exec(code);
  if (!m) return null;
  const status = Number(m[1]);
  if (status === 0 || status >= 500) return { good: false, text: `eLoyalty didn't answer (${status || "no answer"}). Nothing is known to be sent; try again in a minute.` };
  if (status === 401 || status === 403) return { good: false, text: `eLoyalty refused the key (${status}). Check the key on this card.` };
  if (status === 404) return { good: false, text: "eLoyalty doesn't know this pass (404). Make the pass again on Rewards." };
  return { good: false, text: `eLoyalty refused the message (${status}).` };
}
