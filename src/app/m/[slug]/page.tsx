import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { publicUrlFor } from "@/lib/engine/storage-policy";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const m = await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.slug, slug) });
  return m && m.formats.page ? m : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const m = await load(slug);
  return m ? { title: m.title, description: m.promise, robots: { index: false } } : { title: "Not found" };
}

/**
 * The hosted page: the magnet itself, public, no session, nothing read about the reader. Only the content the client wrote
 * or approved; the PDF and the uploaded file link out when they exist. Off when the page format is off.
 */
export default async function MagnetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await load(slug);
  if (!m) notFound();
  const tick = m.type === "checklist" || m.type === "audit";
  const pdf = m.formats.pdf && m.pdfKey ? publicUrlFor(m.pdfKey) : null;
  const file = m.fileKey ? publicUrlFor(m.fileKey) : null;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10" data-testid="magnet-page">
      <div className="mb-6 h-2 rounded bg-accent" aria-hidden="true" />
      <h1 className="text-3xl font-bold">{m.title}</h1>
      {m.promise ? <p className="mt-2 text-lg text-ink-2">{m.promise}</p> : null}
      {m.audience ? <p className="mt-1 text-sm text-ink-3">For {m.audience}</p> : null}
      {m.content.intro ? <p className="mt-6 whitespace-pre-wrap">{m.content.intro}</p> : null}
      {m.content.sections.map((s, i) => (
        <section key={i} className="mt-8">
          <h2 className="text-xl font-semibold">{s.heading}</h2>
          {s.why ? <p className="mt-1 text-sm"><span className="font-medium">Why:</span> {s.why}</p> : null}
          {s.how ? <p className="mt-1 text-sm"><span className="font-medium">How:</span> {s.how}</p> : null}
          {s.items.length ? (
            <ul className="mt-2 space-y-1">
              {s.items.map((it, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden="true">{tick ? "☐" : "•"}</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {m.content.closing ? <p className="mt-8 whitespace-pre-wrap">{m.content.closing}</p> : null}
      {pdf || file ? (
        <div className="mt-8 flex flex-wrap gap-2">
          {pdf ? <a className="btn btn-primary" href={pdf} data-testid="magnet-pdf-link">Download the PDF</a> : null}
          {file ? <a className="btn btn-soft" href={file} data-testid="magnet-file-link">{m.fileName ?? "Download"}</a> : null}
        </div>
      ) : null}
    </main>
  );
}
