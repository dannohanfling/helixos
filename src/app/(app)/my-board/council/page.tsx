import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { customSeatsOf, pickerFor } from "@/lib/board-seats";
import { deleteCustomSeatAction, saveCouncilAction, saveCustomSeatAction } from "@/lib/actions/council";
import { setBoardPresetAction } from "@/lib/actions/board";
import { MAX_CUSTOM_SEATS } from "@/lib/engine/board-seats";
import type { BoardSeat } from "@/db/schema";
import { CouncilPicker } from "@/components/council-picker";
import { CustomSeatName } from "@/components/custom-seat-name";
import { Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Choose your council" };

const SAVED: Record<string, string> = {
  custom: "Saved. New answers use this version; past answers keep the one they used.",
  "custom-new": "Your custom seat is ready. Add it to your council below the chairs.",
  "custom-gone": "Custom seat removed.",
};

/**
 * My Board → Choose your council (rev 756 §2 and §3): Danno at the head, the member's four chairs, the library to choose from,
 * and their own custom seats (up to two, private to them; their coach sees them on the client page).
 */
export default async function CouncilPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string; edit?: string; make?: string; preset?: string; chair?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const { seats, chairs, live } = await pickerFor(v);
  const canEdit = !v.switchedInto && !v.team;
  const mine = await customSeatsOf(v.workspace.id, v.user.id);
  const editing = sp.edit ? (mine.find((s) => s.id === sp.edit) ?? null) : null;
  const making = sp.make === "1" || Boolean(editing);
  const startTab = sp.tab === "custom" ? "custom" : live ? "all" : "archetypes";
  const edgeNote = v.role === "coach" && !v.switchedInto && v.membership.boardPreset === "edge";

  const customPanel = (
    <div className="mb-4 grid gap-3" data-testid="council-custom">
      <p className="text-sm text-ink-3">
        Make up to {MAX_CUSTOM_SEATS} seats of your own. They&apos;re private to you; your coach can see them. Each one carries the standard boundaries: it never claims to be a real person, never quotes anyone, and labels anything beyond its focus &quot;my read&quot;.
      </p>
      {mine.map((s) => (
        <CustomSeatRow key={s.id} seat={s} canEdit={canEdit} onCouncil={(v.membership.boardCouncil ?? []).includes(s.id)} />
      ))}
      {canEdit && (making || mine.length < MAX_CUSTOM_SEATS) ? (
        making ? (
          <CustomSeatForm seat={editing} />
        ) : (
          <Link href="/my-board/council?tab=custom&make=1#custom-form" className="btn btn-soft btn-sm self-start" data-testid="council-custom-make">
            Make a custom seat
          </Link>
        )
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Choose your council"
        subtitle="Four seats sit with Danno on every decision. Pick who, and in which chair; at least one must be an operator, who turns the advice into your action steps."
        action={
          <Link href="/my-board" className="btn btn-ghost btn-sm">
            Back to My Board
          </Link>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="council-error">
          {sp.error}
        </p>
      ) : sp.saved && SAVED[sp.saved] ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="council-saved">
          {SAVED[sp.saved]}
        </p>
      ) : null}
      {v.role === "coach" && !v.switchedInto ? (
        // The Edge Preset (rev 837): your own Board only, never offered to clients. One tap fills the room with its five.
        <section className={`card mb-4 p-4 sm:p-5 ${edgeNote ? "border-accent" : ""}`} aria-label="Edge Preset" data-testid="council-edge">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Your own Board only</div>
              <h2 className="font-semibold">Edge Preset</h2>
              <p className="text-sm text-ink-2">Tony Robbins style, Dean Graziosi style, Igor Pogany style, Jordan the Operator and Morgan the Antagonist. Clients never see this.</p>
              {edgeNote ? (
                <p className="mt-1 text-sm font-medium" data-testid="council-edge-on">
                  On: your Board sits with the Edge Preset. The council below is the one it uses when you switch back.
                </p>
              ) : null}
            </div>
            <form action={setBoardPresetAction}>
              <input type="hidden" name="preset" value={edgeNote ? "standard" : "edge"} />
              <input type="hidden" name="back" value="council" />
              <SubmitButton className={`btn btn-sm ${edgeNote ? "btn-ghost" : "btn-primary"}`} pendingText="Saving…" data-testid="council-edge-toggle">
                {edgeNote ? "Back to my council" : "Use the Edge Preset"}
              </SubmitButton>
            </form>
          </div>
        </section>
      ) : null}
      {!canEdit ? <p className="mb-4 text-sm text-ink-3">{v.user.name.split(" ")[0]} chooses their own council. This is what it is now.</p> : null}
      <CouncilPicker seats={seats} initial={chairs} live={live} canEdit={canEdit} action={saveCouncilAction} startTab={startTab} customPanel={customPanel} startChair={/^[0-3]$/.test(sp.chair ?? "") ? Number(sp.chair) : null} />
    </>
  );
}

