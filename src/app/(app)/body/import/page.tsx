import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { HumanosHeader } from "@/components/body/humanos-header";
import { requireBodyEnabled } from "@/lib/queries/body";
import { HistoryForm } from "./history-form";

export const metadata = { title: "HumanOS · From Airtable" };
// A base of a few hundred days reads several pages from Airtable; the dry run and Approve both run under this.
export const maxDuration = 300;

/**
 * Bring a member's HumanOS history over from their Airtable base (B5, rev 237 phase 7): weigh-ins, routines and workouts,
 * nothing else. Member-run, under their own Body: paste the base id and a read-only token, see the dry run, then Approve
 * writes it. The token stays in the form for that run only. Re-running adds nothing twice.
 */
export default async function BodyImportPage({ searchParams }: { searchParams: Promise<{ done?: string; at?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;

  return (
    <>
      <HumanosHeader
        title="From Airtable"
        subtitle="Your HumanOS base into HelixOS: weigh-ins, routines and workouts. Nothing is written until you press Approve on the dry run."
        gear={false}
        action={
          <Link href="/body/weight" className="btn btn-ghost btn-sm">
            ← Weigh-ins
          </Link>
        }
      />
      {sp.done ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="history-done">
          Brought over: {Number(sp.done).toLocaleString()} rows written. See them on{" "}
          <Link href="/body/weight" className="underline">
            Weigh-ins
          </Link>{" "}
          and{" "}
          <Link href="/body/training" className="underline">
            Training
          </Link>
          .
        </p>
      ) : null}
      {/* A fresh form after each import: no old dry run left on screen. */}
      <HistoryForm key={sp.at ?? "form"} />
    </>
  );
}
