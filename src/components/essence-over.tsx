import Link from "next/link";
import { ESSENCE_CAP, essenceChars, essenceOver, sectionSizes, type EssenceData } from "@/lib/engine/essence";

/**
 * An Essence over the 20,000-character cap (it can arrive whole from an Airtable import, 28 Sep): kept as it is, never cut, and
 * left out of every AI call until it is trimmed under. Trim to fit: how much to take out, and each section's size, largest
 * first. `own` links each section to its step on the member's own Essence page; the coach's view of a client is read-only.
 */
export function EssenceOverNote({ data, own }: { data: EssenceData; own: boolean }) {
  const over = essenceOver(data);
  if (!over) return null;
  return (
    <div className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="essence-over-cap" role="status">
      <p>
        <strong>Over the limit:</strong> {essenceChars(data).toLocaleString()} of {ESSENCE_CAP.toLocaleString()} characters. Nothing has been cut. {own ? "Your" : "Their"} AI doesn&apos;t use this Essence until it&apos;s under the limit: trim {over.toLocaleString()} characters to fit.
      </p>
      <ul className="mt-2 space-y-0.5" data-testid="essence-trim">
        {sectionSizes(data).map((s) => (
          <li key={s.key} className="flex justify-between gap-3">
            {own ? (
              <Link href={`/essence?step=${s.key}`} className="underline">
                {s.title}
              </Link>
            ) : (
              <span>{s.title}</span>
            )}
            <span className="tabular text-ink-2">{s.chars.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
