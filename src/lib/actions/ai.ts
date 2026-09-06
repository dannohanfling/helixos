"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { AI_PROVIDERS } from "@/db/schema";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { seal } from "@/lib/crypto";
import { validateKey, credentialFor } from "@/lib/ai";
import { estimateCost, providerOfKey } from "@/lib/engine/ai-usage";
import { ctx, num, refresh, str } from "@/lib/action-helpers";

/** Saves the member's own key after a real check. Only its encrypted form and last four characters are kept. */
export async function saveAiKeyAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const provider = AI_PROVIDERS.find((p) => p === str(formData, "provider")) ?? "anthropic";
  const key = str(formData, "key");
  const existing = await credentialFor(workspaceId, userId);
  if (!key) {
    if (existing) await db.update(schema.aiCredentials).set({ lastError: "Paste the key to connect." }).where(eq(schema.aiCredentials.id, existing.id));
    refresh();
    return;
  }
  const looksLike = providerOfKey(key);
  let error: string | null = null;
  if (looksLike && looksLike !== provider) error = looksLike === "anthropic" ? "That looks like an Anthropic key (it starts with sk-ant-). Choose Anthropic as the provider, or paste an OpenAI key." : "That looks like an OpenAI key. Choose OpenAI as the provider, or paste an Anthropic key (it starts with sk-ant-).";
  let validated: { inputTokens: number; outputTokens: number; model: string } | null = null;
  if (!error) {
    const r = await validateKey(provider, key);
    if (r.ok) validated = r;
    else error = r.reason;
  }
  const row = { provider, keyEncrypted: seal(key)!, last4: key.slice(-4), lastValidatedAt: error ? null : nowIso(), lastError: error };
  let id = existing?.id;
  if (existing) await db.update(schema.aiCredentials).set(row).where(eq(schema.aiCredentials.id, existing.id));
  else {
    id = newId();
    await db.insert(schema.aiCredentials).values({ id, workspaceId, userId, ...row });
  }
  if (validated) await db.insert(schema.aiUsage).values({ id: newId(), workspaceId, userId, provider, model: validated.model, feature: "key_check", inputTokens: validated.inputTokens, outputTokens: validated.outputTokens, estimatedCostUsd: estimateCost(validated.model, validated.inputTokens, validated.outputTokens) });
  refresh();
}

/** Re-runs the check on the stored key (after fixing billing, for example). */
export async function recheckAiKeyAction(): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const existing = await credentialFor(workspaceId, userId);
  if (!existing) return;
  const { open } = await import("@/lib/crypto");
  const key = open(existing.keyEncrypted);
  if (!key) {
    await db.update(schema.aiCredentials).set({ lastError: "The stored key can't be read any more. Paste it again." }).where(eq(schema.aiCredentials.id, existing.id));
    refresh();
    return;
  }
  const r = await validateKey(existing.provider, key);
  await db.update(schema.aiCredentials).set(r.ok ? { lastError: null, lastValidatedAt: nowIso() } : { lastError: r.reason }).where(eq(schema.aiCredentials.id, existing.id));
  refresh();
}

export async function removeAiKeyAction(): Promise<void> {
  const { workspaceId, userId } = await ctx();
  await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, workspaceId), eq(schema.aiCredentials.userId, userId)));
  refresh();
}

/** Coach: the workspace-wide daily cap on AI calls per member. */
export async function setAiCapAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const cap = Math.max(1, Math.min(1000, Math.round(num(formData, "cap")) || 40));
  await db.update(schema.workspaces).set({ aiDailyCap: cap }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}

/** Coach: lift the cap for one member. */
export async function toggleAiCapExemptAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) return;
  await db.update(schema.memberships).set({ aiCapExempt: !m.aiCapExempt }).where(eq(schema.memberships.id, m.id));
  refresh();
}
