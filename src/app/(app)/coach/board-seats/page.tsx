import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { librarySeats, seatUse } from "@/lib/board-seats";
import { saveSeatAction, setExpertSeatsLiveAction, setSeatEnabledAction } from "@/lib/actions/board-seats";
import { SEAT_AREAS, frameworkLine, sourceLine } from "@/lib/engine/board-seats";
import type { BoardSeat } from "@/db/schema";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Board seats" };

const SAVED: Record<string, string> = {
  live: "Expert seats are live: members can choose them, and their picks answer again.",
  off: "Expert seats are off: members see the Archetypes and their custom seats; any expert pick is paused and its chair sits with the archetype.",
  on: "Seat on: it's back in the picker.",
  "off-seat": "Seat off: it's out of the picker. Members who have it keep it, marked retired, until they swap it.",
  seat: "Saved. New answers use this version; past answers keep the one they used.",
  added: "Seat added to the library.",
};

/**
 * Coach → Board seats (rev 756 §4): every seat in the library, filterable by area, with on/off, operator, version and how many
 * members sit with it; an editor for any field or a new seat; and the "Expert seats live" switch, off at launch. Custom seats are
 * the members' own and show on each client's page, not here.
 */
export default async function BoardSeatsPage({ searchParams }: { searchParams: Promise<{ area?: string; edit?: string; error?: string; saved?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  const all = (await librarySeats(coach.workspace.id, { coach: true })).filter((s) => s.kind !== "custom");
  const use = await seatUse(coach.workspace.id);
  const area = sp.area && ((SEAT_AREAS as readonly string[]).includes(sp.area) || sp.area === "Archetypes") ? sp.area : "";
  const rows = all.filter((s) => (!area ? true : area === "Archetypes" ? s.kind === "archetype" : s.areas.includes(area)));
  const editing = sp.edit === "new" ? "new" : sp.edit ? (all.find((s) => s.id === sp.edit) ?? null) : null;
  const live = coach.workspace.expertSeatsLive;
  const tab = (a: string, label: string) => (
    <Link key={a || "all"} href={a ? `/coach/board-seats?area=${encodeURIComponent(a)}` : "/coach/board-seats"} className={`btn btn-sm ${area === a ? "btn-primary" : "btn-ghost"}`} aria-current={area === a ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Board seats"
        subtitle="The council library members choose from: the approved expert style-advisor seats and the four archetypes. Edits apply to new answers only."
        action={
          <Link href="/coach/board-seats?edit=new#edit" className="btn btn-primary btn-sm" data-testid="seat-add">
            Add a seat
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="seat-error">
          {sp.error}
        </p>
      ) : sp.saved && SAVED[sp.saved] ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="seat-saved">
          {SAVED[sp.saved]}
        </p>
      ) : null}

      <Card title="Expert seats live" className="mb-4">
        <form action={setExpertSeatsLiveAction} className="flex flex-wrap items-center gap-3" data-testid="seats-live">
          <input type="hidden" name="on" value={live ? "0" : "1"} />
          <Badge tone={live ? "good" : "warn"}>{live ? "Live" : "Off"}</Badge>
          <p className="min-w-0 flex-1 text-sm text-ink-2">
            {live
              ? "Members can choose expert seats for their council."
              : "Off until your legal review of the labelling. Members see only the Archetypes and their custom seats, and any expert pick is paused: its chair sits with the classic archetype until you turn this on. You always see everything."}
          </p>
          <SubmitButton className={`btn btn-sm ${live ? "btn-ghost" : "btn-primary"}`} pendingText="Saving…" data-testid="seats-live-toggle">
            {live ? "Turn off" : "Turn on"}
          </SubmitButton>
        </form>
      </Card>

      {editing ? <SeatEditor seat={editing === "new" ? null : editing} area={area} /> : null}

      <div className="mb-3 flex flex-wrap gap-1" role="navigation" aria-label="Skill areas" data-testid="seat-areas">
        {tab("", `All (${all.length})`)}
        {tab("Archetypes", "Archetypes")}
        {SEAT_AREAS.map((a) => tab(a, a))}
      </div>
      <Card>
        <ul className="divide-y" data-testid="seat-list">
          {rows.map((s) => (
            <li key={s.id} id={`s-${s.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid="seat-row" data-slug={s.slug} data-version={s.version}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.name} {s.isOperator ? <Badge tone="accent">Operator</Badge> : null} {s.enabled ? null : <Badge tone="warn">Off</Badge>}
                </div>
                <div className="text-xs text-ink-3">
                  {s.kind === "archetype" ? "Archetype" : s.areas.join(" · ")} · version {s.version} · {use.get(s.id) ?? 0} on a council
                </div>
              </div>
              <Link href={`/coach/board-seats?${new URLSearchParams({ ...(area ? { area } : {}), edit: s.id }).toString()}#edit`} className="btn btn-ghost btn-xs" data-testid="seat-edit">
                Edit
              </Link>
              <form action={setSeatEnabledAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="on" value={s.enabled ? "0" : "1"} />
                <input type="hidden" name="area" value={area} />
                <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="seat-toggle">
                  {s.enabled ? "Turn off" : "Turn on"}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function SeatEditor({ seat, area }: { seat: BoardSeat | null; area: string }) {
  const p = seat?.profile;
  const text = (name: string, label: string, value: string, rows = 2, hint?: string) => (
    <Field label={label} hint={hint}>
      <textarea className="field" name={name} rows={rows} defaultValue={value} data-testid={`seat-${name}`} />
    </Field>
  );
  return (
    <Card id="edit" title={seat ? `Edit ${seat.name} (version ${seat.version})` : "Add a seat"} className="mb-4">
      <form action={saveSeatAction} className="grid gap-3 sm:grid-cols-2" data-testid="seat-editor">
        {seat ? <input type="hidden" name="id" value={seat.id} /> : null}
        <input type="hidden" name="area" value={area} />
        <Field label="Name" hint={seat?.kind === "archetype" ? undefined : 'Expert seats are named "{Name} style".'}>
          <input className="field" name="name" defaultValue={seat?.name ?? ""} required data-testid="seat-name" />
        </Field>
        <Field label="Card (for the picker, 20 words at most)">
          <input className="field" name="card" defaultValue={seat?.card ?? ""} data-testid="seat-card" />
        </Field>
        {seat?.kind === "archetype" ? null : (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-xs font-semibold text-ink-2">Skill areas</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SEAT_AREAS.map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input type="checkbox" name="areas" value={a} defaultChecked={seat?.areas.includes(a)} /> {a}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {text("purpose", "Purpose", p?.purpose ?? "")}
        {text("stance", "Core stance", p?.stance ?? "")}
        {text("questions", "Decision questions", p?.questions.join("\n") ?? "", 4, "One per line.")}
        {text("frameworks", "Key frameworks", p?.frameworks.map(frameworkLine).join("\n") ?? "", 4, 'One per line: "Name: what it says (Source: where)". A source of "Edge preset" is never shown as public.')}
        {text("speaksUpOn", "Speaks up on", p?.speaksUpOn ?? "")}
        {text("evidence", "Evidence standard", p?.evidence ?? "")}
        {text("blindSpot", "Likely blind spot", p?.blindSpot ?? "")}
        {text("voice", "Voice", p?.voice ?? "")}
        {text("boundaries", "Hard boundaries", p?.boundaries ?? "")}
        {text("contribution", "Unique contribution", p?.contribution ?? "")}
        {text("sources", "Public sources", p?.sources.map(sourceLine).join("\n") ?? "", 4, 'One per line: a title, or "Label: https://…".')}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="operator" value="1" defaultChecked={seat?.isOperator ?? false} data-testid="seat-operator" /> Operator seat: it turns advice into the action steps
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="seat-save">
            {seat ? "Save as a new version" : "Add to the library"}
          </SubmitButton>
          <Link href={`/coach/board-seats${area ? `?area=${encodeURIComponent(area)}` : ""}`} className="btn btn-ghost btn-sm">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
