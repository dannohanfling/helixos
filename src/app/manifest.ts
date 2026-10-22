import type { MetadataRoute } from "next";
import { APP_DESCRIPTION } from "@/lib/brand";

/** Add-to-home-screen: HelixOS opens on Today as a standalone app, in the brand colours, with the Evolve Omega medallion as its icon (H-667). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HelixOS",
    short_name: "HelixOS",
    description: APP_DESCRIPTION,
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f1",
    theme_color: "#f6f5f1",
    icons: [
      { src: "/app-icon/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/app-icon/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
