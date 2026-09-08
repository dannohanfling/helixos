import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { LESSONS, lessonParagraphs, mentionsReframes } from "@/lib/engine/socrates";
import { RichText } from "@/components/rich-text";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Socrates Domain" };

const LINKS = [
  { href: "/socrates/questions", label: "Question library" },
  { href: "/socrates/reframes", label: "Reframe library" },
  { href: "/socrates/scripts", label: "Scripts" },
];

/** The seven lessons, in order. Lessons, not tasks: nothing here is ticked, scored or counted. */
export default async function FoundationsPage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        title="Socrates Domain"
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>The Foundations · 7 lessons</span>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="underline">
                {l.label}
              </Link>
            ))}
          </span>
        }
      />
      <ol className="mb-6 grid gap-1 text-sm sm:grid-cols-2" data-testid="lesson-index">
        {LESSONS.map((l) => (
          <li key={l.order}>
            <a href={`#lesson-${l.order}`} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
              <span className="w-5 text-right tabular text-ink-3">{l.order}.</span>
              <span className="font-medium">{l.topic}</span>
              <span className="text-xs text-ink-3">{l.section}</span>
            </a>
          </li>
        ))}
      </ol>
      <div className="space-y-6">
        {LESSONS.map((l) => (
          <Card key={l.order} id={`lesson-${l.order}`} title={<span className="flex items-center gap-2"><span className="text-ink-3">{l.order}.</span>{l.topic}</span>} action={<Badge tone="neutral">{l.section}</Badge>}>
            <article data-testid="lesson" data-order={l.order}>
              <p className="mb-4 text-base italic text-ink-2">{l.subtitle}</p>
              <RichText paragraphs={lessonParagraphs(l.body)} className="text-[15px] leading-relaxed" />
              {mentionsReframes(l.body) ? (
                <p className="mt-3 text-sm">
                  <Link href="/socrates/reframes" className="underline">Reframe library →</Link>
                </p>
              ) : null}
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-surface-2 p-4" data-testid="why-it-matters">
                  <div className="label">Why it matters</div>
                  <p className="mt-1 text-sm leading-relaxed">{l.whyItMatters}</p>
                </div>
                <div className="rounded-xl border-l-4 border-accent bg-accent-soft p-4" data-testid="sounds-like">
                  <div className="label">Sounds like</div>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{l.soundsLike}</p>
                </div>
              </div>
            </article>
          </Card>
        ))}
      </div>
    </>
  );
}
