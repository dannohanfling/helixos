/**
 * "Switch to client" (rev 216), the plain parts: how a server action's name reads in the client's "Changes by your coach"
 * log, and how a refusal rides back to the page. Pure, for the tests.
 */
const PAST: Record<string, string> = {
  create: "Created", update: "Updated", save: "Saved", delete: "Deleted", add: "Added", remove: "Removed", set: "Set", toggle: "Changed",
  accept: "Accepted", generate: "Generated", mark: "Marked", move: "Moved", record: "Recorded", draft: "Drafted", link: "Linked",
  confirm: "Confirmed", duplicate: "Duplicated", touch: "Opened", reschedule: "Rescheduled", archive: "Archived", log: "Logged",
  submit: "Submitted", polish: "Polished", regenerate: "Regenerated", clear: "Cleared", approve: "Approved", unapprove: "Unapproved",
  hide: "Hid", restore: "Restored", use: "Used", share: "Shared", snooze: "Snoozed", build: "Built", propose: "Proposed",
  search: "Searched", import: "Imported", complete: "Completed", uncomplete: "Reopened", check: "Checked", review: "Reviewed",
};

/** "updateOfferAction" → "Updated offer"; "saveBotLinesAction" → "Saved bot lines". Unknown or missing: "Made a change". */
export function actionWords(name: string | null | undefined): string {
  const base = (name ?? "").replace(/Action$/, "");
  const words = base.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return "Made a change";
  const [verb, ...rest] = words;
  const done = PAST[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1);
  return [done, ...rest].join(" ");
}

/** The page a refused write goes back to, with the reason as ?switchError= (any earlier one replaced). */
export function withSwitchError(path: string, reason: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.delete("switchError");
  u.searchParams.set("switchError", reason);
  return `${u.pathname}${u.search}${u.hash}`;
}
