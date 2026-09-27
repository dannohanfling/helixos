import Link from "next/link";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import a client from Airtable" };
// A large base reads a few hundred pages from Airtable and writes in batches; the dry run and Approve both run under this.
export const maxDuration = 300;

type Sp = { done?: string; to?: string; at?: string };

/**
 * Import a client from Airtable (handoff 27 Sep): pick or create the client, paste each base's id and read-only token, see the
 * dry run, then Approve writes it. The tokens stay in the form for that run only: never stored, never logged, never shown back.
 * Re-running updates what an earlier run wrote instead of doubling it. Coach only; reusable for every client with a
 * HelixOS-template base.
 */
export default async function ImportPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const clients = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  const users = clients.length ? await db.query.users.findMany({ where: inArray(schema.users.id, clients.map((c) => c.userId)) }) : [];
  const options = clients.map((c) => ({ id: c.id, label: `${users.find((u) => u.id === c.userId)?.name ?? "Client"}${c.businessName ? ` · ${c.businessName}` : ""}` }));
  const done = options.find((o) => o.id === sp.to);

  return (
    <>
      <PageHeader title="Import a client from Airtable" subtitle="Their HelixOS-template base into their HelixOS: offers, pathways, Essence, stories, beliefs, frameworks, the buyer journey, tasks and groups. Nothing is written until you press Approve on the dry run." action={<Link href="/coach" className="btn btn-ghost btn-sm">Coach view</Link>} />
      {sp.done && done ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="import-done">
          Imported into {done.label}: {Number(sp.done).toLocaleString()} rows written. Nothing was sent to them.{" "}
          <Link href={`/coach/${done.id}`} className="underline">
            Their page
          </Link>{" "}
          has the reset link for when they should log in.
        </p>
      ) : null}
      {/* A fresh form after each import: no old dry run left on screen. */}
      <ImportForm key={sp.at ?? "form"} clients={options} />
    </>
  );
}
