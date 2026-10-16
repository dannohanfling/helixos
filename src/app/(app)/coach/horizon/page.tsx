import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addHorizonItemAction, moveHorizonItemAction, reorderHorizonItemAction, saveHorizonItemAction, setHorizonHiddenAction } from "@/lib/actions/horizon";
import { horizonForCoach, type CoachHorizonItem } from "@/lib/horizon";
import { HORIZON_AREAS, HORIZON_LISTS, HORIZON_MENU_KEYS, SHIPPED_DAYS, shippedShows } from "@/lib/engine/horizon";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "On the horizon" };

/** The item form, shared by Add and each card's edit. */
function Fields({ item }: { item?: CoachHorizonItem }) {
  return (
    <>
      <Field label="Title">
        <input className="field" name="title" defaultValue={item?.title ?? ""} maxLength={80} required data-testid="horizon-f-title" />
      </Field>
      <Field label="One line, in the member's words">
        <input className="field" name="line" defaultValue={item?.line ?? ""} maxLength={200} required data-testid="horizon-f-line" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Area">
          <select className="field" name="area" defaultValue={item?.area ?? "Daily"} data-testid="horizon-f-area">
            {HORIZON_AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
        <Field label="List">
          <select className="field" name="status" defaultValue={item?.status ?? "next"} data-testid="horizon-f-status">
            {HORIZON_LISTS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Menu entry it drives">
          <select className="field" name="menuKey" defaultValue={item?.menuKey ?? ""} data-testid="horizon-f-menu">
            <option value="">None</option>
            {HORIZON_MENU_KEYS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label} ({k.href})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="fromFeedback" defaultChecked={item?.fromFeedback ?? false} data-testid="horizon-f-feedback" /> Came from member feedback (&quot;You asked for this&quot;)
      </label>
    </>
  );
}

/**
 * Coach → On the horizon (H-385 §6): add, edit, hide, reorder and move items between the four lists; pick the menu entry an item
 * drives; see how many members want each one and who. Names show here only; members see their own vote alone.
 */
export default async function CoachHorizonPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  const items = await horizonForCoach(coach.workspace.id);
  const now = new Date();
  return (
    <>
      <PageHeader title="On the horizon" subtitle={<Link href="/whats-new/horizon" className="hover:underline">As members see it →</Link>} action={<Link href="/coach" className="btn btn-ghost btn-sm">Back</Link>} />
      {sp.error ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="horizon-error">{sp.error}</p> : null}
      {sp.saved ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="horizon-saved">Saved.</p> : null}
      <Card title="Add an item" className="mb-4" id="add">
        <form action={addHorizonItemAction} className="space-y-3" data-testid="horizon-add">
          <Fields />
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Adding…" data-testid="horizon-add-submit">
            Add
          </SubmitButton>
        </form>
      </Card>
      <p className="mb-3 text-xs text-ink-3">Just shipped shows an item for {SHIPPED_DAYS} days after it ships, then it leaves the page (it stays here). A hidden item shows nowhere. The menu entry an item drives reads Coming soon until the item is in Just shipped.</p>
      <div className="space-y-4">
        {HORIZON_LISTS.map((l) => {
          const rows = items.filter((i) => i.status === l.key);
          return (
            <Card key={l.key} title={l.name} action={<span className="text-xs text-ink-3">{rows.length}</span>}>
              {rows.length ? (
                <ul className="divide-y" data-testid="horizon-coach-list" data-list={l.key}>
                  {rows.map((i) => (
                    <li key={i.id} id={`h-${i.id}`} className="py-3" data-testid="horizon-coach-item" data-item={i.id} data-hidden={i.hidden ? "1" : "0"}>
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold">{i.title}</span>
                          <span className="text-xs text-ink-3">{i.area}</span>
                          {i.fromFeedback ? <span className="badge">asked for</span> : null}
                          {i.menuKey ? <span className="badge">menu: {i.menuKey}</span> : null}
                          {i.hidden ? <span className="badge">hidden</span> : null}
                          {i.status === "shipped" && i.shippedAt ? <span className="text-xs text-ink-3">shipped {formatDate(i.shippedAt.slice(0, 10))}{shippedShows(i, now) ? "" : " · off the page"}</span> : null}
                          <span className="ml-auto text-xs text-ink-2" data-testid="horizon-wants" data-n={i.wants}>
                            {i.wants} want{i.wants === 1 ? "s" : ""} this{i.names.length ? `: ${i.names.join(", ")}` : ""}
                          </span>
                        </summary>
                        <form action={saveHorizonItemAction} className="mt-3 space-y-3" data-testid="horizon-edit">
                          <input type="hidden" name="id" value={i.id} />
                          <Fields item={i} />
                          <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="horizon-save">
                            Save
                          </SubmitButton>
                        </form>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <form action={reorderHorizonItemAction}>
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="dir" value="up" />
                            <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="horizon-up">↑ Up</SubmitButton>
                          </form>
                          <form action={reorderHorizonItemAction}>
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="dir" value="down" />
                            <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="horizon-down">↓ Down</SubmitButton>
                          </form>
                          {HORIZON_LISTS.filter((o) => o.key !== l.key).map((o) => (
                            <form key={o.key} action={moveHorizonItemAction}>
                              <input type="hidden" name="id" value={i.id} />
                              <input type="hidden" name="status" value={o.key} />
                              <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="horizon-move" data-to={o.key}>
                                → {o.name}
                              </SubmitButton>
                            </form>
                          ))}
                          <form action={setHorizonHiddenAction}>
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="hidden" value={i.hidden ? "0" : "1"} />
                            <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="horizon-hide">
                              {i.hidden ? "Show" : "Hide"}
                            </SubmitButton>
                          </form>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">Nothing here.</p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
