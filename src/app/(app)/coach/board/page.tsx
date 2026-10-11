import { requireCoach } from "@/lib/auth";
import { principlesFor } from "@/lib/board";
import { removePrincipleAction, savePrincipleAction } from "@/lib/actions/board";
import { Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "The Danno Seat" };

/**
 * The Danno Seat's principles (rev 664 §8): seeded from docs/board/danno-source-pack.md, Danno's to add, edit or remove. Every
 * client's Board reads the current list from its next answer. Only his own, ok-to-use material: no prices, no client names, no
 * stories marked to check or needing permission.
 */
export default async function DannoSeatPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  const rows = await principlesFor(coach.workspace.id);
  return (
    <>
      <PageHeader title="The Danno Seat" subtitle="The principles the Danno Seat uses on every client's Board. It never claims to be you, never invents your quotes, stories or numbers, never quotes your prices, and sends personal questions to Office Hours." />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="principle-error">
          {sp.error}
        </p>
      ) : sp.saved ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="principle-saved">
          {sp.saved === "removed" ? "Removed. Every Board stops using it from its next answer." : "Saved. Every Board uses it from its next answer."}
        </p>
      ) : null}
      <div className="space-y-3" data-testid="principles">
        {rows.map((p) => (
          <Card key={p.id} id={`p-${p.id}`}>
            <form action={savePrincipleAction} className="grid gap-2 sm:grid-cols-[1fr_12rem]">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Principle">
                <input className="field" name="title" defaultValue={p.title} required data-testid="principle-title" />
              </Field>
              <Field label="Good for">
                <input className="field" name="goodFor" defaultValue={p.goodFor} />
              </Field>
              <div className="sm:col-span-2">
                <textarea className="field" name="body" rows={2} defaultValue={p.body} required aria-label="In plain words" />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…">
                  Save
                </SubmitButton>
              </div>
            </form>
            <form action={removePrincipleAction} className="mt-1">
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton className="btn btn-ghost btn-sm text-danger" pendingText="Removing…" data-testid="principle-remove">
                Remove
              </SubmitButton>
            </form>
          </Card>
        ))}
      </div>
      <Card id="new" title="Add a principle" className="mt-4">
        <form action={savePrincipleAction} className="grid gap-2 sm:grid-cols-[1fr_12rem]" data-testid="principle-new">
          <Field label="Principle">
            <input className="field" name="title" required data-testid="principle-new-title" />
          </Field>
          <Field label="Good for">
            <input className="field" name="goodFor" placeholder="Offers" data-testid="principle-new-goodfor" />
          </Field>
          <div className="sm:col-span-2">
            <textarea className="field" name="body" rows={2} required aria-label="In plain words" data-testid="principle-new-body" />
          </div>
          <SubmitButton className="btn btn-primary btn-sm w-fit" pendingText="Adding…" data-testid="principle-add">
            Add
          </SubmitButton>
        </form>
      </Card>
    </>
  );
}
