/**
 * 30 Days in the Arena on Today (H-1563 PR A): one card. Before the start, an invite with "I'm in" (joining from here keeps the
 * member on Today); once in, the day count, days closed out of 24, today's status and the next Huddle; after, the total.
 */
import Link from "next/link";
import { joinArenaAction } from "@/lib/actions/arena";
import { SubmitButton } from "@/components/submit-button";
import type { ArenaCard } from "@/lib/engine/arena";

export function ArenaToday({ card }: { card: ArenaCard }) {
  return (
    <section id="arena" className="mb-4 rounded-xl border border-[#6b4b1c] bg-[#18130e] p-4 text-[#f6efe3]" data-testid="today-arena" data-kind={card.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[#f2c766]">🏛️ {card.title}</h2>
        <Link href="/arena" className="btn btn-sm min-h-11! border-[#6b4b1c]! text-[#f2c766] hover:bg-[#2a2016]" data-testid="today-arena-open">
          {card.kind === "invite" ? "What it is →" : "The Arena →"}
        </Link>
      </div>
      <p className="mt-1 text-sm text-[#cdbfa9]" data-testid="today-arena-line">
        {card.line}
      </p>
      {card.kind === "day" ? (
        <p className={`mt-1 text-sm ${card.closedToday ? "text-[#6fbf73]" : "text-[#f6efe3]"}`} data-testid="today-arena-status">
          {card.status}
        </p>
      ) : null}
      {(card.kind === "day" || card.kind === "waiting") && card.huddle ? <p className="mt-1 text-xs text-[#9a8b75]">{card.huddle}</p> : null}
      {card.kind === "invite" ? (
        <form action={joinArenaAction} className="mt-3">
          <input type="hidden" name="from" value="today" />
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Joining…" data-testid="today-arena-join">
            I&apos;m in
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
