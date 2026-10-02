import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BackfillForm } from "./backfill-form";

export const metadata = { title: "History from Airtable" };
// Several hundred rows read in pages of 100 from Airtable; the dry run and Approve both run under this.
export const maxDuration = 300;

/**
 * Past monthly feedback and Office Hours requests, from the Omnichannel Airtable base (handoff rev 441). Coach only: paste a
 * read-only token, see the dry run, then Approve writes it. The token stays in the form for that run only. Re-running adds
 * nothing twice, and a month a member already answered in HelixOS stays theirs.
 */
export default async function CoachBackfillPage({ searchParams }: { searchParams: Promise<{ done?: string; at?: string }> }) {
  await requireCoach();
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="History from Airtable"
        subtitle="Past monthly feedback and Office Hours requests. Nothing is written until you press Approve on the dry run."
        action={
          <Link href="/coach" className="btn btn-ghost btn-sm">
            Back
          </Link>
        }
      />
      {sp.done ? (
        <p className="mb-4 rounded-xl border border-good bg-good-soft p-3 text-sm" role="status" data-testid="backfill-done">
          Brought over: {Number(sp.done).toLocaleString()} rows. See them in{" "}
          <Link href="/coach/feedback" className="underline">
            Monthly feedback
          </Link>{" "}
          and{" "}
          <Link href="/coach/office-hours" className="underline">
            Office Hours
          </Link>
          .
        </p>
      ) : null}
      <BackfillForm key={sp.at ?? "form"} />
    </>
  );
}
