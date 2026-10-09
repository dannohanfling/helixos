import { stampLine } from "@/lib/engine/office-hours";

/**
 * When an Office Hours request was sent, and when its member last changed it (rev 625), in the viewer's own zone. The full
 * date and time with seconds is the title: a hover on a computer, a long press on a phone.
 */
export function OohStamps({ createdAt, editedAt, tz, today }: { createdAt: string | null; editedAt: string | null; tz: string; today: string }) {
  const sent = stampLine("Submitted", createdAt, tz, today);
  const edited = editedAt ? stampLine("Edited", editedAt, tz, today) : null;
  return (
    <p className="mt-1 text-xs text-ink-3" data-testid="ooh-stamps">
      <time dateTime={createdAt ?? undefined} title={sent.title || undefined} data-testid="ooh-submitted">
        {sent.label}
      </time>
      {edited ? (
        <>
          {" · "}
          <time dateTime={editedAt ?? undefined} title={edited.title || undefined} data-testid="ooh-edited">
            {edited.label}
          </time>
        </>
      ) : null}
    </p>
  );
}
