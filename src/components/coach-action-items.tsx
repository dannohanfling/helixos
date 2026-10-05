import type { RecordingActionItem } from "@/db/schema";
import { groupActionItems, itemMoment, type ItemPerson } from "@/lib/engine/recording-members";

/**
 * A call's action items as the coach reads them (rev 496): every person's group open, the coach's own first, members by name
 * and anyone else by the name Fathom gave (never an email), each item with its "▶ 12:34" into the call and, for a member's
 * item, whether they made it a task or let it go.
 */
export function CoachActionItems({ items, people, coach, watch, handled }: { items: RecordingActionItem[]; people: ItemPerson[]; coach: { email: string; name: string }; watch: string | null; handled?: Map<number, "accepted" | "dismissed"> }) {
  const groups = groupActionItems(items, people, { ...coach, role: "coach" });
  return (
    <div className="space-y-3 text-xs" data-testid="coach-action-items">
      {groups.map((g) => (
        <section key={g.key} data-testid="coach-item-group" data-own={g.own ? "yes" : "no"}>
          <p className="font-semibold text-ink-2">
            {g.label} ({g.items.length})
          </p>
          <ul className="mt-1 space-y-1.5">
            {g.items.map(({ item, index }) => {
              const moment = itemMoment(item, watch);
              const state = handled?.get(index);
              return (
                <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-ink-2" data-testid="coach-item">
                  <span className="break-words">{item.description}</span>
                  {moment ? (
                    <a href={moment.href} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline" data-testid="coach-item-moment">
                      {moment.label}
                    </a>
                  ) : null}
                  {state === "accepted" ? <span className="text-good">made a task</span> : state === "dismissed" ? <span className="text-ink-3">let go</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
