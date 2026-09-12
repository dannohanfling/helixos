"use client";

import type { Channel } from "@/lib/engine/repurpose";
import type { Draft, Target } from "@/lib/engine/compose";

export type Persona = { name: string; handle: string; avatar: string; business: string };

function Avatar({ p, size = 36 }: { p: Persona; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-lg" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {p.avatar}
    </span>
  );
}

type MediaKind = "image" | "video";

function Media({ url, kind = "image", ratio = "16 / 9", hint = "Add a photo or video and it shows here" }: { url?: string; kind?: MediaKind; ratio?: string; hint?: string }) {
  return url && kind === "video" ? (
    <video src={url} muted playsInline controls preload="metadata" className="w-full rounded-md bg-ink object-cover" style={{ aspectRatio: ratio }} />
  ) : url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="w-full rounded-md object-cover" style={{ aspectRatio: ratio }} />
  ) : (
    <div className="grid place-items-center rounded-md bg-surface-2 text-center text-xs text-ink-3" style={{ aspectRatio: ratio }}>
      <span>
        <span className="block text-2xl">🖼️</span>
        {hint}
      </span>
    </div>
  );
}

function Text({ body, clamp }: { body: string; clamp?: number }) {
  const shown = clamp && body.length > clamp ? body.slice(0, clamp).trimEnd() : body;
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
      {shown}
      {clamp && body.length > clamp ? <span className="text-ink-3"> … more</span> : null}
    </p>
  );
}

const Bar = ({ items }: { items: string[] }) => (
  <div className="mt-2 flex items-center justify-around border-t pt-2 text-[11px] text-ink-3">
    {items.map((i) => (
      <span key={i}>{i}</span>
    ))}
  </div>
);

function Facebook({ p, d, media, mediaKind, where }: { p: Persona; d: Draft; media?: string; mediaKind?: MediaKind; where?: string }) {
  return (
    <div className="rounded-xl border bg-surface p-3">
      <div className="flex items-center gap-2">
        <Avatar p={p} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">
            {p.name}
            {where ? <span className="font-normal text-ink-3"> ▸ {where}</span> : null}
          </div>
          <div className="text-[11px] text-ink-3">Just now · 🌎</div>
        </div>
      </div>
      <div className="mt-2">
        <Text body={d.body} clamp={420} />
      </div>
      {media ? (
        <div className="mt-2">
          <Media url={media} kind={mediaKind} />
        </div>
      ) : null}
      <Bar items={["👍 Like", "💬 Comment", "↗ Share"]} />
    </div>
  );
}

function Instagram({ p, d, media, mediaKind }: { p: Persona; d: Draft; media?: string; mediaKind?: MediaKind }) {
  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <Avatar p={p} size={30} />
          <span className="text-sm font-semibold">{p.handle}</span>
        </div>
        <span className="text-ink-3">···</span>
      </div>
      <Media url={media} kind={mediaKind} ratio="1 / 1" hint="Make your post stand out with a photo or reel" />
      <div className="p-3">
        <div className="flex items-center justify-between text-base">
          <span>♡ &nbsp;💬 &nbsp;➤</span>
          <span>🔖</span>
        </div>
        <div className="mt-2 text-[13px]">
          <span className="font-semibold">{p.handle}</span> <Text body={d.body} clamp={125} />
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-3">Just now</div>
      </div>
    </div>
  );
}

function Threads({ p, d, media, mediaKind }: { p: Persona; d: Draft; media?: string; mediaKind?: MediaKind }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-surface p-3">
      <Avatar p={p} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{p.handle}</span>
          <span className="text-[11px] text-ink-3">now ···</span>
        </div>
        <div className="mt-1">
          <Text body={d.body} />
        </div>
        {media ? (
          <div className="mt-2">
            <Media url={media} kind={mediaKind} ratio="4 / 3" />
          </div>
        ) : null}
        <div className="mt-2 text-sm text-ink-3">♡ &nbsp; 💬 &nbsp; ↻ &nbsp; ➤</div>
      </div>
    </div>
  );
}

