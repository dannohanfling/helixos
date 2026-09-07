import { PendingLink } from "@/components/pending-link";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "", title, action, id }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section id={id} className={`card p-4 sm:p-5 ${className}`}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "danger" }) {
  const cls = tone === "neutral" ? "" : `badge-${tone}`;
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Progress({ value, tone = "accent", height = 8 }: { value: number; tone?: "accent" | "good" | "warn"; height?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === "accent" ? "var(--accent)" : tone === "good" ? "var(--good)" : "var(--warn)";
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: "var(--surface-2)" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Empty({ icon = "✨", title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center">
      <div className="text-2xl">{icon}</div>
      <div className="font-semibold">{title}</div>
      {hint ? <div className="max-w-sm text-sm text-ink-2">{hint}</div> : null}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, hero = false }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</div>
      <div className={`mt-1 font-semibold leading-none ${hero ? "text-4xl sm:text-5xl" : "text-2xl"}`}>{value}</div>
      {sub ? <div className="mt-2 text-xs text-ink-2">{sub}</div> : null}
    </div>
  );
}

export function LinkButton({ href, children, variant = "ghost", size = "" }: { href: string; children: ReactNode; variant?: "primary" | "accent" | "ghost" | "soft"; size?: "" | "sm" | "xs" }) {
  return (
    <PendingLink href={href} className={`btn btn-${variant} ${size ? `btn-${size}` : ""}`}>
      {children}
    </PendingLink>
  );
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 text-sm">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition ${
            current === it.key ? "bg-surface shadow-sm" : "text-ink-2 hover:text-ink"
          }`}
        >
          {it.label}
          {typeof it.count === "number" ? <span className="badge">{it.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Disclosure({ summary, children, open = false, className = "" }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details open={open} className={`group ${className}`}>
      <summary className="inline-flex">{summary}</summary>
      <div className="mt-3 animate-pop">{children}</div>
    </details>
  );
}
