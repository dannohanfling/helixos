import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { fathomKeyFor, listRecordings } from "@/lib/fathom";
import { harvestRecordingAction } from "@/lib/actions/fathom";
import { AiFormStatus } from "@/components/ai-status";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Harvest from Fathom" };

/** List → the client picks one → it is read → drafts come back for review. No recording is read until a person points at it here. */
export default async function HarvestPage({ searchParams }: { searchParams: Promise<{ cursor?: string; recording?: string; found?: string; dropped?: string; already?: string; truncated?: string; error?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const fk = await fathomKeyFor(v.workspace.id, v.user.id);
  const ai = await hasAiKey();
  const list = fk ? await listRecordings(v.user.id, fk.key, sp.cursor ?? null) : null;
  const drafts = sp.recording ? await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.sourceRecordingId, sp.recording)) }) : [];
  const error = sp.error === "nokey" ? "Fathom isn't connected." : sp.error === "noai" ? "Reading a recording needs your own Anthropic or OpenAI key." : sp.error === "ai" ? "The AI call didn't come back. Check your AI key on Settings (it may be past today's cap) and try again." : sp.error === "norecording" ? "Pick a recording first." : (sp.error ?? null);
  return (
    <>
      <PageHeader title="Harvest from Fathom" subtitle={<Link href="/proof" className="hover:underline">← Proof Bank</Link>} />
      <p className="mb-4 text-sm text-ink-2">Only the recording you pick is read, and only when you press the button. Every quote comes back word for word, with who said it and a link to the moment, as a draft for you to review.</p>
      {!fk ? (
        <Card>
          <p className="text-sm" data-testid="harvest-needs-key">
            Fathom isn&apos;t connected yet. <Link href="/settings#fathom" className="underline">Paste your Fathom API key in Settings</Link> and your recordings appear here.
          </p>
        </Card>
      ) : null}
      {fk && !ai ? (
        <Card className="mb-4">
          <p className="text-sm" data-testid="harvest-needs-ai">
            Reading a recording needs your own Anthropic or OpenAI key. <Link href="/settings#ai" className="underline">Connect it in Settings</Link>.
          </p>
        </Card>
      ) : null}
      {error ? <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="harvest-error">{error}</p> : null}
      {sp.found !== undefined ? (
        <Card className="mb-4" title="What came back">
          <p className="text-sm" data-testid="harvest-result">
            {sp.found} new {sp.found === "1" ? "quote" : "quotes"} saved as drafts{Number(sp.already) > 0 ? `, ${sp.already} already in the bank` : ""}
            {Number(sp.dropped) > 0 ? `, ${sp.dropped} dropped because ${sp.dropped === "1" ? "it was" : "they were"} not word for word in the transcript` : ""}.
            {sp.truncated ? " This call was long; only the first part was read." : ""}
          </p>
          {drafts.length ? (
            <ul className="mt-2 divide-y text-sm" data-testid="harvest-drafts">
              {drafts.map((d) => (
                <li key={d.id} className="flex items-start gap-3 py-2">
                  <Link href={`/proof/${d.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block font-medium">{d.who}</span>
                    <span className="block text-ink-2">“{d.quote}”</span>
                  </Link>
                  <Badge tone={d.status === "approved" ? "good" : "neutral"}>{d.status}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
      {list ? (
        list.ok ? (
          <Card title="Your recordings" action={<span className="text-xs text-ink-3">titles and dates only</span>}>
            {list.data.recordings.length ? (
              <ul className="divide-y" data-testid="recording-list">
                {list.data.recordings.map((r) => (
                  <li key={r.recordingId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" data-testid="recording" data-recording-id={r.recordingId}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.title}</span>
                      <span className="block text-xs text-ink-3">
                        {r.recordedAt ? formatDateTime(r.recordedAt, v.tz) : ""}
                        {r.invitees.length ? ` · ${r.invitees.join(", ")}` : ""}
                      </span>
                    </span>
                    <form action={harvestRecordingAction} className="flex items-center gap-2">
                      <input type="hidden" name="recordingId" value={r.recordingId} />
                      <input type="hidden" name="title" value={r.title} />
                      <input type="hidden" name="url" value={r.url} />
                      <input type="hidden" name="recordedAt" value={r.recordedAt ?? ""} />
                      <button className="btn btn-soft btn-sm" type="submit" disabled={!ai} title={ai ? undefined : "Connect your AI key in Settings"} data-testid="read-recording">
                        Read this recording
                      </button>
                      <AiFormStatus feature="harvest" enabled={ai} />
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-ink-3">No recordings in your Fathom yet.</p>
            )}
            {list.data.nextCursor ? (
              <p className="mt-3 text-sm">
                <Link href={`/proof/harvest?cursor=${encodeURIComponent(list.data.nextCursor)}`} className="underline">Older recordings →</Link>
              </p>
            ) : null}
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-danger" data-testid="harvest-error">{list.error}</p>
          </Card>
        )
      ) : null}
    </>
  );
}
