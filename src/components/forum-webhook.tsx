"use client";

/**
 * Settings → The Forum (rev 765 §2): the member's Forum webhook. The secret is made here, shown once, and never again; Rotate
 * makes a new one (the old one stops at once) and Revoke ends it. Every example sends the secret in the X-Forum-Secret header
 * and reads it from a saved secret or environment variable, never typed into the address.
 */
import { useActionState } from "react";
import { makeForumWebhookAction, revokeForumWebhookAction, type ForumFormState } from "@/lib/actions/forum";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";

const body = `{"agent":"Main","status":"working","now":"Building the Forum","flow":{"to":"you","label":"plan ready"}}`;

function examples(url: string): { name: string; steps: string[]; code?: string }[] {
  return [
    {
      name: "Any script (curl)",
      steps: ["Save the secret as an environment variable called HELIX_FORUM_SECRET, then:"],
      code: `curl -sS -X POST "${url}" \\\n  -H "X-Forum-Secret: $HELIX_FORUM_SECRET" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`,
    },
    {
      name: "Claude Code hooks",
      steps: ["Set HELIX_FORUM_SECRET in the environment Claude Code runs in (never in the repo).", "Add a hook to .claude/settings.json; this one reports each time Claude finishes a turn:"],
      code: `{\n  "hooks": {\n    "Stop": [{ "hooks": [{ "type": "command", "command": "curl -sS -X POST ${url} -H \\"X-Forum-Secret: $HELIX_FORUM_SECRET\\" -H 'Content-Type: application/json' -d '{\\"agent\\":\\"Main\\",\\"status\\":\\"done\\",\\"last\\":\\"Finished a turn\\"}'" }] }]\n  }\n}`,
    },
    {
      name: "OpenAI Codex",
      steps: ["Set HELIX_FORUM_SECRET in your shell.", "In ~/.codex/config.toml, point notify at a small script that posts the curl above with your agent's name and status."],
      code: `notify = ["bash", "-lc", "curl -sS -X POST ${url} -H \\"X-Forum-Secret: $HELIX_FORUM_SECRET\\" -H 'Content-Type: application/json' -d '{\\"agent\\":\\"Codex\\",\\"status\\":\\"done\\",\\"last\\":\\"Finished a task\\"}'"]`,
    },
    { name: "Zapier", steps: ["Add a Webhooks by Zapier step: POST.", `URL: ${url}`, "Payload type: JSON. Data: agent, status, now (and any other field).", "Headers: X-Forum-Secret, with your secret."] },
    { name: "Make", steps: ['Add an HTTP module: "Make a request".', `URL: ${url}, method POST, body type Raw, content type JSON.`, "Add a header X-Forum-Secret with your secret, and put the report in the body."] },
    { name: "n8n", steps: ["Add an HTTP Request node: POST.", `URL: ${url}`, "Authentication: Header Auth, name X-Forum-Secret, value your secret (saved as an n8n credential).", "Send Body: JSON with agent, status and now."] },
    { name: "GoHighLevel workflows", steps: ["Add a Custom Webhook action: POST.", `URL: ${url}`, "Headers: X-Forum-Secret with your secret; Content-Type application/json.", 'Body: {"agent":"Booking bot","status":"done","last":"A call was booked"}.'] },
    {
      name: "GitHub Actions",
      steps: ["Save the secret in the repo's Settings → Secrets as HELIX_FORUM_SECRET.", "Add a step at the end of a workflow:"],
      code: `- name: Tell my Forum\n  run: >\n    curl -sS -X POST ${url}\n    -H "X-Forum-Secret: \${{ secrets.HELIX_FORUM_SECRET }}"\n    -H "Content-Type: application/json"\n    -d '{"agent":"GitHub","status":"done","last":"Workflow \${{ github.workflow }} finished"}'`,
    },
  ];
}

export function ForumWebhookCard({ url, made, usedAt, canChange }: { url: string; made: string | null; usedAt: string | null; canChange: boolean }) {
  const [state, action] = useActionState<ForumFormState, FormData>(makeForumWebhookAction, null);
  const live = !!state?.secret || !!made;
  return (
    <div className="space-y-3 text-sm" data-testid="forum-webhook">
      <p className="text-ink-2">For agents and tools that can&apos;t use the HelixOS connector. They post a report to this address, with your secret in a header. The fields are the same as forum_report&apos;s.</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <code className="min-w-0 break-all rounded bg-surface-2 px-2 py-1" data-testid="forum-webhook-url">
          {url}
        </code>
        <CopyButton text={url} label="Copy" className="btn btn-ghost btn-xs" />
      </div>
      <p data-testid="forum-webhook-state">
        {live ? (
          <>
            Secret: <strong>on</strong>
            {made ? ` · made ${made}` : ""}
            {usedAt ? ` · last used ${usedAt}` : made ? " · not used yet" : ""}
          </>
        ) : (
          <>
            Secret: <strong>none yet</strong>
          </>
        )}
      </p>
      {state?.secret ? (
        <div className="rounded-lg border border-warn bg-warn-soft p-3" role="status" data-testid="forum-webhook-secret">
          <p className="font-medium">Your new secret. Copy it now: it won&apos;t be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded bg-surface px-2 py-1 text-xs" data-testid="forum-webhook-secret-value">
              {state.secret}
            </code>
            <CopyButton text={state.secret} label="Copy" className="btn btn-soft btn-xs" />
          </div>
          <p className="mt-2 text-xs text-ink-2">Paste it only into the secret or header field of the tool that reports. Never into a chat, a document or an address.</p>
        </div>
      ) : null}
      {canChange ? (
        <div className="flex flex-wrap items-center gap-2">
          <form action={action}>
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Making…" data-testid="forum-webhook-make">
              {live ? "Rotate: make a new secret" : "Make a secret"}
            </SubmitButton>
          </form>
          {live ? (
            <form action={revokeForumWebhookAction}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Revoking…" data-testid="forum-webhook-revoke">
                Revoke
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-3">Only the member can make or change their Forum secret.</p>
      )}
      <details>
        <summary className="cursor-pointer font-medium">Examples for each platform</summary>
        <div className="mt-2 space-y-3">
          {examples(url).map((e) => (
            <div key={e.name}>
              <p className="font-medium">{e.name}</p>
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                {e.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {e.code ? (
                <div className="mt-1 flex flex-wrap items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs">{e.code}</pre>
                  <CopyButton text={e.code} label="Copy" className="btn btn-ghost btn-xs" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
