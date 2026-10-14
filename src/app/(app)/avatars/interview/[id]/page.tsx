import Link from "next/link";
import { AVATAR_FIELDS, type AvatarField } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { ownInterview } from "@/lib/avatar-interview";
import { answerInterviewAction, saveInterviewAction, stopInterviewAction } from "@/lib/actions/avatar-interview";
import { AVATAR_FIELD_INFO } from "@/lib/engine/avatars";
import { draftSummary, fieldsToAsk, openTurn, progressWords } from "@/lib/engine/avatar-interview";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { ItemGone } from "@/components/item-gone";

export const metadata = { title: "Avatar interview" };

/**
 * Avatars by interview (rev 639): one question at a time, then the draft in the member's own words with Keep, Edit or Skip on
 * each field. Nothing reaches the avatar until Save avatar, and only the fields kept or edited.
 */
export default async function InterviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const row = await ownInterview(v, id);
  if (!row) return <ItemGone what="This interview" href="/avatars" list="your avatars" />;
  const avatar = row.avatarId ? await db.query.avatars.findFirst({ where: and(eq(schema.avatars.workspaceId, v.workspace.id), eq(schema.avatars.userId, v.user.id), eq(schema.avatars.id, row.avatarId)) }) : null;
  const fields: AvatarField[] = row.avatarId ? [...new Set([...row.turns.map((t) => t.field), ...fieldsToAsk(avatar ?? null)])] : [...AVATAR_FIELDS];
  const open = openTurn(row.turns);
  const answered = row.turns.filter((t) => t.answer !== null);
  return (
    <>
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="interview-error">
          {sp.error}
        </p>
      ) : null}
      <PageHeader
        title={avatar ? `Interview: ${avatar.name}` : "Interview: a new avatar"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={avatar ? `/avatars/${avatar.id}` : "/avatars"} className="hover:underline">
              ← {avatar ? avatar.name : "Avatars"}
            </Link>
            {row.status === "open" ? <span className="text-xs text-ink-3" data-testid="interview-progress">{progressWords(row.turns, fields)}</span> : <Badge>{row.status}</Badge>}
          </span>
        }
      />

      {row.status === "open" ? (
        <Card title={open ? (open.followUp ? "One more on that" : AVATAR_FIELD_INFO[open.field].label) : "Your answers are in"}>
          {open ? (
            <>
              <p className="mb-3 text-lg" data-testid="interview-question">{open.question}</p>
              <form action={answerInterviewAction} className="space-y-3">
                <input type="hidden" name="id" value={row.id} />
                <textarea className="field" name="answer" rows={4} placeholder="Type, or tap your keyboard's microphone and say it." data-testid="interview-answer" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton className="btn btn-primary" pendingText="Thinking…" data-testid="interview-submit">
                    Answer
                  </SubmitButton>
                  <SubmitButton className="btn btn-ghost" name="enough" value="1" pendingText="Drafting…" data-testid="interview-enough">
                    That&apos;s enough, show me
                  </SubmitButton>
                </div>
              </form>
              <form action={answerInterviewAction} className="mt-2">
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="answer" value="" />
                <SubmitButton className="btn btn-ghost btn-sm" pendingText="Skipping…" data-testid="interview-skip">
                  Skip this one
                </SubmitButton>
              </form>
            </>
          ) : (
            <form action={answerInterviewAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="enough" value="1" />
              <SubmitButton className="btn btn-primary" pendingText="Drafting…" data-testid="interview-enough">
                That&apos;s enough, show me
              </SubmitButton>
            </form>
          )}
        </Card>
      ) : null}

      {row.status === "draft" && row.draft ? (
        <form action={saveInterviewAction} className="space-y-4" data-testid="interview-draft">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-ink-2" data-testid="interview-summary">
            {draftSummary(row.draft, fields)}. Keep, edit or skip each one; only what you keep is saved.
          </p>
          {!avatar ? (
            <Field label="Name this avatar">
              <input className="field" name="name" defaultValue={row.draft.name ?? ""} maxLength={80} required data-testid="interview-name" />
            </Field>
          ) : null}
          {fields.map((f) => {
            const d = row.draft!.fields[f];
            const from = (d?.from ?? []).map((n) => row.turns[n - 1]).filter(Boolean);
            return (
              <Card key={f} title={AVATAR_FIELD_INFO[f].label}>
                {d ? (
                  <div className="space-y-2" data-testid={`interview-field-${f}`}>
                    <textarea className="field" name={`text_${f}`} rows={Math.min(6, d.text.split("\n").length + 1)} defaultValue={d.text} />
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      {(["keep", "skip"] as const).map((k) => (
                        <label key={k} className="flex items-center gap-1">
                          <input type="radio" name={`keep_${f}`} value={k} defaultChecked={k === "keep"} data-testid={`interview-${k}-${f}`} /> {k === "keep" ? "Keep" : "Skip"}
                        </label>
                      ))}
                      <span className="text-xs text-ink-3">Edit the words in the box before you keep them.</span>
                    </div>
                    {from.length ? (
                      <p className="text-xs text-ink-3">
                        From your answer: {from.map((t) => `“${(t.answer ?? "").slice(0, 200)}”`).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3" data-testid={`interview-notcovered-${f}`}>
                    Not covered: nothing you said answers this one.
                  </p>
                )}
              </Card>
            );
          })}
          {row.draft.dropped.length ? (
            <Card title="Left out">
              <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="interview-dropped">
                {row.draft.dropped.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          <SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="interview-save">
            Save avatar
          </SubmitButton>
        </form>
      ) : null}

      {answered.length ? (
        <Card title="Your answers" className="mt-4">
          <ol className="space-y-3 text-sm" data-testid="interview-answers">
            {answered.map((t, i) => (
              <li key={i}>
                <p className="text-ink-3">{t.question}</p>
                <p>{t.answer ? t.answer : <span className="text-ink-3">Skipped</span>}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {row.status === "open" || row.status === "draft" ? (
        <form action={stopInterviewAction} className="mt-4">
          <input type="hidden" name="id" value={row.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Stopping…" data-testid="interview-stop">
            Stop this interview
          </SubmitButton>
        </form>
      ) : null}
    </>
  );
}
