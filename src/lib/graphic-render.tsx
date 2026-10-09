/* eslint-disable @next/next/no-img-element -- these <img> are the renderer's elements (Satori), never the DOM */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { FADE, FADE_STRONG, GRAPHIC, MASTER_HEIGHT, MASTER_WIDTH, READ_COMMENTS, goldGradient, layoutHeadline } from "@/lib/engine/graphic";

/**
 * Make the graphic, the render (rev 513): the approved template as a PNG master at 2× (rev 514), drawn by Next's own image
 * renderer (Satori and Resvg) with Anton, Playfair Display and Inter bundled in src/fonts, so nothing is fetched at render
 * time. Every number is the template's, scaled by two. The photo and the avatar arrive as bytes and leave as data URIs; they
 * never touch a public address here.
 */
const FONT_DIR = path.join(process.cwd(), "src", "fonts");
let fonts: { name: string; data: Buffer; weight: 400 | 500 | 700 | 900; style: "normal" }[] | null = null;
let hand: string | null = null;
function loadFonts() {
  fonts ??= [
    { name: "Anton", data: readFileSync(path.join(FONT_DIR, "anton-latin-400-normal.woff")), weight: 400, style: "normal" },
    { name: "Playfair Display", data: readFileSync(path.join(FONT_DIR, "playfair-display-latin-900-normal.woff")), weight: 900, style: "normal" },
    { name: "Inter", data: readFileSync(path.join(FONT_DIR, "inter-latin-700-normal.woff")), weight: 700, style: "normal" },
    { name: "Inter", data: readFileSync(path.join(FONT_DIR, "inter-latin-500-normal.woff")), weight: 500, style: "normal" },
  ];
  hand ??= `data:image/svg+xml;base64,${readFileSync(path.join(FONT_DIR, "twemoji-1f447.svg")).toString("base64")}`;
  return { fonts, hand };
}

export type RenderInput = {
  headline: string;
  /** The photo's bytes, or null for a plain black ground (rev 524: no photo fits and no background may be made). */
  photo: Buffer | null;
  strongFade: boolean;
  badge: { avatar: Buffer | null; name: string; handle: string; verified: boolean };
  gold: { from?: string | null; to?: string | null };
};

/** A picture as a data URI the renderer takes, no larger than the frame it fills (a phone photo is many megabytes; the master needs 2160 across). */
async function uri(bytes: Buffer, width: number, height: number): Promise<string> {
  const out = await sharp(bytes, { animated: false }).rotate().resize({ width, height, fit: "cover", position: "attention", withoutEnlargement: false }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/** The master PNG, 2160×2700. */
export async function renderGraphic(input: RenderInput): Promise<Buffer> {
  const { fonts, hand } = loadFonts();
  const s = GRAPHIC.scale;
  const W = MASTER_WIDTH;
  const H = MASTER_HEIGHT;
  const gold = goldGradient(input.gold.from, input.gold.to);
  const { lines, px } = layoutHeadline(input.headline);
  const photo = input.photo ? await uri(input.photo, W, GRAPHIC.photoHeight * s) : null;
  const avatar = input.badge.avatar ? await uri(input.badge.avatar, GRAPHIC.avatarPx * s * 2, GRAPHIC.avatarPx * s * 2) : null;
  // The gold fill is the gradient clipped to the letters; a shadow inherited from the line paints over it (9 Oct: the phrase
  // came out dull, or black), so the shadow sits on the white words alone.
  const shadow = `0 ${3 * s}px ${12 * s}px rgba(0,0,0,0.6)`;
  const goldText = { backgroundImage: gold, backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent" } as const;
  const res = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: "#000", position: "relative" }}>
        {photo ? <img src={photo} alt="" style={{ position: "absolute", top: 0, left: 0, width: W, height: GRAPHIC.photoHeight * s, objectFit: "cover", objectPosition: GRAPHIC.photoFocus }} /> : <div style={{ position: "absolute", top: 0, left: 0, width: W, height: GRAPHIC.photoHeight * s, background: "linear-gradient(180deg, #2a2a2a 0%, #0a0a0a 100%)" }} />}
        <div style={{ position: "absolute", top: GRAPHIC.fadeTop * s, left: 0, width: W, height: GRAPHIC.fadeHeight * s, background: input.strongFade ? FADE_STRONG : FADE }} />
        <div style={{ position: "absolute", top: (GRAPHIC.fadeTop + GRAPHIC.fadeHeight) * s, left: 0, width: W, height: H - (GRAPHIC.fadeTop + GRAPHIC.fadeHeight) * s, background: "#000" }} />
        <div style={{ position: "absolute", left: 0, width: W, bottom: GRAPHIC.headlineBottom * s, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: "Anton", fontSize: px * s, lineHeight: GRAPHIC.lineHeight, color: "#fff" }}>
          {lines.map((segs, i) => (
            <div key={i} style={{ display: "flex", whiteSpace: "nowrap" }}>
              {segs.map((seg, j) => (
                <span key={j} style={seg.gold ? { ...goldText, whiteSpace: "pre" } : { whiteSpace: "pre", textShadow: shadow }}>{seg.text}</span>
              ))}
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", top: GRAPHIC.readTop * s, left: 0, width: W, display: "flex", justifyContent: "center", alignItems: "center", fontFamily: "Playfair Display", fontWeight: 900, fontSize: GRAPHIC.readPx * s }}>
          <span style={goldText}>{READ_COMMENTS}</span>
          <img src={hand} alt="" style={{ width: GRAPHIC.readPx * s, height: GRAPHIC.readPx * s, marginLeft: 4 * s, marginRight: 4 * s }} />
          <span style={goldText}>)</span>
        </div>
        <div style={{ position: "absolute", top: GRAPHIC.badgeTop * s, left: 0, width: W, display: "flex", justifyContent: "center", alignItems: "center", gap: 14 * s }}>
          {avatar ? <img src={avatar} alt="" style={{ width: GRAPHIC.avatarPx * s, height: GRAPHIC.avatarPx * s, borderRadius: GRAPHIC.avatarPx * s, objectFit: "cover" }} /> : null}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", fontFamily: "Inter", fontWeight: 700, fontSize: GRAPHIC.namePx * s, color: "#fff" }}>
              <span>{input.badge.name}</span>
              {input.badge.verified ? (
                <svg width={GRAPHIC.namePx * s} height={GRAPHIC.namePx * s} viewBox="0 0 24 24" style={{ marginLeft: 6 * s }}>
                  <path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                </svg>
              ) : null}
            </div>
            {input.badge.handle ? <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 500, fontSize: GRAPHIC.handlePx * s, color: "#ddd" }}>{input.badge.handle}</div> : null}
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts },
  );
  return Buffer.from(await res.arrayBuffer());
}

/** The 1080×1350 copy, made when asked (rev 514): the master downscaled with a Lanczos filter, still PNG. */
export async function downscaleGraphic(master: Buffer, width = GRAPHIC.width): Promise<Buffer> {
  return sharp(master).resize({ width, kernel: sharp.kernel.lanczos3 }).png().toBuffer();
}
