import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addGlossaryEntryAction, resetGlossaryEntryAction, saveGlossaryEntryAction } from "@/lib/actions/glossary";
import { glossaryFor } from "@/lib/glossary";
import { GLOSSARY_HEADINGS, GLOSSARY_MAX } from "@/lib/engine/glossary";

export const metadata = { title: "Glossary" };

/** Coach → Glossary (rev 768): edit, add or hide an entry; members see the change on their next load. */
export default async function CoachGlossaryPage() {
  const coach = await requireCoach();
  const items = await glossaryFor(coach.workspace.id);
  return (
    <>
      <PageHeader title="Glossary" subtitle={<Link href="/glossary" className="hover:underline">Building with AI: the words, as members see it →</Link>} />
      <Card title="Add a word" className="mb-4">
        <form action={addGlossaryEntryAction} className="grid gap-3 sm:grid-cols-[1fr_2fr]" data-testid="glossary-add">
          <Field label="Word">
            <input className="field" name="term" maxLength={GLOSSARY_MAX.term} required />
          </Field>
          <Field label="Meaning">
            <textarea className="field" name="meaning" rows={2} maxLength={GLOSSARY_MAX.meaning} required />
          </Field>
          <Field label="Under">
            <select className="field" name="heading" defaultValue={GLOSSARY_HEADINGS[GLOSSARY_HEADINGS.length - 1]}>
              {GLOSSARY_HEADINGS.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Adding…">
              Add
            </SubmitButton>
          </div>
        </form>
      </Card>
      <div className="space-y-2">
        {items.map((e) => (
          <details key={e.slug} className="card p-3" data-testid="glossary-edit" data-slug={e.slug} data-hidden={e.hidden ? "1" : "0"}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{e.term}</span>
              <span className="text-xs text-ink-3">{e.heading}</span>
              {e.hidden ? <span className="badge">hidden</span> : null}
              {e.edited ? <span className="badge">edited</span> : null}
              {e.added ? <span className="badge">added</span> : null}
            </summary>
            <form action={saveGlossaryEntryAction} className="mt-3 space-y-2">
              <input type="hidden" name="slug" value={e.slug} />
              <Field label="Word">
                <input className="field" name="term" defaultValue={e.term} maxLength={GLOSSARY_MAX.term} required />
              </Field>
              <Field label="Meaning">
                <textarea className="field" name="meaning" rows={3} defaultValue={e.meaning} maxLength={GLOSSARY_MAX.meaning} required data-testid="glossary-meaning" />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <select className="field w-auto" name="heading" defaultValue={e.heading} aria-label="Under">
                  {GLOSSARY_HEADINGS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="hidden" defaultChecked={e.hidden} data-testid="glossary-hide" /> Hide from members
                </label>
                <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…">
                  Save
                </SubmitButton>
              </div>
            </form>
            {e.edited || e.added ? (
              <form action={resetGlossaryEntryAction} className="mt-2">
                <input type="hidden" name="slug" value={e.slug} />
                <SubmitButton className="text-xs text-ink-3 underline" pendingText="…">
                  {e.added ? "Remove this word" : "Back to the original words"}
                </SubmitButton>
              </form>
            ) : null}
          </details>
        ))}
      </div>
    </>
  );
}
