import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { createScriptAction } from "@/lib/actions/socrates";
import { SCRIPT_TYPES, progress } from "@/lib/engine/socrates";
import { Badge, Card, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Scripts" };

export default async function ScriptsPage() {
  const v = await requireViewer();
  const scripts = await db.query.socratesScripts.findMany({ where: eq(schema.socratesScripts.userId, v.user.id), orderBy: desc(schema.socratesScripts.updatedAt) });
  return (
    <>
      <PageHeader title="Scripts" subtitle="Seven CLARITY beats. Pick from the library or write your own at each one." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card title="New script">
          <form action={createScriptAction} className="space-y-3" data-testid="new-script">
            <Field label="Name">
              <input className="field" name="name" required />
            </Field>
            <Field label="Script type" hint="Filters the question library to what fits this kind of conversation.">
              <select className="field" name="scriptType" defaultValue={SCRIPT_TYPES[0]}>
                {SCRIPT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <button className="btn btn-primary" type="submit">Start</button>
          </form>
        </Card>
        <Card title="Your scripts">
          {scripts.length ? (
            <ul className="divide-y" data-testid="script-list">
              {scripts.map((s) => {
                const p = progress(s.beats);
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Link href={`/socrates/scripts/${s.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{s.name}</Link>
                    <Badge>{s.scriptType}</Badge>
                    <Badge tone={p.complete ? "good" : "accent"}>{p.done} of {p.total}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-ink-3">No scripts yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
