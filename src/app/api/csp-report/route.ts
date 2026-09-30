import { allow, clientIp } from "@/lib/rate-limit";

/**
 * Where the browser reports what the Content-Security-Policy blocked (`report-uri` in next.config.ts). One log line per
 * report, the directive and the blocked address's origin only (never its path or query, which could carry ids), so a
 * third-party script's extra hosts, the chat widget's for one, are found from the server log rather than guessed.
 */
export async function POST(request: Request) {
  if (!(await allow(`csp:${await clientIp()}`, 30, 60 * 1000))) return new Response(null, { status: 429 });
  try {
    const raw = (await request.json()) as unknown;
    const reports = Array.isArray(raw) ? raw : [raw];
    for (const r of reports.slice(0, 5)) {
      const body = ((r as { "csp-report"?: unknown; body?: unknown })["csp-report"] ?? (r as { body?: unknown }).body ?? r) as Record<string, unknown>;
      const directive = String(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? "?").slice(0, 40);
      const blocked = String(body["blocked-uri"] ?? body.blockedURL ?? "");
      let origin = blocked;
      try {
        origin = new URL(blocked).origin;
      } catch {
        origin = blocked.slice(0, 40);
      }
      console.warn(`[csp] blocked ${directive} ${origin}`);
    }
  } catch {
    /* not a report */
  }
  return new Response(null, { status: 204 });
}
