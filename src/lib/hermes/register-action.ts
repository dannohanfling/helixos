"use server";

/**
 * The seat form's server action (the HelixOS pages are public: no session). It registers the person, hands GoHighLevel to
 * after() so a slow GoHighLevel never holds the page, and sends them to their confirmation. A form that can't register goes
 * back to its page with a short reason code in ?error= (the shared SubmitButton then puts back what they typed); nothing the
 * person typed ever goes in an address.
 */
import { after } from "next/server";
import { redirect } from "next/navigation";
import { allow, clientIp } from "@/lib/rate-limit";
import { register } from "@/lib/hermes/register";

export async function registerSeatAction(fd: FormData): Promise<void> {
  const str = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : null);
  const code = str("code");
  const webinarId = str("webinar");
  const back = code ? `/mf/${encodeURIComponent(code)}` : webinarId ? `/mf/w/${encodeURIComponent(webinarId)}` : "/mf/w/none";
  if (!(await allow(`hermes:register:${await clientIp()}`, 10, 60_000))) redirect(`${back}?error=busy#seat`);
  const r = await register({ code, webinarId, firstName: fd.get("firstName"), email: fd.get("email"), phone: fd.get("phone") });
  if (!r.ok) redirect(`${r.back ?? back}?error=${r.outcome === "closed" ? "closed" : "check"}#seat`);
  if (r.ghl) after(r.ghl);
  redirect(`/mf/${r.code}/confirmed`);
}
