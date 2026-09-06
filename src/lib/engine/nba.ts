/** Next Best Action: turns a snapshot of the client's day into one ranked list. */

export type Snapshot = {
  today: string;
  hour: number;
  morningDone: boolean;
  eveningDone: boolean;
  overdueTasks: number;
  focusTasksOpen: number;
  followUpsDue: number;
  unansweredInbound: number;
  contentDueToday: number;
  contentOverdue: number;
  nextPathwayTask: { key: string; name: string; points: number } | null;
  pendingRevision: number;
  curriculumDay: { day: number; title: string; points: number } | null;
  streakAlive: boolean;
  runningStreak: number;
};

export type Action = {
  key: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  tone: "primary" | "warning" | "neutral";
  points?: number;
};

export function nextBestActions(s: Snapshot): Action[] {
  const out: Action[] = [];
  if (!s.morningDone) {
    out.push({
      key: "checkin",
      title: "Lock in your day",
      why: "Pick your top 3 and set your energy. 60 seconds.",
      href: "#checkin",
      cta: "Start lock-in",
      tone: "primary",
      points: 10,
    });
  }
  if (s.unansweredInbound > 0) {
    out.push({
      key: "inbound",
      title: `${s.unansweredInbound} ${s.unansweredInbound === 1 ? "person" : "people"} waiting on your reply`,
      why: "Replies within a day book 3x more calls. They came to you.",
      href: "/conversations?filter=inbound",
      cta: "Reply now",
      tone: "warning",
    });
  }
  if (s.pendingRevision > 0) {
    out.push({
      key: "revision",
      title: `Coach asked for a tweak on ${s.pendingRevision} pathway ${s.pendingRevision === 1 ? "task" : "tasks"}`,
      why: "Points are one revision away.",
      href: "/pathway?filter=revision",
      cta: "See feedback",
      tone: "warning",
    });
  }
  if (s.overdueTasks > 0) {
    out.push({
      key: "overdue",
      title: `${s.overdueTasks} overdue ${s.overdueTasks === 1 ? "task" : "tasks"}`,
      why: "Clear them or reschedule them. Overdue lists kill momentum.",
      href: "/tasks?filter=overdue",
      cta: "Clear the list",
      tone: "warning",
    });
  }
  if (s.followUpsDue > 0) {
    out.push({
      key: "followups",
      title: `${s.followUpsDue} follow-${s.followUpsDue === 1 ? "up" : "ups"} due`,
      why: "Most deals close on the 3rd to 5th touch. Today is a touch.",
      href: "/conversations?filter=due",
      cta: "Open conversations",
      tone: "primary",
    });
  }
  if (s.contentOverdue > 0 || s.contentDueToday > 0) {
    const n = s.contentOverdue + s.contentDueToday;
    out.push({
      key: "content",
      title: `${n} ${n === 1 ? "post" : "posts"} to ship ${s.contentOverdue > 0 ? "(some late)" : "today"}`,
      why: "Done beats perfect. Post it, then move on.",
      href: "/content",
      cta: "Ship it",
      tone: s.contentOverdue > 0 ? "warning" : "primary",
      points: 15,
    });
  }
  if (s.focusTasksOpen > 0 && s.morningDone) {
    out.push({
      key: "focus",
      title: `${s.focusTasksOpen} of your top 3 still open`,
      why: "These are the ones you said matter most.",
      href: "/tasks",
      cta: "Work the list",
      tone: "primary",
    });
  }
  if (s.curriculumDay) {
    out.push({
      key: "curriculum",
      title: `Day ${s.curriculumDay.day}: ${s.curriculumDay.title}`,
      why: "Your 30-day build, one step a day.",
      href: "/pathway#curriculum",
      cta: "Do today's step",
      tone: "neutral",
      points: s.curriculumDay.points,
    });
  }
  if (s.nextPathwayTask) {
    out.push({
      key: "pathway",
      title: `Next on your pathway: ${s.nextPathwayTask.name}`,
      why: "Every verified task moves you up a stage.",
      href: `/pathway?task=${s.nextPathwayTask.key}`,
      cta: "Open task",
      tone: "neutral",
      points: s.nextPathwayTask.points,
    });
  }
  if (!s.eveningDone && s.hour >= 15) {
    out.push({
      key: "close",
      title: s.streakAlive && s.runningStreak > 0 ? `Close your day and keep the ${s.runningStreak}-day streak` : "Close your day",
      why: "Log your numbers. Name the win. Streak bonus is waiting.",
      href: "#close",
      cta: "Close the day",
      tone: "primary",
      points: 20,
    });
  }
  if (out.length === 0) {
    out.push({
      key: "done",
      title: "You're clear. Go start a conversation.",
      why: "Empty list, full day. Reach out to 3 people in your audience.",
      href: "/conversations?new=1",
      cta: "Add a contact",
      tone: "neutral",
      points: 5,
    });
  }
  return out;
}
