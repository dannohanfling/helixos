"use server";

/**
 * Allow or Stop an agent in a client's HelixOS (H-1385): the coach's own, signed in, on the client's page. Nothing else
 * grants it: not a token, not the consent screen, not an agent.
 */
import { redirect } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { setGrant } from "@/lib/agent-clients";

export async function setAgentGrantAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const clientMembershipId = str(formData, "clientMembershipId");
  const agentId = str(formData, "agentId");
  await setGrant({ workspaceId: coach.workspace.id, userId: coach.user.id }, agentId, clientMembershipId, str(formData, "on") === "1");
  refresh();
  redirect(`/coach/${encodeURIComponent(clientMembershipId)}#agents`);
}
