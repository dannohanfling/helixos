import Link from "next/link";
import type { Metadata } from "next";
import { ownTitle } from "@/lib/page-title";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { frameworkBySlug } from "@/lib/frameworks";
import { frameworkToContentAction } from "@/lib/actions/frameworks";
import { frameworkPost, frameworkReel, frameworkTraining } from "@/lib/engine/frameworks";
import { momentOf } from "@/lib/engine/teaching";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, PageHeader, Tabs } from "@/components/ui";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";
import { SubmitButton } from "@/components/submit-button";
import { ItemGone } from "@/components/item-gone";

/**
 * One framework (H-1262, plan H-1270), in a principle's shape: the framework (idea, steps, when, mistakes), its story (the
 * story, Danno's words, the source call), and content from it. Members see published ones; the coach sees drafts too, marked.
 */
const TABS = [
  { key: "framework", label: "The framework" },
  { key: "story", label: "Story" },
  { key: "content", label: "Make content" },
] as const;

function Block({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <div className="label">{label}</div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{text}</p>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return ownTitle(async () => {
    const v = await requireViewer();
    return (await frameworkBySlug(v.workspace.id, decodeURIComponent(slug), v.role === "coach" && !v.switchedInto))?.name;
  }, "Doctrine");
}

export default async function FrameworkPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ai = await hasAiKey();
  const v = await requireViewer();
  const { slug } = await params;
  const sp = await searchParams;
  const coach = v.role === "coach" && !v.switchedInto;
  const f = await frameworkBySlug(v.workspace.id, decodeURIComponent(slug), coach);
  if (!f) return <ItemGone what="This framework" href="/doctrine" list="your doctrine" />;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "framework";
  const href = (t: string) => `/doctrine/frameworks/${encodeURIComponent(f.slug)}?tab=${t}`;
  const firstName = v.user.name.split(" ")[0];
  const post = frameworkPost(f, firstName);
  const reel = frameworkReel(f);
  const training = frameworkTraining(f);
  return (
    <>
      <PageHeader
        title={`🧩 ${f.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2" data-testid="framework-head">
            <Link href="/doctrine" className="hover:underline">← Doctrine</Link>
            <span>{[f.pillar, f.rank].filter(Boolean).join(" · ")}</span>
            {f.borrowedFrom ? <span className="text-ink-3" data-testid="framework-credit">After {f.borrowedFrom}</span> : null}
            {f.status !== "published" ? <Badge tone="warn">Draft, only you see it</Badge> : null}
            {f.hasPrice ? <Badge tone="danger">Names a price</Badge> : null}
          </span>
        }
      />
      <Tabs items={TABS.map((t) => ({ key: t.key, label: t.label, href: href(t.key) }))} current={tab} />
      {tab === "framework" ? (
        <Card className="mt-4">
          <div className="space-y-4" data-testid="framework-body">
            <Block label="The idea" text={f.idea} />
            <div>
              <div className="label">The steps</div>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed" data-testid="framework-steps">
                {f.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            <Block label="When to use it" text={f.whenToUse} />
            <Block label="Common mistakes" text={f.mistakes} />
          </div>
        </Card>
      ) : null}
      {tab === "story" ? (
        <Card className="mt-4">
          <div className="space-y-5" data-testid="framework-story">
            <Block label="Story or analogy" text={f.story} />
            {f.exactWords ? (
              <div>
                <div className="label">In the coach&apos;s words</div>
                <blockquote className="border-l-2 border-accent pl-3 text-sm italic leading-relaxed" data-testid="framework-words">{f.exactWords}</blockquote>
              </div>
            ) : null}
            {f.sourceCall || f.sourceDate || f.fathomUrl ? (
              <div>
                <div className="label">Where it was taught</div>
                {f.fathomUrl ? (
                  <a href={f.fathomUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline" data-testid="framework-source">
                    {[f.sourceCall, f.sourceDate].filter(Boolean).join(", ") || "The call"}{momentOf(f.fathomUrl) ? ` at ${momentOf(f.fathomUrl)}` : ""} ↗
                  </a>
                ) : (
                  <p className="text-sm" data-testid="framework-source">{[f.sourceCall, f.sourceDate].filter(Boolean).join(", ")}</p>
                )}
              </div>
            ) : null}
            {!f.story && !f.exactWords && !f.sourceCall && !f.fathomUrl ? <p className="text-sm text-ink-3">No story on this one yet.</p> : null}
            {coach && (f.evolution || f.contentAngles || f.rawStatus) ? (
              <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2" data-testid="framework-coach-notes">
                <div className="label">Only you see this</div>
                {f.contentAngles ? <p><b>Content angles:</b> {f.contentAngles}</p> : null}
                {f.evolution ? <p><b>Evolution:</b> {f.evolution}</p> : null}
                {f.rawStatus ? <p><b>Status in the file:</b> {f.rawStatus}</p> : null}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
      {tab === "content" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3" data-testid="framework-content">
          {[
            { kind: "post", title: "✍️ Post", text: post, why: "The framework as a post for your group or profile, steps and all." },
            { kind: "reel", title: "🎬 Reel script", text: reel, why: "Sixty seconds. Hook, the mistake, the steps, proof, CTA." },
            { kind: "training", title: "🎤 10-minute training", text: training, why: "Teach it live or on a call. Five beats, the steps in the middle." },
          ].map((c) => (
            <Card key={c.kind} title={c.title} action={<CopyButton text={c.text} label="Copy" className="btn btn-ghost btn-xs" />}>
              <p className="mb-2 text-xs text-ink-3">{c.why}</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{c.text}</pre>
              <form action={frameworkToContentAction} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="slug" value={f.slug} />
                <input type="hidden" name="kind" value={c.kind} />
                <SubmitButton className="btn btn-accent btn-sm" pendingText="Creating…" data-testid={`framework-make-${c.kind}`}>Turn into content</SubmitButton>
                {ai ? (
                  <SubmitButton className="btn btn-soft btn-sm" name="ai" value="1" pendingText="Drafting…">✨ With Claude</SubmitButton>
                ) : null}
                <AiFormStatus feature="principle_content" enabled={ai} onlyWhen={{ field: "ai", value: "1" }} />
                <AiPromise enabled={ai}>With Claude rewrites {c.kind === "post" ? "this post" : c.kind === "reel" ? "this 60-second reel script" : "this 10-minute training outline"} in your voice, the steps in their order, and saves it to your content board.</AiPromise>
              </form>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
