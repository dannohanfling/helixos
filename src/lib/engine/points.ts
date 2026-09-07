export const POINTS = {
  checkin: 10,
  close: 20,
  task: 5,
  top3Task: 15,
  contentPosted: 15,
  contentWithCta: 25,
  dmStarted: 5,
  reply: 2,
  callBooked: 25,
  callHeld: 10,
  newClient: 100,
} as const;

export function taskPoints(urgency: string, basePoints?: number | null): number {
  if (basePoints && basePoints > 0 && basePoints !== 5) return basePoints;
  return urgency === "top3" ? POINTS.top3Task : POINTS.task;
}

export function contentPoints(hasCta: boolean): number {
  return hasCta ? POINTS.contentWithCta : POINTS.contentPosted;
}

export type CloseNumbers = { dmsStarted: number; conversations: number; callsBooked: number; callsHeld: number; posts: number };

/**
 * Points for the numbers logged in an evening close. `alreadyCounted` is what the app scored during the day as it happened
 * (a post marked posted, a conversation logged), so typing the same number at the close never scores it twice.
 */
export function closeActivityPoints(log: CloseNumbers, alreadyCounted: Partial<CloseNumbers> = {}): { total: number; lines: { label: string; points: number }[] } {
  const net = (k: keyof CloseNumbers) => Math.max(0, log[k] - (alreadyCounted[k] ?? 0));
  const lines = [
    { label: "DMs started", points: net("dmsStarted") * POINTS.dmStarted },
    { label: "Conversations", points: net("conversations") * POINTS.reply },
    { label: "Calls booked", points: net("callsBooked") * POINTS.callBooked },
    { label: "Calls held", points: net("callsHeld") * POINTS.callHeld },
    { label: "Posts", points: net("posts") * POINTS.contentPosted },
  ].filter((l) => l.points > 0);
  return { total: lines.reduce((s, l) => s + l.points, 0), lines };
}
