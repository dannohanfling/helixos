"use client";

/**
 * The RENPHO CSV import: the file is read in the browser and shown as a preview from the same parser the server uses (how many
 * readings, which days, which format, what was skipped and why), then its text goes to the action, which parses it again and
 * trusts only that. The file never leaves the member's browser except to their own HelixOS.
 */
import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FilePicker } from "@/components/file-picker";
import { parseScaleCsv } from "@/lib/engine/body-scale";

export function ScaleImport({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const parsed = useMemo(() => (text ? parseScaleCsv(text) : null), [text]);
  const days = parsed ? new Set(parsed.readings.map((r) => r.date)).size : 0;
  const first = parsed?.readings.reduce((a, r) => (r.date < a ? r.date : a), parsed.readings[0]?.date ?? "");
  const last = parsed?.readings.reduce((a, r) => (r.date > a ? r.date : a), parsed.readings[0]?.date ?? "");
  return (
    <form action={action} className="space-y-2" data-testid="scale-import">
      <div className="block">
        <span className="label">RENPHO export (.csv)</span>
        <FilePicker
          kind="file"
          accept=".csv,text/csv"
          files={files}
          testId="scale-file"
          labels={{ upload: "Upload the .csv" }}
          onChange={(fs) => {
            const f = fs[0];
            setFiles(fs);
            setName(f?.name ?? "");
            if (f) f.text().then(setText, () => setText(""));
            else setText("");
          }}
        />
      </div>
      <textarea hidden readOnly name="csv" value={text} />
      {parsed ? (
        parsed.readings.length ? (
          <div className="rounded-lg bg-surface-2 p-3 text-sm" data-testid="scale-preview" data-count={parsed.readings.length}>
            <p>
              <b>{name}</b>: {parsed.readings.length} reading{parsed.readings.length === 1 ? "" : "s"} across {days} day{days === 1 ? "" : "s"}, {first} to {last}, the {parsed.format} format
              {parsed.unit === "kg" ? ", in kg (stored as lb)" : ""}.
            </p>
            {parsed.skipped.length ? (
              <p className="mt-1 text-xs text-ink-3" data-testid="scale-skipped">
                {parsed.skipped.length} row{parsed.skipped.length === 1 ? "" : "s"} skipped: {parsed.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.why})`).join(", ")}
                {parsed.skipped.length > 5 ? "…" : ""}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-3">Readings already in HelixOS are left as they are, so importing the same export twice adds nothing.</p>
          </div>
        ) : (
          <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="scale-preview-none">
            Nothing to import from <b>{name}</b>: {parsed.skipped[0]?.why ?? "no readings"}.
          </p>
        )
      ) : null}
      <SubmitButton className="btn btn-humanos btn-sm" pendingText="Importing…" disabled={!parsed?.readings.length} data-testid="scale-import-go">
        Import{parsed?.readings.length ? ` ${parsed.readings.length} readings` : ""}
      </SubmitButton>
    </form>
  );
}
