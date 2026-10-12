import type { ReactNode } from "react";
import type { ConnectCopy } from "@/lib/engine/connect-copy";

/**
 * The grey "how to" box (rev 850, laid out like the AI key card): a heading, an optional lead, numbered steps (a step can carry
 * its own short list), then whatever goes under them, like the permission list. The words come from src/lib/engine/connect-copy.ts.
 */
export function ConnectBox({ copy, children, testId }: { copy: ConnectCopy; children?: ReactNode; testId: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid={testId}>
      <div className="font-semibold">{copy.boxHeading}</div>
      {copy.boxLead ? <p className="mt-1 text-ink-2">{copy.boxLead}</p> : null}
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
        {copy.steps.map((s, i) =>
          Array.isArray(s) ? (
            <li key={i}>
              {s[0]}
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
                {s.slice(1).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </li>
          ) : (
            <li key={i}>{s}</li>
          ),
        )}
      </ol>
      {children}
    </div>
  );
}
