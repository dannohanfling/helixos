/**
 * Reel to Post (H-1948, plan H-1953): the reel's own parts on its ladder page, above the fields every ladder has. The
 * "Before you post" flags first, then the three hooks (pick one; the caption's first line follows), the on-screen text and
 * the cover frame, each with Copy, and Change a part: new words or an instruction for the writer, the checks run again.
 */
import { reelPartAction } from "@/lib/actions/ladders";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { Card, Disclosure } from "@/components/ui";
import { REEL_FLAG_LABELS, type ReelFlagKind } from "@/lib/engine/reel";
import { headlineParts } from "@/lib/engine/ladder";

type Props = {
  id: string;
  hookOptions: { text: string; pick: boolean }[];
  onScreen: string | null;
  cover: string;
  flags: { kind: string; text: string; from: string }[];
  transcript: string | null;
  rungs: number;
  ai: boolean;
  note: string | null;
};

export function ReelPackage({ id, hookOptions, onScreen, cover, flags, transcript, rungs, ai, note }: Props) {
  const coverText = headlineParts(cover).lines.join("\n");
  return (
    <Card id="reel" title="Your reel package" action={<span className="text-xs text-ink-3">From your reel&apos;s words</span>}>
      <div className="space-y-4" data-testid="reel-package">
        {note ? (
          <p className="rounded-lg bg-surface-2 p-2 text-xs" data-testid="reel-note" role="status">
            {note === "saved" ? "Saved. The checks ran again." : note}
          </p>
        ) : null}
        <section>
          <h3 className="text-sm font-semibold">Before you post</h3>
          {flags.length ? (
            <ul className="mt-1 space-y-1 text-sm">
              {flags.map((f, i) => (
                <li key={i} className="rounded-lg border border-warn bg-warn-soft p-2" data-testid="reel-flag" data-kind={f.kind}>
                  <b>{REEL_FLAG_LABELS[f.kind as ReelFlagKind] ?? "Check"}.</b> {f.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink-2" data-testid="reel-no-flags">
              Nothing to check: no unproven numbers, prices or names came through.
            </p>
          )}
        </section>
        <section>
          <h3 className="text-sm font-semibold">Hooks</h3>
          <ul className="mt-1 space-y-1">
            {hookOptions.map((h, i) => (
              <li key={i} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${h.pick ? "border-accent bg-accent-soft" : ""}`} data-testid="reel-hook" data-pick={h.pick ? "1" : undefined}>
                <span className="min-w-0 flex-1 [overflow-wrap:break-word]">{h.text}</span>
                <CopyButton text={h.text} label="Copy" className="btn btn-ghost btn-xs" />
                {h.pick ? (
                  <span className="text-xs font-semibold text-accent">The pick</span>
                ) : (
                  <form action={reelPartAction}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="part" value="hook" />
                    <input type="hidden" name="pick" value={i} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Using…" data-testid="reel-hook-use">
                      Use this one
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">On-screen text, first seconds</h3>
            <div className="mt-1 flex items-center gap-2">
              <p className="min-w-0 flex-1 rounded-lg bg-surface-2 p-2 text-sm font-semibold" data-testid="reel-onscreen">
                {onScreen || "None yet"}
              </p>
              {onScreen ? <CopyButton text={onScreen} label="Copy" className="btn btn-ghost btn-xs" /> : null}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Cover frame</h3>
            <div className="mt-1 flex items-center gap-2">
              <p className="min-w-0 flex-1 whitespace-pre-line rounded-lg bg-surface-2 p-2 text-sm font-semibold uppercase" data-testid="reel-cover">
                {coverText || "None yet"}
              </p>
              {coverText ? <CopyButton text={coverText} label="Copy" className="btn btn-ghost btn-xs" /> : null}
            </div>
          </div>
        </section>
        <Disclosure summary={<span className="text-sm underline" data-testid="reel-change-open">Change a part</span>}>
          <form action={reelPartAction} className="mt-2 grid gap-2" data-testid="reel-change">
            <input type="hidden" name="id" value={id} />
            <label className="grid gap-1 text-sm">
              Which part
              <select className="field" name="part" defaultValue="body">
                <option value="body">The caption</option>
                <option value="headline">The cover frame</option>
                <option value="onscreen">The on-screen text (new words only)</option>
                {Array.from({ length: rungs }, (_, i) => (
                  <option key={i} value={`rung:${i + 1}`}>
                    Rung {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              New words
              <textarea className="field" name="text" rows={3} placeholder="Type the new version, or leave this blank and say what to change below" />
            </label>
            {ai ? (
              <label className="grid gap-1 text-sm">
                Or tell the writer what to change
                <input className="field" name="instruction" placeholder="Shorter, and end on the question about Sunday" />
              </label>
            ) : null}
            <div>
              <SubmitButton className="btn btn-soft btn-sm min-h-11!" pendingText="Changing…" data-testid="reel-change-save">
                Save the change
              </SubmitButton>
            </div>
          </form>
        </Disclosure>
        {transcript ? (
          <Disclosure summary={<span className="text-xs text-ink-3 underline">The transcript it was written from</span>}>
            <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-2 p-2 text-xs text-ink-2" data-testid="reel-transcript">
              {transcript}
            </p>
          </Disclosure>
        ) : null}
      </div>
    </Card>
  );
}
