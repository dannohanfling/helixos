"use client";

import { useActionState, useState } from "react";
import { importAction, type ImportState } from "@/lib/actions/import";
import { SubmitButton } from "@/components/submit-button";
import { Card } from "@/components/ui";

const EMPTY = { client: "", newName: "", newEmail: "", newBusiness: "", sourceBase: "", sourceToken: "", fallbackBase: "", fallbackToken: "", since: "" };
type Fields = typeof EMPTY;

/**
 * The import form. Every input is held here, so the tokens pasted for the dry run are still in their boxes for Approve and go
 * nowhere else: not into the address, not into the page the server sends back, not into the browser's saved form data. Change
 * anything after a dry run and Approve waits for a fresh one.
 */
export function ImportForm({ clients }: { clients: { id: string; label: string }[] }) {
  const [state, action] = useActionState<ImportState, FormData>(importAction, undefined);
  const [f, setF] = useState<Fields>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState(state);
  // A new answer from the server: the form matches what it shows again.
  if (seen !== state) {
    setSeen(state);
    setDirty(false);
  }
  const bind = (k: keyof Fields) => ({
    name: k,
    value: f[k],
    onChange: (e: { target: { value: string } }) => {
      setF({ ...f, [k]: e.target.value });
      setDirty(true);
    },
  });
  const p = state?.preview;
  const canApprove = p && !dirty;
  const areas = p ? [...new Set(p.lines.map((l) => l.area))] : [];

  return (
    <form action={action} className="space-y-4" data-testid="import-form" autoComplete="off">
      <Card title="1. The client">
        {/* React resets a form after its action, and a select doesn't come back from that; so the picker stays outside the form's
            reset (form="") and the hidden input, which keeps what React sets, carries the choice. */}
        <input type="hidden" name="client" value={f.client} />
        <select className="field" {...bind("client")} name={undefined} form="" data-testid="import-client">
          <option value="">Pick a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="new">+ A new client</option>
        </select>
        {f.client === "new" ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="label">Name</span>
              <input className="field" {...bind("newName")} required maxLength={80} placeholder="Aroha Wiremu" data-testid="import-new-name" />
            </label>
            <label className="block">
              <span className="label">Login email</span>
              <input className="field" type="email" {...bind("newEmail")} required placeholder="aroha@example.com" data-testid="import-new-email" />
            </label>
            <label className="block">
              <span className="label">Business name</span>
              <input className="field" {...bind("newBusiness")} maxLength={120} placeholder="Tide Line Coaching" />
            </label>
            <p className="text-xs text-ink-3 sm:col-span-3">Created when you press Approve, with no email sent. When it&apos;s time for them to log in, send the reset link from their page.</p>
          </div>
        ) : null}
      </Card>

      <Card title="2. The bases">
        <p className="mb-3 text-xs text-ink-3">One read-only token per base. They are used for this run only: never saved, never logged, never shown back. Leave the page and they are gone.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Source base id</span>
            <input className="field font-mono" {...bind("sourceBase")} required placeholder="appXXXXXXXXXXXXXX" spellCheck={false} data-testid="import-source-base" />
          </label>
          <label className="block">
            <span className="label">Source token</span>
            <input className="field font-mono" type="password" {...bind("sourceToken")} required autoComplete="new-password" spellCheck={false} placeholder="pat…" data-testid="import-source-token" />
          </label>
          <label className="block">
            <span className="label">Fallback base id (optional: the older base it was migrated from)</span>
            <input className="field font-mono" {...bind("fallbackBase")} placeholder="appXXXXXXXXXXXXXX" spellCheck={false} data-testid="import-fallback-base" />
          </label>
          <label className="block">
            <span className="label">Fallback token</span>
            <input className="field font-mono" type="password" {...bind("fallbackToken")} autoComplete="new-password" spellCheck={false} placeholder="pat…" data-testid="import-fallback-token" />
          </label>
          <label className="block">
            <span className="label">Only rows created on or after (optional; leaves the template&apos;s own rows out)</span>
            <input className="field" type="date" {...bind("since")} data-testid="import-since" />
          </label>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="intent" value="dry" className="btn btn-soft" pendingText="Reading the base…" data-testid="import-dry">
          Dry run
        </SubmitButton>
        {p ? <input type="hidden" name="key" value={p.key} /> : null}
        {p ? (
          <SubmitButton name="intent" value="approve" className="btn btn-primary" pendingText="Importing…" disabled={!canApprove} data-testid="import-approve">
            Approve and import into {p.who}
          </SubmitButton>
        ) : null}
        {p && dirty ? <span className="text-xs text-ink-3">You changed the form: run the dry run again first.</span> : null}
      </div>

      {state?.error ? (
        <p className="rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="import-error">
          {state.error}
        </p>
      ) : null}
      {state?.changed ? (
        <p className="rounded-xl border border-warn bg-warn-soft p-3 text-sm" role="alert" data-testid="import-changed">
          The base or the client changed since the dry run, so nothing was written. Here is the plan as it is now; Approve again if it&apos;s right.
        </p>
      ) : null}

      {p ? (
        <Card title={`Dry run for ${p.who}`}>
          <div data-testid="import-preview" className="space-y-4 text-sm">
            <table className="w-full max-w-md text-left">
              <thead className="text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="py-1">What</th>
                  <th className="py-1 text-right">New</th>
                  <th className="py-1 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {p.summary.map((row) => (
                  <tr key={row.area} className="border-t border-line" data-testid="import-summary-row">
                    <td className="py-1">{row.area}</td>
                    <td className="tabular py-1 text-right">{row.create}</td>
                    <td className="tabular py-1 text-right">{row.update}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={p.overCap ? "text-danger" : "text-ink-3"} data-testid="import-essence-size">
              Essence after the import: {p.essenceChars.toLocaleString()} of 20,000 characters.
              {p.overCap
                ? " That's over the limit. It goes in whole, with nothing cut, and is marked over the limit: their AI doesn't use it until it's trimmed under. Their Essence page and their client page show what to trim, section by section."
                : ""}
            </p>
            {p.missing.length ? (
              <div data-testid="import-missing">
                <p className="font-semibold">Tables not found in the base</p>
                <ul className="list-disc pl-5">
                  {p.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {p.unfilled.length ? (
              <div data-testid="import-unfilled">
                <p className="font-semibold">Couldn&apos;t fill without the fallback base</p>
                <ul className="list-disc pl-5">
                  {p.unfilled.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {p.notInPhase1.length ? (
              <div>
                <p className="font-semibold">Left for Phase 2</p>
                <ul className="list-disc pl-5 text-ink-2">
                  {p.notInPhase1.map((t) => (
                    <li key={t.table}>
                      {t.table}: {t.rows} rows
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="space-y-1">
              {areas.map((a) => {
                const lines = p.lines.filter((l) => l.area === a);
                return (
                  <details key={a} data-testid="import-area">
                    <summary className="cursor-pointer">
                      {a} ({lines.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {lines.map((l) => (
                        <li key={`${l.sourceRef}:${l.label}`}>
                          <span className={l.action === "skip" ? "text-ink-3" : l.action === "update" ? "text-warn" : "text-good"}>{l.action}</span> {l.label}
                          {l.note ? <span className="text-ink-3"> · {l.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}
    </form>
  );
}
