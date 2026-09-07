import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { principleToContentAction } from "@/lib/actions/doctrine";
import { CopyButton } from "@/components/copy-button";
import { Card, Disclosure, PageHeader, Tabs } from "@/components/ui";
import { principlePost, principleReel, principleTraining } from "@/lib/engine/doctrine";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";

const TABS = [
  { key: "doctrine", label: "Doctrine" },
  { key: "stories", label: "Stories" },
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

export default async function PrinciplePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ai = await hasAiKey();
  const v = await requireViewer();
  const { code } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(code);
  const [p, all] = await Promise.all([db.query.principles.findFirst({ where: eq(schema.principles.code, decoded) }), db.query.principles.findMany({ orderBy: asc(schema.principles.order) })]);
  if (!p) notFound();
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "doctrine";
  const idx = all.findIndex((x) => x.code === p.code && x.name === p.name);
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const href = (t: string) => `/doctrine/${encodeURIComponent(p.code)}?tab=${t}`;
  const firstName = v.user.name.split(" ")[0];
  const post = principlePost(p, firstName);
  const reel = principleReel(p);
  const training = principleTraining(p);
  const stories: { label: string; text: string | null }[] = [
    { label: "The Greek story", text: p.greekStory },
    { label: "The Stoic angle", text: p.stoicStory },
    { label: "The business case", text: p.businessCase },
    { label: "A public figure", text: p.publicFigureStory },
    { label: "The science", text: p.scienceAnchor },
    { label: "Personal story", text: p.personalStory },
    { label: "Client story", text: p.clientStory },
  ];
  return (
    <>
      <PageHeader
        title={`${p.symbol ?? "Ω"} ${p.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/doctrine" className="hover:underline">← All principles</Link>
            <span>{p.order ? p.code : ""} {p.greekName ? `· ${p.greekName}` : ""} {p.pillar ? `· ${p.pillar}` : ""} {p.phase ? `· ${p.phase}` : ""}</span>
          </span>
        }
        action={
          <div className="flex gap-2 text-sm">
            {prev ? <Link href={`/doctrine/${encodeURIComponent(prev.code)}`} className="btn btn-ghost btn-sm">←</Link> : null}
            {next ? <Link href={`/doctrine/${encodeURIComponent(next.code)}`} className="btn btn-ghost btn-sm">→</Link> : null}
          </div>
        }
      />
      <Tabs items={TABS.map((t) => ({ key: t.key, label: t.label, href: href(t.key) }))} current={tab} />
      {tab === "doctrine" ? (
        <Card className="mt-4">
          <div className="space-y-4">
            <Block label="In one line" text={p.summary} />
            <Block label="The doctrine" text={p.doctrine} />
            <Block label="How it sells" text={p.salesPositioning} />
            {p.hookAngle ? <Block label="Hook angle" text={p.hookAngle} /> : null}
            {!p.summary && !p.doctrine ? <Block label="The story" text={p.greekStory ?? p.businessCase} /> : null}
          </div>
        </Card>
      ) : null}
      {tab === "stories" ? (
        <Card className="mt-4">
          <div className="space-y-5">{stories.map((s) => <Block key={s.label} label={s.label} text={s.text} />)}</div>
        </Card>
      ) : null}
      {tab === "content" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {[
            { kind: "post", title: "✍️ Post", text: post, why: "A belief-shifting post for your group or profile." },
            { kind: "reel", title: "🎬 Reel script", text: reel, why: "Sixty seconds. Hook, problem, proof, shift, CTA." },
            { kind: "training", title: "🎤 10-minute training", text: training, why: "Teach it live or on a call. Five beats." },
          ].map((c) => (
            <Card key={c.kind} title={c.title} action={<CopyButton text={c.text} label="Copy" className="btn btn-ghost btn-xs" />}>
              <p className="mb-2 text-xs text-ink-3">{c.why}</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{c.text}</pre>
              <form action={principleToContentAction} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="code" value={p.code} />
                <input type="hidden" name="kind" value={c.kind} />
                <button className="btn btn-accent btn-sm" type="submit">Turn into content</button>
                {ai ? (
                  <button className="btn btn-soft btn-sm" type="submit" name="ai" value="1">✨ With Claude</button>
                ) : null}
                <AiFormStatus feature="principle_content" enabled={ai} onlyWhen={{ field: "ai", value: "1" }} />
                <AiPromise enabled={ai}>With Claude rewrites {c.kind === "post" ? "this post" : c.kind === "reel" ? "this 60-second reel script" : "this 10-minute training outline"} in your voice and saves it to your content board.</AiPromise>
              </form>
            </Card>
          ))}
        </div>
      ) : null}
      {p.order === 0 ? (
        <Disclosure summary={<span className="text-xs text-ink-3 underline">Why no number?</span>} className="mt-3">
          <p className="text-xs text-ink-3">This principle was added after the core fourteen. It sits outside the numbered sequence.</p>
        </Disclosure>
      ) : null}
    </>
  );
}
