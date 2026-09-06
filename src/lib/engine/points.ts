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

/** Points for the numbers logged in an evening close. */
export function closeActivityPoints(log: {
  dmsStarted: number;
  conversations: number;
  callsBooked: number;
  callsHeld: number;
  posts: number;
}): { total: number; lines: { label: string; points: number }[] } {
  const lines = [
    { label: "DMs started", points: log.dmsStarted * POINTS.dmStarted },
    { label: "Conversations", points: log.conversations * POINTS.reply },
    { label: "Calls booked", points: log.callsBooked * POINTS.callBooked },
    { label: "Calls held", points: log.callsHeld * POINTS.callHeld },
    { label: "Posts", points: log.posts * POINTS.contentPosted },
  ].filter((l) => l.points > 0);
  return { total: lines.reduce((s, l) => s + l.points, 0), lines };
}
