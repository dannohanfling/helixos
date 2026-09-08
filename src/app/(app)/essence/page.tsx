import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { saveEssenceSectionAction } from "@/lib/actions/essence";
import { ESSENCE_CAP, ESSENCE_HELP, ESSENCE_SECTIONS, completion, essenceChars, roughTokens, sectionByKey, sectionFilled, type Story } from "@/lib/engine/essence";
import { essenceFor } from "@/lib/queries/essence";
import { Badge, Card, Field, PageHeader, Progress } from "@/components/ui";

export const metadata = { title: "Essence" };

/**
 * The client's brand voice as config: fourteen sections, one per step, save and return any time, nothing gated behind
 * completion. Every word is theirs. The one-line prompts under the hard fields are Danno's and appear only once supplied.
 */
export default async function EssencePage({ searchParams }: { searchParams: Promise<{ step?: string; saved?: string; over?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const data = await essenceFor(v.workspace.id, v.user.id);
  const done = completion(data);
  const chars = essenceChars(data);
  const current = sectionByKey(sp.step ?? "") ?? ESSENCE_SECTIONS.find((s) => !sectionFilled(data, s.key)) ?? ESSENCE_SECTIONS[0];
  const idx = ESSENCE_SECTIONS.findIndex((s) => s.key === current.key);
  const next = ESSENCE_SECTIONS[idx + 1] ?? null;
  const values = data[current.key] ?? {};
  const storiesField = current.fields.find((f) => f.kind === "stories");
  const stories = storiesField ? ((values[storiesField.key] as Story[] | undefined) ?? []) : [];
  const [proofs, assets] = storiesField
    ? await Promise.all([
        db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
        db.query.libraryAssets.findMany({ where: and(eq(schema.libraryAssets.userId, v.user.id), eq(schema.libraryAssets.type, "story")) }),
      ])
    : [[], []];
  const help = (field: string) => ESSENCE_HELP[`${current.key}.${field}`];
  return (
    <>
      <PageHeader
        title="Essence"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>Your voice, as the AI reads it. Every ✨ action in the app leads with this.</span>
            <Badge tone={done.empty ? "neutral" : done.filled === done.total ? "good" : "accent"}>
              <span data-testid="essence-progress">{done.filled} of {done.total} sections</span>
            </Badge>
          </span>
        }
        action={<span className="text-xs text-ink-3" data-testid="essence-size">{chars.toLocaleString()} of {ESSENCE_CAP.toLocaleString()} characters · about {roughTokens(chars).toLocaleString()} tokens on every call</span>}
      />
      <Progress value={(done.filled / done.total) * 100} tone={done.filled === done.total ? "good" : "accent"} />
      {sp.saved ? <p className="mt-3 rounded-lg bg-good-soft p-2 text-sm" data-testid="essence-saved">Saved.</p> : null}
      {sp.over ? (
        <p className="mt-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="essence-over" role="alert">
          Not saved: that would make your Essence {Number(sp.over).toLocaleString()} characters, over the {ESSENCE_CAP.toLocaleString()} limit it has to stay under. Trim this section or another.
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="The 14 sections">
          <ol className="-mx-2 divide-y" data-testid="essence-sections">
            {ESSENCE_SECTIONS.map((s, i) => {
              const filled = sectionFilled(data, s.key);
              return (
                <li key={s.key}>
                  <Link href={`/essence?step=${s.key}`} className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-surface-2 ${s.key === current.key ? "bg-accent-soft" : ""}`} data-testid="essence-section" data-section={s.key} data-filled={filled ? "1" : "0"}>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${filled ? "border-good bg-good text-white" : "border-line"}`}>{filled ? "✓" : i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
        <Card title={`${idx + 1}. ${current.title}`} action={<Badge tone={sectionFilled(data, current.key) ? "good" : "neutral"}>{sectionFilled(data, current.key) ? "filled" : "empty"}</Badge>}>
          <form action={saveEssenceSectionAction} className="space-y-4" data-testid="essence-form" data-section={current.key}>
            <input type="hidden" name="section" value={current.key} />
            {current.fields.map((f) =>
              f.kind === "stories" ? (
                <div key={f.key} className="space-y-3">
                  {[...stories, { name: "", summary: "", when_to_use: "" }].map((st, i) => (
                    <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_1fr]" data-testid="story-row">
                      <Field label="Name">
                        <input className="field" name="story_name" defaultValue={st.name} />
                      </Field>
                      <Field label="Summary">
                        <textarea className="field" name="story_summary" defaultValue={st.summary} rows={2} />
                      </Field>
                      <Field label="When to use">
                        <input className="field" name="story_when" defaultValue={st.when_to_use} />
                      </Field>
                    </div>
                  ))}
                  {proofs.length || assets.length ? (
                    <Field label="Or add one from your own bank" hint="An approved proof or a story from your story bank, added on save.">
                      <select className="field" name="story_from_bank" defaultValue="" data-testid="story-from-bank">
                        <option value="">—</option>
                        {proofs.map((p) => (
                          <option key={p.id} value={`proof:${p.id}`}>Proof: {p.name}</option>
                        ))}
                        {assets.map((a) => (
                          <option key={a.id} value={`asset:${a.id}`}>Story: {a.name}</option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <p className="text-xs text-ink-3">A row with nothing in it is dropped on save.</p>
                </div>
              ) : f.kind === "list" ? (
                <Field key={f.key} label={f.label} hint={help(f.key) ?? "One per line."}>
                  <textarea className="field" name={`${current.key}.${f.key}`} defaultValue={((values[f.key] as string[] | undefined) ?? []).join("\n")} rows={4} data-testid={`field-${f.key}`} />
                </Field>
              ) : (
                <Field key={f.key} label={f.label} hint={help(f.key)}>
                  <textarea className="field" name={`${current.key}.${f.key}`} defaultValue={(values[f.key] as string | undefined) ?? ""} rows={2} data-testid={`field-${f.key}`} />
                </Field>
              ),
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button className={next ? "btn btn-ghost" : "btn btn-accent"} type="submit">Save</button>
              {next ? (
                <button className="btn btn-accent" type="submit" name="next" value={next.key}>
                  Save and next →
                </button>
              ) : null}
              <span className="ml-auto text-xs text-ink-3">Come back any time. Nothing waits on this being finished.</span>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
