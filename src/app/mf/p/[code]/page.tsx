import { Closed } from "@/components/hermes/closed";
import { Landing } from "@/components/hermes/landing";
import { previewContext, type CallContext, type Proof } from "@/lib/hermes/data";
import type { MfPreview } from "@/db/schema";
import { withinLimits } from "@/lib/hermes/view";
import { previewByCode } from "@/lib/mf/preview";
import { proofsForPreview } from "@/lib/mf/preview-proofs";

/**
 * A coach's preview as the real page (H-142): the page the engine wrote for a made-up prospect, in the gold design, by its
 * day-long code. The form doesn't post, nothing is counted, no pixel fires; the layout makes it noindex. Unknown or expired:
 * the quiet closed page, nothing personal on it. Rate limited like every page here.
 */
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await withinLimits(code))) return <Closed line="Too many visits just now. Please wait a minute and open your link again." />;
  const row = await previewByCode(code);
  if (!row) return <Closed line="This preview has expired. Make a new one from your Magic funnel page." />;
  const m = { workspaceId: row.workspaceId, userId: row.userId };
  const ctx = await previewContext(m, row.webinarId);
  if (!ctx) return <Closed line="This preview's webinar has no date yet." />;
  const proofs = await proofsForPreview(m, row.pitch.proof_ids, ctx.setup.proofIds.length > 0);
  return landing(ctx, row, proofs);
}

/** The page itself, as Hermes's renderer builds it: the clock read here, outside the component. */
function landing(ctx: CallContext, row: MfPreview, proofs: Proof[]) {
  const now = Date.now();
  return <Landing ctx={ctx} pitch={row.pitch} personal={Object.values(row.sources).some((s) => s === "personal")} firstName={row.firstName} prefill={{ firstName: row.firstName, email: "", phone: "" }} proofs={proofs} code={null} formError={null} now={now} preview />;
}
