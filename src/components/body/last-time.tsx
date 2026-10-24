import { formatDate } from "@/lib/dates";

type LastView = { from: "same" | "other"; date: string; routineName: string | null; warmups: string[]; working: string[] } | null;

/** "Last Shoulder Day: Wed, Oct 14" over a workout (H-1790), or nothing before the routine's first finished session. */
export function LastSessionLine({ last, routineName }: { last: { date: string; routineName: string | null } | null; routineName?: string | null }) {
  if (!last) return null;
  return (
    <p className="mb-2 text-sm text-ink-2" data-testid="training-last-session" data-date={last.date}>
      Last {last.routineName ?? routineName ?? "time"}: <span className="font-medium text-ink">{formatDate(last.date, { weekday: "short", month: "short", day: "numeric" })}</span>
    </p>
  );
}

/**
 * One exercise's last time (H-1790): every set, warm-ups first and muted, then working sets. From the workout's last session it
 * needs no date (the line above has it); a fallback says its own date and routine so it's clear it was another day.
 */
export function LastSetsLine({ last, testId = "training-last" }: { last: LastView; testId?: string }) {
  if (!last) return <span className="text-ink-3">First time: no sets before this.</span>;
  const when = formatDate(last.date, { weekday: "short", month: "short", day: "numeric" });
  return (
    <span data-testid={`${testId}-sets`} data-from={last.from}>
      <span className="text-ink-3">{last.from === "same" ? "Last time: " : `Last done ${when}${last.routineName ? `, ${last.routineName}` : ""}: `}</span>
      {last.warmups.length ? (
        <span className="text-ink-3" data-testid={`${testId}-warmups`}>
          Warm-up {last.warmups.join(" · ")}
          {last.working.length ? " | " : ""}
        </span>
      ) : null}
      <span className="tabular">{last.working.join(" · ")}</span>
    </span>
  );
}
