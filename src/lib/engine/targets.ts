/** Monthly targets versus actuals, with pace so a client knows if they're ahead or behind mid-month. */

export const TARGET_METRICS = [
  { key: "dmsStarted", label: "DMs started", money: false },
  { key: "conversations", label: "Conversations", money: false },
  { key: "callsBooked", label: "Calls booked", money: false },
  { key: "callsHeld", label: "Calls held", money: false },
  { key: "posts", label: "Posts", money: false },
  { key: "newLeads", label: "New leads", money: false },
  { key: "offersMade", label: "Offers made", money: false },
  { key: "cashCollected", label: "Cash collected", money: true },
  { key: "webinarRegs", label: "Webinar registrations", money: false },
  { key: "webinarShows", label: "Webinar show-ups", money: false },
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number]["key"];

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthProgress(rows: Record<string, number>[], targets: Record<string, number>, month: string, today: string) {
  const dim = daysInMonth(month);
  const dayOfMonth = today.startsWith(month) ? Number(today.slice(8, 10)) : today > month ? dim : 0;
  const elapsed = Math.max(0, Math.min(1, dayOfMonth / dim));
  return TARGET_METRICS.map((m) => {
    const actual = rows.reduce((a, r) => a + Number(r[m.key] ?? 0), 0);
    const target = targets[m.key] ?? 0;
    const pct = target ? Math.min(999, Math.round((actual / target) * 100)) : 0;
    const expected = target * elapsed;
    const pace: "ahead" | "on" | "behind" | "none" = !target ? "none" : actual >= expected * 1.05 ? "ahead" : actual >= expected * 0.85 ? "on" : "behind";
    return { key: m.key, label: m.label, money: m.money, actual, target, pct, pace, expected: Math.round(expected) };
  });
}
