"use client";

import { useActionState } from "react";
import { makeHealthKeyAction, revokeHealthKeyAction } from "@/lib/actions/body";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";

type Made = { key: string } | { error: string } | null;

/**
 * Apple Health on HumanOS settings → Devices (rev 508 §4): make the Shortcut's key (shown here once, in this page's memory only,
 * never in the address bar), revoke it, and the steps to build the Shortcut, or Danno's ready-made one when it's set.
 */
export function HealthConnect({ status, endpoint, shortcutUrl }: { status: { made: string; lastUsed: string | null } | null; endpoint: string; shortcutUrl: string | null }) {
  const [made, make] = useActionState<Made>(async () => makeHealthKeyAction(), null);
  const key = made && "key" in made ? made.key : null;
  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="health-connect">
      <p className="text-sm text-ink-2">
        Apple Health sends your morning weigh-in through a Shortcut on your iPhone: weight, body fat %, lean body mass (saved as fat-free mass) and BMI, each morning with no tap. RENPHO writes those four to Health. Its other numbers (visceral fat, water, bone, protein, BMR, metabolic age) stay in RENPHO, so the RENPHO export on Weigh-ins still brings them.
      </p>
      {key ? (
        <div className="mt-3 rounded-lg border border-good bg-good-soft p-3 text-sm" role="status" data-testid="health-key">
          <p className="font-medium">Your key. Copy it now: it isn&apos;t shown again.</p>
          <code className="mt-2 block break-all rounded bg-surface p-2 text-xs" data-testid="health-key-value">
            {key}
          </code>
          <div className="mt-2">
            <CopyButton text={key} label="Copy the key" />
          </div>
          <p className="mt-2 text-xs text-ink-3">Paste it into the Shortcut when it asks, the first time it runs. Anyone with this key can send weigh-ins to your HumanOS, so keep it in the Shortcut only. Revoke it below if it gets out.</p>
        </div>
      ) : null}
      {made && "error" in made ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {made.error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {status ? (
          <span data-testid="health-connected">
            <span className="font-medium">Apple Health connected</span>
            <span className="text-ink-3">
              {" "}
              · key made {status.made} · {status.lastUsed ? `last weigh-in sent ${status.lastUsed}` : "no weigh-in sent yet"}
            </span>
          </span>
        ) : null}
        <form action={make}>
          <SubmitButton className={status ? "btn btn-ghost btn-sm" : "btn btn-humanos btn-sm"} pendingText="Making a key…" data-testid="health-make-key">
            {status ? "Make a new key" : "Connect Apple Health"}
          </SubmitButton>
        </form>
        {status ? (
          <form action={revokeHealthKeyAction}>
            <SubmitButton className="btn btn-ghost btn-sm text-ink-3" pendingText="…" data-testid="health-revoke">
              Revoke
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <details className="mt-3 text-sm" open={Boolean(key)}>
        <summary className="cursor-pointer text-ink-2">How to set up the Shortcut</summary>
        {shortcutUrl ? (
          <p className="mt-2">
            <a href={shortcutUrl} target="_blank" rel="noreferrer" className="btn btn-soft btn-sm" data-testid="health-shortcut-link">
              Add the ready-made Shortcut ↗
            </a>
            <span className="ml-2 text-xs text-ink-3">It asks for your key when you add it. Then do step 1 below to run it every morning.</span>
          </p>
        ) : null}
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-2" data-testid="health-steps">
          <li>On your iPhone, open Shortcuts, tap Automation, then the +. Choose Time of Day, set it to a time after you usually weigh in (say 9:00 AM), Daily, and pick Run Immediately. Tap Next, then New Blank Automation.</li>
          <li>Add Find Health Samples. Set it to Weight, add the filter Start Date is in the last 1 day, sort by Start Date, Latest First, and Limit to 1.</li>
          <li>Add Get Details of Health Sample three times on that result: Value, Unit, and Start Date. On the Start Date, add Format Date, choose ISO 8601 and turn on Include Time.</li>
          <li>Do the same for Body Fat Percentage (Value only), Lean Body Mass (Value and Unit) and Body Mass Index (Value only). If a scale doesn&apos;t send one of those, leave it out.</li>
          <li>
            Add Get Contents of URL. URL: <code className="break-all text-xs">{endpoint}</code>. Tap Show More: Method POST. Add a header: Authorization, with the value Bearer, a space, then your key. Request Body: JSON, with these fields (each a Text set to the value from the steps above):
            <code className="mt-1 block text-xs">weight · weight_unit · body_fat · lean_mass · lean_unit · bmi · at</code>
            (at is the formatted Start Date).
          </li>
          <li>Add Show Notification with Contents of URL, so you see what was saved. Tap Done. To try it now, tap the automation and run it once.</li>
        </ol>
        <p className="mt-2 text-xs text-ink-3">The same weigh-in sent twice, or one already brought in from the RENPHO export or typed in, is one row on Weigh-ins: the minute decides.</p>
      </details>
    </div>
  );
}
