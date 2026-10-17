"use client";

import { useState } from "react";

/**
 * The points check's id report (H-402): sends the same form (the feed id and the chosen export) to the report route and
 * saves the CSV it answers, without leaving the page. A plain button, not a submit, so the check's own Compare is untouched;
 * it is disabled and says it is working until the answer is in, and a problem is said beside it in words.
 */
export function IdReportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        disabled={busy}
        aria-busy={busy}
        data-pending={busy ? "true" : undefined}
        data-testid="points-check-report"
        onClick={async (e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          setBusy(true);
          setError(null);
          try {
            const r = await fetch("/api/coach/points-check-report", { method: "POST", body: new FormData(form) });
            if (!r.ok) {
              const j = (await r.json().catch(() => null)) as { error?: string } | null;
              setError(j?.error ?? `The report could not be made (${r.status}).`);
              return;
            }
            const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "points-check-ids.csv";
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch {
            setError("No answer from HelixOS. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Making the report…" : "Download the id report (CSV)"}
      </button>
      {error ? (
        <span className="text-xs text-danger" data-testid="points-check-report-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
