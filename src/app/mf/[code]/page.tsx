import { Closed } from "@/components/hermes/closed";
import { personalView } from "@/lib/hermes/data";
import { formError, render, withinLimits } from "@/lib/hermes/view";

/**
 * A prospect's own page, by their Magic funnel code: the whole page in the gold design, their sections from the engine, the form
 * filled on the server. Still being written: up to five seconds' wait, then the default copy. Unknown, closed or past: the
 * cold version. noindex (the layout); rate limited per address and per code.
 */
export const dynamic = "force-dynamic";

export default async function PersonalPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string | string[] }> }) {
  const [{ code }, { error }] = await Promise.all([params, searchParams]);
  if (!(await withinLimits(code))) return <Closed line="Too many visits just now. Please wait a minute and open your link again." />;
  return render(await personalView(code), { error: formError(error) });
}
