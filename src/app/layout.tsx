import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HelixOS", template: "%s · HelixOS" },
  description: "Your daily operating system: content, conversations, tasks, and the pathway that grows your business.",
  applicationName: "HelixOS",
  manifest: "/manifest.webmanifest",
  // Installed to an iPhone home screen it runs full-screen under its own name, not as a Safari tab.
  appleWebApp: { capable: true, title: "HelixOS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
  ],
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays on: 200% zoom is a baseline for low-vision members. The top and bottom bars are pinned to the visual
  // viewport by PinToViewport so they hold still while the content scales.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
