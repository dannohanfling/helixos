/**
 * Revenue by pillar: which of the things the Academy teaches is actually making this client money.
 * Built from the evening close (revContent / revWebinar / revDm and the activity behind each). Pure.
 */

export type PillarKey = "content" | "webinar" | "dm";

export type PillarLog = {
  date: string;
  eveningDoneAt: string | null;
  revContent: number;
  revWebinar: number;
  revDm: number;
  posts: number;
  webinarRegs: number;
  webinarShows: number;
  dmsStarted: number;
  callsBooked: number;
};

export type PillarMonth = {
  month: string;
  closedDays: number;
  total: number;
  pillars: { key: PillarKey; label: string; icon: string; revenue: number; share: number; activity: { label: string; value: number }[] }[];
};

export const PILLARS: { key: PillarKey; label: string; icon: string; teaches: string }[] = [
  { key: "content", label: "Content and groups", icon: "✍️", teaches: "Posts and comment ladders in your groups and on your pages" },
  { key: "webinar", label: "Webinars", icon: "🎤", teaches: "Registrations, shows and the offer at the end" },
  { key: "dm", label: "Conversations", icon: "💬", teaches: "DMs that turn into booked calls" },
];

const sum = (rows: PillarLog[], k: keyof PillarLog) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

export function pillarMonth(month: string, logs: PillarLog[]): PillarMonth {
  const rows = logs.filter((l) => l.date.startsWith(month));
  const rev = { content: sum(rows, "revContent"), webinar: sum(rows, "revWebinar"), dm: sum(rows, "revDm") };
  const total = rev.content + rev.webinar + rev.dm;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    month,
    closedDays: rows.filter((r) => r.eveningDoneAt).length,
    total,
    pillars: [
      { key: "content", label: PILLARS[0].label, icon: PILLARS[0].icon, revenue: rev.content, share: share(rev.content), activity: [{ label: "posts", value: sum(rows, "posts") }] },
      { key: "webinar", label: PILLARS[1].label, icon: PILLARS[1].icon, revenue: rev.webinar, share: share(rev.webinar), activity: [{ label: "registrations", value: sum(rows, "webinarRegs") }, { label: "shows", value: sum(rows, "webinarShows") }] },
      { key: "dm", label: PILLARS[2].label, icon: PILLARS[2].icon, revenue: rev.dm, share: share(rev.dm), activity: [{ label: "DMs started", value: sum(rows, "dmsStarted") }, { label: "calls booked", value: sum(rows, "callsBooked") }] },
    ],
  };
}

/** The last `n` months ending at `month` (YYYY-MM), oldest first. */
export function lastMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export type PillarSummary = { months: PillarMonth[]; current: PillarMonth; withData: PillarMonth[]; leader: PillarMonth["pillars"][number] | null; honesty: string };

/**
 * The whole picture for the Numbers page. `honesty` is the sentence that stops a confident chart being drawn from three closed days.
 */
export function pillarSummary(logs: PillarLog[], month: string, months = 6): PillarSummary {
  const all = lastMonths(month, months).map((m) => pillarMonth(m, logs));
  const current = all[all.length - 1];
  const withData = all.filter((m) => m.closedDays > 0);
  const ranked = current.pillars.slice().sort((a, b) => b.revenue - a.revenue);
  const leader = current.total > 0 ? ranked[0] : null;
  let honesty: string;
  if (current.closedDays === 0) honesty = "No closed days yet this month. Close the day each evening and this fills in.";
  else if (current.closedDays < 5) honesty = `Only ${current.closedDays} closed ${current.closedDays === 1 ? "day" : "days"} this month, so this is a glimpse, not a pattern.`;
  else if (current.total === 0) honesty = `${current.closedDays} closed days and no revenue logged yet. When cash lands, log it against the pillar it came from.`;
  else honesty = `${current.closedDays} closed days this month.${withData.length > 1 ? "" : " One month of data: the trend appears once there are two."}`;
  return { months: all, current, withData, leader, honesty };
}
