import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_DESCRIPTION } from "@/lib/brand";
import { NativeBridge } from "@/components/pwa/native-bridge";

export const metadata: Metadata = {
  title: { default: "HelixOS", template: "%s · HelixOS" },
  description: APP_DESCRIPTION,
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
  // The safe-area insets are real only under viewport-fit=cover (H-1043): the bottom bar pads by the home indicator's inset.
  viewportFit: "cover",
  // Pinch-zoom stays on: 200% zoom is a baseline for low-vision members. The top and bottom bars are pinned to the visual
  // viewport by PinToViewport so they hold still while the content scales.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        {/* The store apps (H-877): does nothing on the website. */}
        <NativeBridge />
      </body>
    </html>
  );
}
