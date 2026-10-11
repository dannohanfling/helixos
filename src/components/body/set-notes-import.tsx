"use client";

/**
 * Notes from the old training_sets.csv (rev 653): the file is read in the browser and sent to the member's own HelixOS, which
 * matches each note to a set by date, exercise and set number. Dry run lists every note it would add and changes nothing; Apply
 * writes them.
 */
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FilePicker } from "@/components/file-picker";
import type { SetNotesState } from "@/lib/actions/body";

export function SetNotesImport({ action }: { action: (prev: SetNotesState, fd: FormData) => Promise<SetNotesState> }) {
  const [state, run] = useActionState(action, undefined);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  return (
    <form action={run} className="space-y-2" data-testid="set-notes-import">
      <FilePicker
        kind="file"
        accept=".csv,text/csv"
        files={files}
        testId="set-notes-file"
        labels={{ upload: "Upload training_sets.csv" }}
        onChange={(fs) => {
          setFiles(fs);
          if (fs[0]) fs[0].text().then(setText, () => setText(""));
          else setText("");
        }}
      />
      <textarea hidden readOnly name="csv" value={text} />
      {state?.error ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="set-notes-error">
          {state.error}
        </p>
      ) : null}
      {state?.applied != null ? (
        <p className="text-sm text-good" role="status" data-testid="set-notes-applied" data-count={state.applied}>
          Added {state.applied} note{state.applied === 1 ? "" : "s"} to your sets.
        </p>
      ) : null}
      {state?.dry ? (
        <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="set-notes-dry" data-count={state.dry.matched.length}>
          <p>
            {state.dry.matched.length} of {state.dry.rows} note{state.dry.rows === 1 ? "" : "s"} match a set
            {state.dry.unmatched ? `; ${state.dry.unmatched} have no set on that day` : ""}. Nothing is changed yet.
          </p>
          {state.dry.matched.length ? (
            <ol className="mt-2 max-h-72 list-decimal space-y-0.5 overflow-y-auto pl-5 text-xs" data-testid="set-notes-list">
              {state.dry.matched.map((m) => (
                <li key={m.setId}>
                  {m.date} · {m.exercise} set {m.set}: “{m.note}”{m.had ? <span className="text-ink-3"> (replaces “{m.had}”)</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="mode" value="dry" className="btn btn-soft btn-sm" pendingText="Reading…" disabled={!text} data-testid="set-notes-dry-run">
          Dry run
        </SubmitButton>
        {state?.dry?.matched.length ? (
          <SubmitButton name="mode" value="apply" className="btn btn-humanos btn-sm" pendingText="Adding…" data-testid="set-notes-apply">
            Apply {state.dry.matched.length} note{state.dry.matched.length === 1 ? "" : "s"}
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
