"use client";

import { useMemo, useState } from "react";
import { DeckImageUpload } from "@/components/deck-image-upload";
import { BRAND_COLOR_ROLES, MIN_CONTRAST, contrastRatio, isHex, kitProposals, normaliseHex } from "@/lib/engine/subject";
import { DECK_FONTS, OTHER_FONT, SAFE_FONTS, isListedFont, otherFontLine } from "@/lib/engine/fonts";

export type KitDraft = {
  name: string;
  ground: string;
  ink: string;
  accent: string;
  muted: string;
  surface: string;
  inverseGround: string;
  inverseInk: string;
  displayFont: string;
  bodyFont: string;
  quoteFont: string;
  fontFallback: string;
  logoImageId: string;
  logoDarkImageId: string;
};
type Logo = { id: string; caption: string | null; width: number; height: number };
type ColourRole = (typeof BRAND_COLOR_ROLES)[number] | "inverseGround" | "inverseInk";

const ROLE_HINT: Record<ColourRole, string> = {
  ground: "page background",
  ink: "headline and body text",
  accent: "emphasis, rules and buttons; never words",
  muted: "secondary text",
  surface: "panels, the footer band",
  inverseGround: "full-bleed slides, optional",
  inverseInk: "text on inverseGround, optional",
};
type FontKey = "displayFont" | "bodyFont" | "quoteFont" | "fontFallback";
const FONT_LABEL: Record<FontKey, { label: string; hint: string }> = {
  displayFont: { label: "Display face", hint: "headlines" },
  bodyFont: { label: "Body face", hint: "body text and the footer" },
  quoteFont: { label: "Quote face", hint: "pull quotes, optional" },
  fontFallback: { label: "Fallback face", hint: "what the file names when a brand face is missing on the reader's machine; it is also the file's theme font, so text a reader adds in PowerPoint takes it" },
};

/**
 * The brand kit a client can fill in (deck visuals brief §6.1). Colour pickers that store hex with the hex still editable;
 * faces from a list with "Other (licensed font)" and the one line that says who will not see it; the logo from the library or
 * uploaded here and selected at once; a live preview of a cover, a content slide, a moment slide and a footer drawn from the
 * kit as it is typed; and the contrast check proposing a fix, with Apply, rather than only refusing. The inputs keep the names
 * the save action reads, so the server's own refusal still stands behind this. Nothing here is rendered on a slide: the
 * preview is the browser's drawing of the same colours and faces the file will name.
 */
