import { redirect } from "next/navigation";
import { Confirm } from "@/components/hermes/confirm";
import { Closed } from "@/components/hermes/closed";
import { confirmedView } from "@/lib/hermes/data";
import { withinLimits } from "@/lib/hermes/view";

/** "You're in": only for a code that is registered; any other code goes back to its page, which never breaks. */
export const dynamic = "force-dynamic";

export default async function ConfirmedPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await withinLimits(code))) return <Closed line="Too many visits just now. Please wait a minute and open your link again." />;
  const v = await confirmedView(code);
  if (!v) redirect(`/mf/${encodeURIComponent(code)}`);
  return <Confirm ctx={v.ctx} firstName={v.firstName} pitch={v.pitch} icsHref={`/mf/${code}/ics`} />;
}
