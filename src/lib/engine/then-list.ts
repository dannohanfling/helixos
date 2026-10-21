/**
 * Today's "Then" list (H-164 §14): one list in place of Also on your plate, Content to ship, Conversations and Coming up,
 * ordered by when each thing is due. Overdue first, then today's in time order (a time of day before an untimed item), then
 * the week ahead. Pure: the page reads the rows and renders each kind its own way.
 */
export type ThenKind = "task" | "content" | "reply" | "follow" | "soon";
export type ThenItem = { key: string; kind: ThenKind; id: string; at: string; day: string; late: boolean };

type Dated = { id: string };
export type ThenInput = {
  today: string;
  /** Overdue and due-today tasks not in the Top 3. */
  tasks: (Dated & { dueDate: string | null })[];
  /** Posts not yet posted, due today or before. */
  content: (Dated & { postAt: string | null })[];
  /** Contacts who replied and wait on the member. */
  inbound: (Dated & { lastInboundAt: string | null })[];
  /** Contacts whose follow-up is due. */
  followUps: (Dated & { nextFollowUpAt: string | null })[];
  /** Tasks due in the next seven days. */
  upcoming: (Dated & { dueDate: string | null })[];
};

/** Within one moment, the order the kinds come in: someone waiting first, then what ships, then the rest. */
const KIND_ORDER: Record<ThenKind, number> = { reply: 0, content: 1, task: 2, follow: 3, soon: 4 };

/** A sortable moment: the date, then the time of day if there is one; an untimed item sits after the day's timed ones. */
function momentOf(value: string | null, today: string): string {
  if (!value) return `${today}T~`;
  const day = value.slice(0, 10);
  const time = value.length > 10 ? value.slice(11, 16) : "";
  return /^\d\d:\d\d$/.test(time) ? `${day}T${time}` : `${day}T~`;
}

export function thenItems(input: ThenInput): ThenItem[] {
  const { today } = input;
  const out: ThenItem[] = [];
  const seen = new Set<string>();
  const add = (kind: ThenKind, id: string, value: string | null) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const at = momentOf(value, today);
    const day = at.slice(0, 10);
    out.push({ key, kind, id, at, day, late: day < today });
  };
  for (const c of input.inbound) add("reply", c.id, c.lastInboundAt);
  for (const c of input.content) add("content", c.id, c.postAt);
  for (const t of input.tasks) add("task", t.id, t.dueDate);
  // A contact who already replied shows once, as a reply.
  const replying = new Set(input.inbound.map((c) => c.id));
  for (const c of input.followUps) if (!replying.has(c.id)) add("follow", c.id, c.nextFollowUpAt);
  const taskIds = new Set(input.tasks.map((t) => t.id));
  for (const t of input.upcoming) if (!taskIds.has(t.id)) add("soon", t.id, t.dueDate);
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
}

/** The NBA keys the Then list or the page already shows as rows, so the suggestions above it don't say them twice. */
export const SHOWN_AS_ROWS = new Set(["inbound", "overdue", "followups", "content", "focus", "close", "checkin"]);