export function BrandKitEditor({ kit, logos, workspaceId, userId }: { kit: KitDraft; logos: Logo[]; workspaceId: string; userId: string }) {
  const [draft, setDraft] = useState<KitDraft>(kit);
  const [library, setLibrary] = useState<Logo[]>(logos);
  const set = (patch: Partial<KitDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const proposals = useMemo(() => kitProposals(draft), [draft]);
  const logo = library.find((l) => l.id === draft.logoImageId) ?? null;

  return (
    <>
      <div className="sm:col-span-2">
        <label className="block">
          <span className="label">Name</span>
          <input className="field" name="name" value={draft.name} onChange={(e) => set({ name: e.currentTarget.value })} placeholder="Turas — True North" />
        </label>
      </div>
      {(["ground", "ink", "accent", "muted", "surface", "inverseGround", "inverseInk"] as const).map((role) => (
        <ColourField key={role} role={role} value={draft[role]} onChange={(v) => set({ [role]: v } as Partial<KitDraft>)} optional={role === "inverseGround" || role === "inverseInk"} />
      ))}
      {proposals.length ? (
        <ul className="list-disc rounded-lg bg-warn-soft p-2 pl-6 text-sm sm:col-span-2" data-testid="brand-proposals">
          {proposals.map((p) => (
            <li key={p.text} className="flex flex-wrap items-center gap-2">
              <span>{p.text}</span>
              {p.field && p.value ? (
                <button type="button" className="btn btn-ghost btn-xs" data-testid={`brand-apply-${p.field}`} onClick={() => set({ [p.field!]: p.value! } as Partial<KitDraft>)}>
                  Apply {p.value}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {(["displayFont", "bodyFont", "quoteFont", "fontFallback"] as const).map((key) => (
        <FontField key={key} field={key} value={draft[key]} fallback={draft.fontFallback} onChange={(v) => set({ [key]: v } as Partial<KitDraft>)} />
      ))}
      <div className="sm:col-span-2">
        <label className="block">
          <span className="label">Logo</span>
          <select className="field" name="logoImageId" value={draft.logoImageId} data-testid="brand-logo" onChange={(e) => set({ logoImageId: e.currentTarget.value })}>
            <option value="">No logo</option>
            {library.map((l) => (
              <option key={l.id} value={l.id}>
                {l.caption ? l.caption : "Logo"} · {l.width}×{l.height}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-3">From your Images library (kind Logo): on the cover and in the footer bar. None means the kit&apos;s name set as type.</span>
        </label>
        <details className="mt-2" data-testid="brand-logo-upload">
          <summary className="inline-flex cursor-pointer"><span className="btn btn-soft btn-xs">Upload a logo</span></summary>
          <div className="mt-2">
            <DeckImageUpload
              workspaceId={workspaceId}
              userId={userId}
              fixedKind="logo"
              compact
              onRecorded={(img) => {
                setLibrary((l) => [{ id: img.id, caption: img.caption || null, width: img.width, height: img.height }, ...l]);
                set({ logoImageId: img.id });
              }}
            />
          </div>
        </details>
      </div>
      <div className="sm:col-span-2">
        <label className="block">
          <span className="label">Logo for dark backgrounds (optional)</span>
          <select className="field" name="logoDarkImageId" value={draft.logoDarkImageId} data-testid="brand-logo-dark" onChange={(e) => set({ logoDarkImageId: e.currentTarget.value })}>
            <option value="">None: use the logo above</option>
            {library.map((l) => (
              <option key={l.id} value={l.id}>
                {l.caption ? l.caption : "Logo"} · {l.width}×{l.height}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-3">The cover sits on your dark ground, where a dark wordmark disappears. With none, a logo that wouldn&apos;t read there sits on a small light badge.</span>
        </label>
      </div>
      <KitPreview draft={draft} logo={logo} />
    </>
  );
}

/** A colour: the picker and the hex, one value. The hex input carries the form name, so what is posted is what is typed. */
function ColourField({ role, value, onChange, optional }: { role: ColourRole; value: string; onChange: (v: string) => void; optional: boolean }) {
  const hex = normaliseHex(value);
  const valid = isHex(hex);
  return (
    <label className="block">
      <span className="label">{role}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${role} colour`}
          className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent p-0"
          value={valid ? `#${hex}` : "#FFFFFF"}
          data-testid={`brand-pick-${role}`}
          onChange={(e) => onChange(e.currentTarget.value.slice(1).toUpperCase())}
        />
        <input className="field font-mono flex-1" name={role} value={value} maxLength={7} placeholder={optional ? "optional" : "6E6256"} data-testid={`brand-hex-${role}`} onChange={(e) => onChange(e.currentTarget.value)} />
        {optional && value ? (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange("")}>
            Clear
          </button>
        ) : null}
      </span>
      <span className="mt-1 block text-xs text-ink-3">{ROLE_HINT[role]}</span>
    </label>
  );
}

/**
 * A face from the list, or "Other (licensed font)" typed by name. The posted value travels in a hidden input under the field's
 * own name, so the save action reads one string either way. Other shows the one line that says who will not see it.
 */
function FontField({ field, value, fallback, onChange }: { field: FontKey; value: string; fallback: string; onChange: (v: string) => void }) {
  const list = field === "fontFallback" ? SAFE_FONTS : DECK_FONTS;
  const listed = isListedFont(value) && (field !== "fontFallback" || (SAFE_FONTS as readonly string[]).includes(value.trim()));
  const [other, setOther] = useState<boolean>(Boolean(value.trim()) && !listed);
  const optional = field === "quoteFont";
  const pick = other ? OTHER_FONT : value.trim();
  return (
    <label className="block">
      <span className="label">{FONT_LABEL[field].label}</span>
      <input type="hidden" name={field} value={value} />
      <select
        className="field"
        value={pick}
        data-testid={`brand-font-${field}`}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === OTHER_FONT) {
            setOther(true);
            onChange(listed ? "" : value);
          } else {
            setOther(false);
            onChange(v);
          }
        }}
      >
        {optional ? <option value="">None</option> : field === "fontFallback" ? null : <option value="" disabled>Pick a face…</option>}
        {list.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
        <option value={OTHER_FONT}>Other (licensed font)</option>
      </select>
      {other ? (
        <>
          <input className="field mt-1" value={value} placeholder="The face's name, as its licence spells it" data-testid={`brand-font-${field}-other`} onChange={(e) => onChange(e.currentTarget.value)} />
          <span className="mt-1 block text-xs text-warn-ink" data-testid={`brand-font-${field}-line`}>{otherFontLine(field === "fontFallback" ? "Arial" : fallback)}</span>
        </>
      ) : null}
      <span className="mt-1 block text-xs text-ink-3">{FONT_LABEL[field].hint}</span>
    </label>
  );
}

const face = (name: string, fallback: string) => [name, fallback, "Arial", "sans-serif"].filter((f, i, a) => f.trim() && a.indexOf(f) === i).map((f) => `"${f.trim()}"`).join(", ");
const colour = (hex: string, fallback: string) => `#${isHex(normaliseHex(hex)) ? normaliseHex(hex) : fallback}`;

/**
 * Four small slides drawn from the kit as it is typed: a cover, a content slide, a moment slide (on inverseGround when there
 * is one) and the footer band. The same colours and faces the file names; a face not installed on this computer shows as the
 * fallback here, which is what a reader without it sees too. A text pair under the floor marks its slide.
 */
function KitPreview({ draft, logo }: { draft: KitDraft; logo: Logo | null }) {
  const ground = colour(draft.ground, "FFFFFF");
  const ink = colour(draft.ink, "111111");
  const accent = colour(draft.accent, "555555");
  const muted = colour(draft.muted, "555555");
  const surface = colour(draft.surface, "F2F2F2");
  const hasInverse = isHex(normaliseHex(draft.inverseGround)) && isHex(normaliseHex(draft.inverseInk));
  const momentGround = hasInverse ? colour(draft.inverseGround, "111111") : ground;
  const momentInk = hasInverse ? colour(draft.inverseInk, "FFFFFF") : ink;
  const display = face(draft.displayFont, draft.fontFallback);
  const body = face(draft.bodyFont, draft.fontFallback);
  const inkReads = isHex(normaliseHex(draft.ground)) && isHex(normaliseHex(draft.ink)) ? contrastRatio(draft.ground, draft.ink) >= MIN_CONTRAST : true;
  const momentReads = hasInverse ? contrastRatio(draft.inverseGround, draft.inverseInk) >= MIN_CONTRAST : inkReads;
  const brand = draft.name.trim() || "Your brand";
  const tile = (reads: boolean) => `relative aspect-video overflow-hidden rounded border ${reads ? "border-line" : "border-danger ring-2 ring-danger"}`;
  const badge = (reads: boolean) => (reads ? null : <span className="absolute right-1 top-1 rounded bg-danger px-1 text-[9px] font-semibold text-white">won&apos;t read</span>);
  return (
    <div className="sm:col-span-2" data-testid="brand-preview">
      <span className="label">Preview</span>
      <div className="grid grid-cols-2 gap-2">
        <div className={tile(inkReads)} style={{ backgroundColor: ground }} data-testid="brand-preview-cover">
          {badge(inkReads)}
          <div className="absolute left-[5%] top-[7%] h-[12%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={`/api/deck-images/${logo.id}`} alt="" className="h-full w-auto object-contain" /> : <span className="text-[9px] font-semibold" style={{ color: ink, fontFamily: display }}>{brand}</span>}
          </div>
          <div className="absolute left-[5%] top-[32%] w-[90%] text-[13px] font-bold leading-tight" style={{ color: ink, fontFamily: display }}>Your webinar title, in the display face</div>
          <div className="absolute left-[5%] top-[66%] h-[2px] w-[12%]" style={{ backgroundColor: accent }} />
          <div className="absolute left-[5%] top-[74%] text-[8px]" style={{ color: muted, fontFamily: body }}>with the presenter&apos;s name</div>
        </div>
        <div className={tile(inkReads)} style={{ backgroundColor: ground }} data-testid="brand-preview-content">
          {badge(inkReads)}
          <div className="absolute left-[5%] top-[8%] w-[90%] text-[11px] font-bold leading-tight" style={{ color: ink, fontFamily: display }}>A content slide&apos;s headline</div>
          <div className="absolute left-[5%] top-[36%] w-[55%] text-[7px] leading-snug" style={{ color: ink, fontFamily: body }}>
            <div>· The first point, in the body face</div>
            <div>· The second point, muted below it</div>
            <div style={{ color: muted }}>a line in muted</div>
          </div>
          <div className="absolute right-[5%] top-[36%] h-[44%] w-[30%] rounded-sm" style={{ backgroundColor: surface }} />
        </div>
        <div className={tile(momentReads)} style={{ backgroundColor: momentGround }} data-testid="brand-preview-moment">
          {badge(momentReads)}
          <div className="absolute inset-x-[8%] top-[34%] text-center text-[13px] font-bold leading-tight" style={{ color: momentInk, fontFamily: display }}>One line, a moment slide</div>
          <div className="absolute bottom-[14%] left-[44%] h-[2px] w-[12%]" style={{ backgroundColor: accent }} />
        </div>
        <div className={tile(true)} style={{ backgroundColor: ground }} data-testid="brand-preview-footer">
          <div className="absolute left-[5%] top-[14%] w-[90%] text-[9px] font-bold" style={{ color: ink, fontFamily: display }}>The footer band</div>
          <div className="absolute inset-x-0 bottom-0 flex h-[16%] items-center justify-between px-[4%] text-[7px]" style={{ backgroundColor: surface, color: muted, fontFamily: body }}>
            <span>{brand}</span>
            <span className="rounded px-1 font-semibold" style={{ backgroundColor: accent, color: ground }}>a button</span>
          </div>
        </div>
      </div>
      <span className="mt-1 block text-xs text-ink-3">Drawn from the kit as you type. A face not installed on this computer shows as the fallback here, which is what a reader without it sees too.</span>
    </div>
  );
}