function CustomSeatRow({ seat, canEdit, onCouncil }: { seat: BoardSeat; canEdit: boolean; onCouncil: boolean }) {
  const myRead = seat.realPerson && !seat.profile.sources.length;
  return (
    <div id={`c-${seat.id}`} className="flex flex-wrap items-start gap-3 rounded-xl border border-line p-3" data-testid="council-custom-row" data-version={seat.version}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {seat.name} {seat.isOperator ? <span className="badge badge-accent">Operator</span> : null} {onCouncil ? <span className="badge">On your council</span> : null}
        </div>
        <p className="text-sm text-ink-2">{seat.profile.purpose}</p>
        {myRead ? (
          <p className="text-xs text-ink-3" data-testid="council-custom-my-read">
            My read only: named after a real person with no sources, so everything it says is labelled &quot;my read&quot;.
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/my-board/council?tab=custom&edit=${seat.id}#custom-form`} className="btn btn-ghost btn-xs" data-testid="council-custom-edit">
            Edit
          </Link>
          {onCouncil ? null : (
            <form action={deleteCustomSeatAction}>
              <input type="hidden" name="id" value={seat.id} />
              <SubmitButton className="btn btn-ghost btn-xs text-danger" pendingText="…" data-testid="council-custom-remove">
                Remove
              </SubmitButton>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CustomSeatForm({ seat }: { seat: BoardSeat | null }) {
  const p = seat?.profile;
  return (
    <form id="custom-form" action={saveCustomSeatAction} className="grid gap-3 rounded-xl border border-line p-3" data-testid="council-custom-form">
      {seat ? <input type="hidden" name="id" value={seat.id} /> : null}
      <CustomSeatName name={seat?.name ?? ""} realPerson={seat ? seat.realPerson : null} />
      <Field label="What this seat focuses on">
        <textarea className="field" name="focus" rows={2} maxLength={400} defaultValue={p?.purpose ?? ""} required data-testid="council-custom-focus" />
      </Field>
      {[0, 1, 2].map((i) => (
        <Field key={i} label={`Question ${i + 1} it asks`}>
          <input className="field" name={`q${i}`} maxLength={200} defaultValue={p?.questions[i] ?? ""} required data-testid={`council-custom-q${i}`} />
        </Field>
      ))}
      <Field label="Its voice" hint="How it talks: blunt, warm, numbers-first…">
        <input className="field" name="voice" maxLength={300} defaultValue={p?.voice ?? ""} required data-testid="council-custom-voice" />
      </Field>
      <Field label="Sources (optional)" hint='One per line: a title, or "Label: https://…".'>
        <textarea className="field" name="sources" rows={2} defaultValue={p?.sources.map((x) => (x.url ? `${x.label}: ${x.url}` : x.label)).join("\n") ?? ""} data-testid="council-custom-sources" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="operator" value="1" defaultChecked={seat?.isOperator ?? false} data-testid="council-custom-operator" />
        <span>This seat turns advice into steps (it can be your council&apos;s operator)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="council-custom-save">
          {seat ? "Save as a new version" : "Make this seat"}
        </SubmitButton>
        <Link href="/my-board/council?tab=custom" className="btn btn-ghost btn-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}
