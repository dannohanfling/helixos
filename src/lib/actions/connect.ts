"use server";

/**
 * Connect your tools (rev 850, with revs 846 and 849): a member connects their own Community Loyalty bot, and the coach can email
 * them the link to do it. The key is tested before anything is kept: one tiny call, and on a refusal nothing is saved and the
 * card says why in plain words. The key is sealed at rest and never shown again, never logged, never put in an address; the
 * answer rides back as a short code. Nothing here can be seen or changed from a coach's switched-in view.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { seal } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { testClKey } from "@/lib/community-loyalty";
import { clNoticeCode, defaultClAgent, isClContactId } from "@/lib/engine/connect-copy";
import { brandedEmail } from "@/lib/branded-email";
import { emailConfigured, sendEmail } from "@/lib/email";
import { logSync } from "@/lib/integrations";

const REASON = "Connections and keys are {first}'s own: they can't be seen or changed from their HelixOS.";
/** Where the card sits: Settings or the Connect page. Anything else goes to Settings. */
const backTo = (raw: string | null): string => (raw === "/connect-tools" || raw === "/my-bot/connection" ? raw : "/settings");
const answer = (back: string, code: string): never => redirect(`${back}?${back === "/settings" ? "tab=connections&" : ""}cl=${code}#community-loyalty`);

/** Tests the pasted key, then keeps it. A refusal keeps nothing, and an old key that worked stays as it was. */
export async function connectClAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: REASON });
  const back = backTo(opt(formData, "back"));
  const token = (opt(formData, "clKey") ?? "").trim();
  if (!token) answer(back, "empty");
  const r = await testClKey(token);
  if (!r.ok) {
    await logSync({ workspaceId: v.workspace.id, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "cl.connect", status: "failed", note: r.error });
    answer(back, clNoticeCode(r.error));
    return;
  }
  const agent = v.membership.clAgentNs?.trim() && r.agents.some((a) => a.ns === v.membership.clAgentNs) ? v.membership.clAgentNs : defaultClAgent(r.agents) || null;
  await db.update(schema.memberships).set({ clApiToken: seal(token), clConnectedAt: nowIso(), clAgentNs: agent }).where(eq(schema.memberships.id, v.membership.id));
  await logSync({ workspaceId: v.workspace.id, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "cl.connect", payload: { agents: r.agents.length }, status: "sent", note: `Connected by ${v.user.name}: ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}` });
  answer(back, "ok");
}

/** The three settings under a connected key: the agent, the member's own contact ID (format checked), the FAQ field. */
export async function saveClSettingsAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: REASON });
  const back = backTo(opt(formData, "back"));
  const contact = opt(formData, "clUserNs")?.trim() ?? null;
  if (contact && !isClContactId(contact)) answer(back, "contact");
  await db
    .update(schema.memberships)
    .set({ clAgentNs: opt(formData, "clAgentNs"), clUserNs: contact, faqBotField: opt(formData, "faqBotField") })
    .where(eq(schema.memberships.id, v.membership.id));
  answer(back, "saved");
}

/** Removes the key from HelixOS. The token itself lives on in Community Loyalty until it is deleted there. */
export async function removeClKeyAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: REASON });
  const back = backTo(opt(formData, "back"));
  await db.update(schema.memberships).set({ clApiToken: null, clConnectedAt: null }).where(eq(schema.memberships.id, v.membership.id));
  await logSync({ workspaceId: v.workspace.id, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "cl.removed", status: "sent", note: `Key removed by ${v.user.name}; delete the token in Community Loyalty too` });
  answer(back, "removed");
}

/** The coach emails a client the link to Connect your tools. The email carries the link, never a key. */
export async function sendConnectLinkAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  const user = m ? await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) }) : null;
  if (!m || !user) return;
  const mail = brandedEmail(
    {
      subject: "Connect your tools in HelixOS",
      preheader: "Two short steps: GoHighLevel, then your Community Loyalty bot.",
      greeting: `Hi ${user.name.split(" ")[0]},`,
      stateLine: null,
      asks: [`${coach.user.name} asked you to connect your own GoHighLevel and Community Loyalty to HelixOS. It takes a few minutes, step by step, and you can stop and come back.`],
      buttonLabel: "Connect your tools",
      pointsLine: "Make each key while signed in as yourself. Never email or text a key to anyone, including your coach.",
      path: "/connect-tools",
      footerText: "If you get stuck, book Office Hours and we'll do it together on screen.",
    },
    { settingsLink: false },
  );
  const sent = emailConfigured();
  if (sent) {
    try {
      await sendEmail(user.email, mail.subject, mail.text, mail.html);
    } catch (e) {
      console.error("[connect] setup link send failed", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
      return;
    }
  }
  await db.update(schema.memberships).set({ connectLinkSentAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  await logSync({ workspaceId: coach.workspace.id, userId: user.id, provider: "account", direction: "out", event: "connect_link.sent", payload: { by: coach.user.name }, status: sent ? "sent" : "skipped", note: `Setup link sent by ${coach.user.name}` });
  refresh();
}
