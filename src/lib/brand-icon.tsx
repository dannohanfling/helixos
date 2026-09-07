import { ImageResponse } from "next/og";

/**
 * The HelixOS mark, drawn with boxes so no font is needed: an H on the accent ground, with the crossbar offset like a
 * helix rung. Used for the favicon, the Apple touch icon and the manifest icons at any size.
 */
export function brandIcon(size: number, opts: { maskable?: boolean } = {}): ImageResponse {
  // Maskable icons keep the mark inside the safe zone (the inner 80%); a plain icon can use its rounded corners.
  const pad = opts.maskable ? size * 0.2 : size * 0.12;
  const bar = size * 0.14;
  const inner = size - pad * 2;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #b7791f 0%, #7a4f0f 100%)",
          borderRadius: opts.maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ position: "relative", width: inner, height: inner, display: "flex" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: bar, height: inner, background: "#fbf0d9", borderRadius: bar / 2 }} />
          <div style={{ position: "absolute", right: 0, top: 0, width: bar, height: inner, background: "#fbf0d9", borderRadius: bar / 2 }} />
          <div style={{ position: "absolute", left: bar * 0.6, top: inner * 0.36, width: inner - bar * 1.2, height: bar * 0.9, background: "#ffffff", borderRadius: bar / 2, transform: "rotate(-12deg)" }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
