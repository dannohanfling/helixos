import type { MetadataRoute } from "next";

/** Add-to-home-screen: HelixOS opens on Today as a standalone app, in the brand colours, with the drawn mark as its icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HelixOS",
    short_name: "HelixOS",
    description: "Your daily operating system: lock in, do the work, close the day.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f1",
    theme_color: "#f6f5f1",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/192?maskable=1", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
