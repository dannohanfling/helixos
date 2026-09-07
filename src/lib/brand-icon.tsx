import { ImageResponse } from "next/og";

/**
 * The small mark for favicon, Apple touch icon and manifest icons: the Greek capital Ω in brand gold (#F0C030) on the
 * near-black (#111318). A text glyph, not a redraw of the logo artwork; the meander ring does not survive small sizes.
 */
export function brandIcon(size: number, opts: { maskable?: boolean } = {}): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111318",
          borderRadius: opts.maskable ? 0 : size * 0.22,
          color: "#F0C030",
          fontSize: opts.maskable ? size * 0.56 : size * 0.68,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        Ω
      </div>
    ),
    { width: size, height: size },
  );
}
