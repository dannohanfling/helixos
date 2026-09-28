/**
 * The green confirmation after a save (handoff rev 157): the button's own working label turned into what happened ("Saving…"
 * becomes "Saved ✓", "Sending…" becomes "Sent ✓"). Buttons that take the member somewhere else (log out, sign in, open,
 * search) confirm nothing: the new page is the answer. Pure, so the list is tested.
 */
const PAST: Record<string, string> = {
  saving: "Saved",
  checking: "Checked",
  sending: "Sent",
  adding: "Added",
  drafting: "Drafted",
  removing: "Removed",
  starting: "Started",
  rotating: "Rotated",
  moving: "Moved",
  accepting: "Accepted",
  undoing: "Undone",
  restoring: "Restored",
  posting: "Posted",
  nudging: "Nudged",
  importing: "Imported",
  generating: "Generated",
  creating: "Created",
  building: "Built",
  awarding: "Awarded",
  approving: "Approved",
  writing: "Written",
  verifying: "Verified",
  scoring: "Scored",
  scheduling: "Scheduled",
  resuming: "Resumed",
  resetting: "Reset",
  repairing: "Repaired",
  regenerating: "Regenerated",
  recording: "Recorded",
  locking: "Locked",
  marking: "Marked",
  updating: "Updated",
  deleting: "Deleted",
  uploading: "Uploaded",
  connecting: "Connected",
  pushing: "Pushed",
  claiming: "Claimed",
  inviting: "Invited",
};
const NAVIGATES = new Set(["logging", "signing", "opening", "searching", "reading", "running", "joining", "loading"]);

/** "Saving…" → "Saved ✓", "Locking in…" → "Locked in ✓", "Sending to your bot…" → "Sent ✓"; null for a button that navigates. */
export function doneLabel(pendingText: string | undefined): string | null {
  const text = (pendingText ?? "Saving…").trim();
  const [first, ...rest] = text.replace(/…|\.\.\.$/, "").split(/\s+/);
  const verb = (first ?? "").toLowerCase();
  if (NAVIGATES.has(verb)) return null;
  const past = PAST[verb];
  if (!past) return "Done ✓";
  // A particle that belongs to the verb ("Locking in…") stays; an object ("Sending to your bot…") is dropped.
  return rest[0] === "in" && rest.length === 1 ? `${past} in ✓` : `${past} ✓`;
}

/** An answer that is an error: the page's address names one (?error=, ?weekError=, …). No green on a failure. */
export const isErrorAnswer = (search: string): boolean => /(^|[?&])[a-zA-Z]*[eE]rror=/.test(search);