function LinkedIn({ p, d, media, mediaKind }: { p: Persona; d: Draft; media?: string; mediaKind?: MediaKind }) {
  return (
    <div className="rounded-xl border bg-surface p-3">
      <div className="flex items-center gap-2">
        <Avatar p={p} size={44} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">{p.name}</div>
          <div className="text-[11px] text-ink-3">{p.business}</div>
          <div className="text-[11px] text-ink-3">Now · 🌐</div>
        </div>
      </div>
      <div className="mt-2">
        <Text body={d.body} clamp={210} />
      </div>
      {media ? (
        <div className="mt-2">
          <Media url={media} kind={mediaKind} />
        </div>
      ) : null}
      <Bar items={["👍 Like", "💬 Comment", "↻ Repost", "➤ Send"]} />
    </div>
  );
}

function Email({ p, d }: { p: Persona; d: Draft }) {
  return (
    <div className="rounded-xl border bg-surface">
      <div className="border-b p-3 text-[12px]">
        <div className="text-base font-semibold">{d.subject || "(no subject yet)"}</div>
        <div className="mt-1 text-ink-3">
          <span className="font-medium text-ink">{p.name}</span> &lt;you@{p.business.toLowerCase().replace(/[^a-z]+/g, "") || "yourbusiness"}.com&gt; · to me
        </div>
      </div>
      <div className="p-3">
        <Text body={d.body} />
      </div>
    </div>
  );
}

function Stories({ d, media }: { d: Draft; media?: string }) {
  const frames = d.body
    .split(/\n\n+/)
    .map((f) => f.replace(/^Frame \d+:\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return (
    <div className="grid grid-cols-3 gap-2">
      {(frames.length ? frames : ["Your first frame"]).map((f, i) => (
        <div key={i} className="relative grid place-items-center overflow-hidden rounded-xl bg-ink p-3 text-center text-bg" style={{ aspectRatio: "9 / 16", backgroundImage: media ? `url(${media})` : undefined, backgroundSize: "cover" }}>
          <div className="absolute inset-x-2 top-2 flex gap-1">
            {[0, 1, 2].map((j) => (
              <span key={j} className="h-0.5 flex-1 rounded" style={{ background: j <= i ? "var(--bg)" : "color-mix(in oklab, var(--bg) 40%, transparent)" }} />
            ))}
          </div>
          <span className="rounded bg-ink/70 px-1.5 py-1 text-[12px] font-semibold leading-snug">{f}</span>
        </div>
      ))}
    </div>
  );
}

function Skool({ p, d, title }: { p: Persona; d: Draft; title: string }) {
  return (
    <div className="rounded-xl border bg-surface p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <Avatar p={p} size={24} />
        <span className="font-medium text-ink">{p.name}</span> · now · General
      </div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <div className="mt-1">
        <Text body={d.body} clamp={260} />
      </div>
      <Bar items={["👍 0", "💬 0 comments", "📌 Pin"]} />
    </div>
  );
}

export function ChannelPreview({ t, d, p, media, mediaKind, title }: { t: Target; d: Draft; p: Persona; media?: string; mediaKind?: MediaKind; title: string }) {
  const ch: Channel = t.channel;
  if (t.group) return <Facebook p={p} d={d} media={media} mediaKind={mediaKind} where={t.group.name} />;
  switch (ch) {
    case "instagram":
      return <Instagram p={p} d={d} media={media} mediaKind={mediaKind} />;
    case "threads":
      return <Threads p={p} d={d} media={media} mediaKind={mediaKind} />;
    case "linkedin":
      return <LinkedIn p={p} d={d} media={media} mediaKind={mediaKind} />;
    case "email":
      return <Email p={p} d={d} />;
    case "stories":
      return <Stories d={d} media={media} />;
    case "skool":
      return <Skool p={p} d={d} title={title} />;
    case "fb_page":
      return <Facebook p={{ ...p, name: p.business || p.name }} d={d} media={media} mediaKind={mediaKind} />;
    case "fb_group":
      return <Facebook p={p} d={d} media={media} mediaKind={mediaKind} where="Your group" />;
    default:
      return <Facebook p={p} d={d} media={media} mediaKind={mediaKind} />;
  }
}
