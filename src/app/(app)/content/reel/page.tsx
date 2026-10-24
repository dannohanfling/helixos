/**
 * Reel to Post (H-1948, plan H-1953): New from a reel. The member chooses the reel and writes it out on their own device (PR
 * B), or pastes the transcript (or describes what's on screen when it has no talking), picks a keyword, and Create post
 * writes the package as a ladder draft: hooks, caption, 5 rungs, cover frame, on-screen text and the flags to check before
 * posting. The video goes with the post only when they attach it.
 */
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { Card, PageHeader } from "@/components/ui";
import { ReelForm } from "@/components/reel-form";
import { proofStorageConfigured } from "@/lib/proof-storage";
import { reelModelsUrl } from "@/lib/reel-models";
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
          <ReelForm
            keywords={keywords.map((k) => ({ keyword: k.keyword, label: `${k.keyword}: fetches ${targetWords(k)}` }))}
            modelsUrl={reelModelsUrl()}
            canAttach={proofStorageConfigured()}
            owner={{ workspaceId: v.workspace.id, userId: v.user.id }}
            aiStatus={<AiFormStatus feature="ladder" enabled={ai} />}
            noAiNote={!ai ? <span className="text-xs text-ink-3">No AI key connected: you get the package&apos;s shape with every blank marked, and the checks on your transcript.</span> : null}
          />
        </Card>
      </div>
    </>
  );
}
