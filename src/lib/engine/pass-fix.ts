/**
 * Fix my pass (H-1699, plan H-1701 approved in H-1702): rewrite the name stamped on an existing pass from HelixOS's own data.
 * The pure parts: which fields a fix writes, what the outcome is called, and how a placeholder is spotted. Nothing here calls
 * anything. Points is never written (it moves by add or deduct only); MEMBER_ID never changes; Tier, Level and the offer are
 * the sync's. Email is left alone: HelixOS doesn't keep what it sent, so it can't tell a change.
 */
import { passNames } from "@/lib/engine/eo-pass";
import { isPlaceholderName } from "@/lib/engine/eloyalty";

export type FixField = { field: "First_Name" | "Last_Name"; value: string };

/**
 * The fields a fix writes, in order. First_Name always (the member's first name, never a prompt). Last_Name is written too, as
 * the member's last name or blank: on an existing pass the prompt is already stamped, so a blank write is what clears it.
 * A name that is itself prompt text writes blank in its place.
 */
export function fixFields(fullName: string): FixField[] {
  // Prompt text inside the name itself ("Maya Enter Your Last Name Here") is cut off before the split.
  const cut = fullName.replace(/\s*\b(enter\s+your|your\s+(first|last)\s+name|(first|last)\s+name\s+here)\b.*$/i, "");
  const { firstName, lastName } = passNames(cut);
  const clean = (v: string) => (v && !isPlaceholderName(v) ? v : "");
  return [
    { field: "First_Name", value: clean(firstName) },
    { field: "Last_Name", value: clean(lastName) },
  ];
}

/**
 * Clients' name fixes are shut (H-1802, approved in H-1807): Danno's own test showed a name rewrite can take the pass out of
 * Wallet. Fix this pass, the "Names update in place" tick and the fix on a name change stay closed in code, whatever is stored,
 * until a safe path is proven and this is opened in its own reviewed change.
 */
export const CLIENT_NAME_FIX_OPEN = false;

export type FixOutcome = "updated" | "busy" | "nopass" | "notready" | "proving" | "locked" | `failed-${number}`;

/** The outcome of the writes, from their statuses: every write 2xx is updated; any 429 is busy; else the first failure. */
export function fixOutcome(statuses: number[]): FixOutcome {
  if (statuses.length && statuses.every((s) => s >= 200 && s < 300)) return "updated";
  if (statuses.includes(429)) return "busy";
  const bad = statuses.find((s) => s < 200 || s >= 300) ?? 0;
  return `failed-${Math.max(0, Math.round(bad))}`;
}

/** The words on Coach for an outcome in the address (?passFix=…), or null for anything unknown. No provider name. */
export function fixWords(code: string | undefined): { good: boolean; text: string } | null {
  if (!code) return null;
  if (code === "updated") return { good: true, text: "Name sent. Your phone may take the pass out of Wallet; if it does, add it again from Rewards and the new copy carries the fixed name." };
  if (code === "locked") return { good: false, text: "Fixing a client's pass is shut for now: a fix can take the pass out of their Wallet." };
  if (code === "busy") return { good: false, text: "The pass service is busy (429). Nothing was changed; try again in a minute." };
  if (code === "nopass") return { good: false, text: "There's no pass to fix yet: it's made on Rewards with Get my pass." };
  if (code === "notready") return { good: false, text: "The program needs its key, template and a passed check first." };
  if (code === "proving") return { good: false, text: "Fix your own pass first and tick Names update in place once it shows on your phone." };
  const m = /^failed-(\d{1,3})$/.exec(code);
  if (!m) return null;
  const status = Number(m[1]);
  if (status === 0 || status >= 500) return { good: false, text: `The pass service didn't answer (${status || "no answer"}). Try again in a minute.` };
  if (status === 400) return { good: false, text: "The pass service refused to rewrite the name (400): names can't be changed in place on this pass. A reissue is the way, as its own plan." };
  if (status === 401 || status === 403) return { good: false, text: `The pass service refused the key (${status}).` };
  if (status === 404) return { good: false, text: "The pass service doesn't know this pass (404). It may have been reinstalled." };
  return { good: false, text: `The pass service refused the change (${status}).` };
}

/** Whether a created pass's answer carries prompt text anywhere in it ("Enter Your Last Name Here", "first name here"). */
export function answerHasPlaceholder(json: unknown): boolean {
  const seen = (v: unknown): boolean => {
    if (typeof v === "string") return isPlaceholderName(v) || /enter your|first name here|last name here/i.test(v);
    if (Array.isArray(v)) return v.some(seen);
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).some(seen);
    return false;
  };
  return seen(json);
}
