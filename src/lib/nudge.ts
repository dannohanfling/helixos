import { daysBetween, todayInTz } from "@/lib/dates";

/** Same window as nudgeMemberAction: a nudge in the last 20 hours counts as today, whatever the clock says in UTC. */
export function daysSinceNudge(lastNudgedAt: string | null, now: Date, tz: string, today: string): number | null {
  if (!lastNudgedAt) return null;
  if (now.getTime() - new Date(lastNudgedAt).getTime() < 20 * 3600_000) return 0;
  return Math.max(1, daysBetween(todayInTz(tz, new Date(lastNudgedAt)), today));
}
