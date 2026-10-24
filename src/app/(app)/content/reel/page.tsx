/**
 * Reel to Post, PR A (H-1948, plan H-1953): New from a reel. The member pastes the reel's transcript (or describes what's on
 * screen when it has no talking), picks a keyword, and Create post writes the package as a ladder draft: hooks, caption, 5
 * rungs, cover frame, on-screen text and the flags to check before posting. Transcribing on the device comes in PR B.
 */
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { createReelAction } from "@/lib/actions/ladders";
import { Card, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { AiFormStatus } from "@/components/ai-status";
import { targetWords } from "@/lib/engine/ladder";

export const metadata = { title: "New from a reel" };

export default async function NewFromReelPage({ searchParams }: { searchParams: Promise<{ reel?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const { reel } = await searchParams;
  const profile = await db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, v.workspace.id), eq(schema.ladderProfiles.userId, v.user.id)) });
  const keywords = profile?.keywords.filter((k) => k.keyword) ?? [];
  const ai = await hasAiKey();
  return (
    <>
      <PageHeader title="New from a reel" subtitle="Your reel's words in, a ready-to-post package out: hooks, caption, 5 comment rungs, a cover frame and what to check first." action={<Link href="/content" className="btn btn-ghost btn-sm">← Content</Link>} />
      <div className="mx-auto max-w-2xl">
        <Card title="Your reel">
          {reel === "empty" ? (
            <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" role="alert" data-testid="reel-empty">
              Paste the transcript, or describe what&apos;s on screen, first.
            </p>
          ) : null}
          {!profile?.productName ? (
            <p className="mb-3 rounded-lg bg-warn-soft p-2 text-xs">
              The package is written from your facts: product, keywords, what you may claim. <Link href="/content/ladders/profile" className="underline">Fill them in once</Link> and every reel uses them.
            </p>
          ) : null}
          <form action={createReelAction} className="grid gap-3" data-testid="reel-form">
            <Field label="Transcript" hint="Paste what you say in the reel. No talking, only music? Describe what's on screen or what you're teaching instead.">
              <textarea className="field" name="transcript" rows={10} required data-testid="reel-transcript-input" placeholder="I used to spend Sunday afternoons planning every meal for the week…" />
            </Field>
            <Field label="Keyword (optional)" hint="Goes in the last rung only, never the caption.">
              <select className="field" name="keyword" defaultValue="SAID" data-testid="reel-keyword">
                <option value="SAID">The one I say on camera, if it&apos;s on my facts</option>
                {keywords.map((k) => (
                  <option key={k.keyword} value={k.keyword}>
                    {k.keyword}: fetches {targetWords(k)}
                  </option>
                ))}
                <option value="NONE">No keyword, end on a question</option>
              </select>
            </Field>
            <Field label="What it's about (optional)" hint="A few words for your list. Blank: taken from your first sentence.">
              <input className="field" name="topic" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton className="btn btn-accent min-h-11!" pendingText="Writing your post…" data-testid="reel-create">
                Create post
              </SubmitButton>
              <AiFormStatus feature="ladder" enabled={ai} />
              {!ai ? <span className="text-xs text-ink-3">No AI key connected: you get the package&apos;s shape with every blank marked, and the checks on your transcript.</span> : null}
            </div>
            <p className="text-xs text-ink-3">Numbers, prices and people&apos;s names you say on camera stay out of the copy unless they&apos;re in your verified stats or approved proof; you&apos;ll see each one listed to check.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
