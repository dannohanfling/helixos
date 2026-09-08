import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { aiStatus } from "@/lib/ai";
import { recheckAiKeyAction, removeAiKeyAction, saveAiKeyAction } from "@/lib/actions/ai";
import { MODELS, essenceCallDelta, money, rollup } from "@/lib/engine/ai-usage";
import { essenceChars, roughTokens } from "@/lib/engine/essence";
import { essenceFor } from "@/lib/queries/essence";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, Field } from "./ui";

/** Settings: connect your own Anthropic or OpenAI key, see what it's being spent on. */
export async function AiKeyCard({ v }: { v: Viewer }) {
  const status = await aiStatus(v);
  const monthStart = `${v.today.slice(0, 7)}-01`;
  const rows = await db.query.aiUsage.findMany({ where: and(eq(schema.aiUsage.workspaceId, v.workspace.id), eq(schema.aiUsage.userId, v.user.id), gte(schema.aiUsage.createdAt, monthStart)) });
  const use = rollup(rows);
  // The voice prefix is paid on every call; say what it adds, on this member's own key.
  const voiceTokens = roughTokens(essenceChars(await essenceFor(v.workspace.id, v.user.id)));
  const delta = status.provider ? essenceCallDelta(MODELS[status.provider].light, voiceTokens) : null;
  const cred = status.provider ? await db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, v.workspace.id), eq(schema.aiCredentials.userId, v.user.id)) }) : null;
  const providerName = status.provider === "anthropic" ? "Anthropic" : status.provider === "openai" ? "OpenAI" : null;
  return (
    <Card
      title="✨ AI drafting (your own key)"
      action={
        status.hasKey ? (
          <Badge tone="good">connected · {providerName} · ····{status.last4}</Badge>
        ) : status.provider ? (
          <Badge tone="danger">key problem</Badge>
        ) : (
          <Badge tone="neutral">not connected</Badge>
        )
      }
    >
      <p className="mb-3 text-sm text-ink-2">The ✨ buttons (composer polish, repurposing, group drafts, webinar sections, ladders) run on your own account with Anthropic or OpenAI. HelixOS never pays for AI on your behalf and never sees your key again after it&apos;s saved. Without a key, everything still works with the built-in rule-based drafts.</p>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3">
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <div className="font-semibold">A ChatGPT Plus or Claude Pro subscription is not an API key.</div>
            <p className="mt-1 text-ink-2">API access is a separate sign-up with its own pay-as-you-go billing. It usually costs a few dollars a month for the drafting you&apos;ll do here, not the price of a subscription.</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
              <li>
                <b>Anthropic:</b> go to <code className="text-xs">console.anthropic.com</code>, add a payment method under Billing, then create a key under API Keys. It starts with <code className="text-xs">sk-ant-</code>.
              </li>
              <li>
                <b>OpenAI:</b> go to <code className="text-xs">platform.openai.com</code>, add a payment method under Billing, then create a key under API keys. It starts with <code className="text-xs">sk-</code>.
              </li>
              <li>Copy the key once (it&apos;s shown once), paste it below, and press Connect. HelixOS makes one tiny test call so you know right away if it works.</li>
            </ol>
          </div>
          <form action={saveAiKeyAction} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
            <Field label="Provider">
              <select className="field" name="provider" defaultValue={status.provider ?? "anthropic"}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
              </select>
            </Field>
            <Field label="API key" hint={status.provider ? "A key is saved. Paste a new one only to replace it." : "Stored encrypted. Never shown again."}>
              <input className="field" name="key" type="password" autoComplete="off" placeholder={status.provider ? "•••••••• saved" : "sk-…"} />
            </Field>
            <div className="flex items-end">
              <button className="btn btn-primary btn-sm" type="submit">
                {status.provider ? "Replace and check" : "Connect and check"}
              </button>
            </div>
          </form>
          {status.lastError ? (
            <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="ai-error">
              {status.lastError}
            </p>
          ) : null}
          {status.provider ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
              {cred?.lastValidatedAt ? <span>Checked {formatDateTime(cred.lastValidatedAt, v.workspace.timezone)}</span> : null}
              <span>Models: {MODELS[status.provider].strong} for long drafts, {MODELS[status.provider].light} for polish.</span>
              <form action={recheckAiKeyAction}>
                <button className="underline" type="submit">Check again</button>
              </form>
              <form action={removeAiKeyAction}>
                <button className="underline" type="submit">Remove key</button>
              </form>
            </div>
          ) : null}
        </div>
        <div className="space-y-2 text-sm" data-testid="ai-usage">
          <div className="flex items-center justify-between">
            <span className="label">This month, on your key</span>
            <span className="tabular font-semibold">{use.calls} calls · about {money(use.costUsd)}</span>
          </div>
          <p className="text-xs text-ink-3" data-testid="voice-cost">
            {voiceTokens ? (
              <>
                Your Essence rides on every call: about {voiceTokens.toLocaleString()} tokens{delta ? `, roughly ${money(delta.cacheRead)} a call read from cache, ${money(delta.cacheWrite)} when it has to be written (the first call, then again after five quiet minutes)` : ""}.{voiceTokens < 1024 ? " Under about 1,000 tokens the provider doesn't cache it and it is billed at the plain rate." : ""} This month: {use.cacheReadTokens.toLocaleString()} tokens read from cache, {use.cacheWriteTokens.toLocaleString()} written.{status.provider === "openai" ? " OpenAI figures here are indicative: the tiers are priced to match Anthropic's, and OpenAI's own cached rate may differ." : ""}
              </>
            ) : (
              <>
                No Essence yet, so no voice prefix is sent. <Link href="/essence" className="underline">Set up your voice</Link> and it rides on every call, cached where the provider allows.
              </>
            )}
          </p>
          {use.byFeature.length ? (
            <ul className="divide-y rounded-lg border text-xs">
              {use.byFeature.map((f) => (
                <li key={f.feature} className="flex items-center justify-between px-3 py-1.5">
                  <span>{f.label}</span>
                  <span className="tabular text-ink-2">{f.calls} · {money(f.costUsd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-3">Nothing yet. Every ✨ call will show up here with what it cost, so you never wonder where the money went.</p>
          )}
          <p className="text-xs text-ink-3">
            Today: {status.callsToday}/{status.exempt ? "no cap" : status.cap} calls.{" "}
            {status.blocked ? <b className="text-warn">Today&apos;s cap is reached; ✨ is paused until tomorrow. Your coach can lift it.</b> : status.exempt ? "Your coach lifted the daily cap for you." : "The daily cap protects you from a runaway loop spending your money; your coach can raise it."}
          </p>
          <p className="text-[11px] text-ink-3">Costs are estimates from list prices and token counts. Your provider&apos;s dashboard is the bill.{use.unknownModels.length ? ` A "—" means a call ran on a model with no listed price (${use.unknownModels.join(", ")}), so its cost is unknown rather than guessed.` : ""}</p>
        </div>
      </div>
    </Card>
  );
}
