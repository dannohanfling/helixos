import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Evolve Omega · HelixOS";

/** The card a coach's invite link shows in a DM or a text: the supplied logo, unstretched, on a solid near-black. */
export default async function OpenGraphImage() {
  const png = await readFile(path.join(process.cwd(), "public/brand/evolve-omega-logo-on-dark-512.png"));
  const src = `data:image/png;base64,${png.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: "#111318" }}>
        <img src={src} width={480} height={480} alt="" />
      </div>
    ),
    size,
  );
}
