import Link from "next/link";
import { BRAND_CAP, ESSENCE_CAP, brandChars, brandFieldSizes, brandOver, coreChars, essenceOver, sectionSizes, type EssenceData } from "@/lib/engine/essence";

/**
 * An Essence over a budget (it can arrive whole from an Airtable import, 28 Sep): kept as it is, never cut, and marked with
 * which part is over (H-811). The core (every section but Brand) over its 20,000 characters leaves the whole Essence out of
 * every AI call until it is trimmed under; Brand over its own budget leaves out only Brand, and the core still leads. Trim to
 * fit: how much to take out, and each section's (or Brand field's) size, largest first. `own` links each one to its step on
 * the member's own Essence page; the coach's view of a client is read-only.
 */
export function EssenceOverNote({ data, own }: { data: EssenceData; own: boolean }) {
  const over = essenceOver(data);
  const brand = brandOver(data);
  if (!over && !brand) return null;
  const who = own ? "Your" : "Their";
  return (
    <>
      {over ? (
        <div className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="essence-over-cap" data-part="core" role="status">
          <p>
            <strong>Over the limit:</strong> the Essence without Brand is {coreChars(data).toLocaleString()} of {ESSENCE_CAP.toLocaleString()} characters. Nothing has been cut. {who} AI doesn&apos;t use this Essence until it&apos;s under the limit: trim {over.toLocaleString()} characters to fit. Brand has its own budget and isn&apos;t counted here.
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
      ) : null}
      {brand ? (
        <div className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="essence-brand-over-cap" data-part="brand" role="status">
          <p>
            <strong>Brand is over its own budget:</strong> {brandChars(data).toLocaleString()} of {BRAND_CAP.toLocaleString()} characters. Nothing has been cut. {who} AI still uses the rest of the Essence and leaves out only Brand until it&apos;s under: trim {brand.toLocaleString()} characters from Brand to fit.
          </p>
          <ul className="mt-2 space-y-0.5" data-testid="essence-brand-trim">
            {brandFieldSizes(data).map((f) => (
              <li key={f.key} className="flex justify-between gap-3">
                {own ? (
                  <Link href="/essence?step=brand" className="underline">
                    {f.label}
                  </Link>
                ) : (
                  <span>{f.label}</span>
                )}
                <span className="tabular text-ink-2">{f.chars.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
