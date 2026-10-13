/**
 * Turning a PageView into the page: shared by the personal and the cold address. Rate limited per address and per code; over
 * a limit the page is the quiet one, with nothing personal on it.
 */
import { redirect } from "next/navigation";
import { allow, clientIp } from "@/lib/rate-limit";
import { Landing } from "@/components/hermes/landing";
import { Closed } from "@/components/hermes/closed";
import type { PageView } from "@/lib/hermes/data";

export const FORM_ERRORS: Record<string, string> = {
  check: "Please add your first name and an email address we can reach you at.",
  closed: "That call isn't taking sign-ups any more.",
  busy: "Too many tries just now. Please wait a minute and try again.",
};

export async function withinLimits(key: string | null): Promise<boolean> {
  const ip = await clientIp();
  if (!(await allow(`hermes:ip:${ip}`, 60, 60_000))) return false;
  return key ? allow(`hermes:code:${key}`, 30, 60_000) : true;
}

export function render(view: PageView, o: { error: string | null }) {
  if (view.kind === "registered") redirect(`/mf/${view.code}/confirmed`);
  if (view.kind === "closed") return <Closed />;
  const now = Date.now();
  if (view.kind === "cold") return <Landing ctx={view.ctx} pitch={view.pitch} personal={false} firstName="" prefill={null} proofs={view.proofs} code={null} formError={o.error} now={now} />;
  return <Landing ctx={view.ctx} pitch={view.pitch} personal={view.ready} firstName={view.firstName} prefill={view.prefill} proofs={view.proofs} code={view.code} formError={o.error} now={now} />;
}

export const formError = (e: string | string[] | undefined) => (typeof e === "string" ? (FORM_ERRORS[e] ?? null) : null);
