import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { featuresFor } from "@/lib/bot-features";
import { featureOf } from "@/lib/engine/bot-features";
import { requestFeatureAction } from "@/lib/actions/bot-features";
import { CheckIcon, Chip, FeatureIcon } from "@/components/bot-feature-icon";
import { SubmitButton } from "@/components/submit-button";
import "../bot-features.css";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { title: featureOf((await params).key)?.name ?? "Bot Features" };
}

/**
 * One feature (rev 618): how it works in three steps, the setup the client fills in, the GoHighLevel tag to build on, and
 * "Turn it on for me". Locked or Coming soon, it says what unlocks it and asks for nothing; requested or on, it says so.
 */
export default async function BotFeaturePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ sent?: string; error?: string; field?: string; [k: string]: string | undefined }> }) {
  const v = await requireViewer({ team: "allow" });
  const feature = featureOf((await params).key);
  if (!feature) notFound();
  const sp = await searchParams;
  const view = (await featuresFor(v.membership)).find((x) => x.feature.key === feature.key)!;
  const viewOnly = Boolean(v.team) || Boolean(v.switchedInto);
  const setup = view.request?.setup ?? {};
  const valueOf = (key: string, fallback?: string) => sp[`v_${key}`] ?? setup[key] ?? fallback ?? "";
  const canAsk = view.state === "unlocked" && !viewOnly;
  const error = sp.error === "locked" ? "That feature isn't unlocked yet." : sp.error;
  return (
    <div className="bf-page">
      <div className={`bf-detail ${view.state}`} data-testid="bf-detail" data-state={view.state}>
        <Link href="/bot-features" className="bf-back">
          ‹ Bot Features
        </Link>
        <div className="bf-top">
          <span className="bf-ring">
            <FeatureIcon icon={feature.icon} size={28} />
          </span>
          <Chip state={view.state} />
        </div>
        <div>
          <h1 className="bf-name bf-anton">{feature.name}</h1>
          <p className="bf-desc mt-2">{feature.description}</p>
        </div>
        <section aria-labelledby="bf-how">
          <h2 id="bf-how" className="bf-label">
            HOW IT WORKS
          </h2>
          <ol className="bf-steps">
            {feature.steps.map((s, i) => (
              <li key={s}>
                <span className="bf-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </section>
        <form action={requestFeatureAction} data-testid="bf-form">
          <input type="hidden" name="key" value={feature.key} />
          <h2 className="bf-label">YOUR SETUP</h2>
          {feature.setup.length ? (
            feature.setup.map((f) => {
              const id = `bf-${f.key}`;
              const bad = sp.field === f.key;
              const common = { id, name: f.key, className: "bf-input", required: f.required, disabled: !canAsk, defaultValue: valueOf(f.key, f.defaultValue), placeholder: f.placeholder, "aria-invalid": bad || undefined, "aria-describedby": bad ? "bf-error" : undefined };
              return (
                <label key={f.key} className="bf-field" htmlFor={id}>
                  {f.label}
                  {f.type === "textarea" ? <textarea {...common} placeholder={f.placeholder ?? "One per line"} /> : <input {...common} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} min={f.type === "number" ? 0 : undefined} inputMode={f.type === "number" ? "numeric" : undefined} />}
                </label>
              );
            })
          ) : (
            <p className="bf-note">Nothing to fill in.</p>
          )}
          {error ? (
            <p id="bf-error" className="bf-error" role="alert" data-testid="bf-error">
              {error}
            </p>
          ) : null}
          {feature.ghl ? (
            <div className="bf-ghl mt-4" data-testid="bf-ghl">
              In GoHighLevel, build your {feature.ghl.build} on {feature.ghl.tags.length > 1 ? "these tags" : "this tag"}:
              <div>
                {feature.ghl.tags.map((t) => (
                  <span key={t} className="bf-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-5">
            {canAsk ? (
              <>
                <SubmitButton className="bf-btn big" pendingText="Sending…" data-testid="bf-turn-on">
                  Turn it on for me
                </SubmitButton>
                <p className="bf-note mt-2">We&apos;ll switch it on in your bot and let you know when it&apos;s live.</p>
              </>
            ) : view.state === "on" ? (
              <p className="bf-running" data-testid="bf-on">
                <CheckIcon /> On · Running in your bot
              </p>
            ) : view.state === "requested" ? (
              <p className="bf-sent" role="status" data-testid="bf-requested">
                Requested · we&apos;ll switch it on in your bot and let you know when it&apos;s live.
              </p>
            ) : view.state === "unlocked" ? (
              <p className="bf-note" data-testid="bf-view-only">
                Unlocked. Only the account owner can ask for it to be switched on.
              </p>
            ) : (
              <p className="bf-note" data-testid="bf-locked-line">
                {view.state === "coming_soon" ? "Coming soon. " : ""}Unlocks when you <b className="text-white">{view.unlockLine}</b>
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
