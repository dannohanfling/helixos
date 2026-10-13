import type { Metadata, Viewport } from "next";
import { hermesFonts } from "@/components/hermes/fonts";
import "@/components/hermes/hermes.css";

/**
 * Hermes: the HelixOS-hosted Magic funnel pages (/mf/<code>, /mf/w/<webinar>). Their own layout, outside the member app: no nav,
 * no session, the gold look. Every page here is noindex.
 */
export const metadata: Metadata = {
  title: { absolute: "Inner Circle call with Danno Hanfling" },
  description: "A live, hands-on Inner Circle call with Danno Hanfling.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#030100" };

export default function HermesLayout({ children }: { children: React.ReactNode }) {
  return <div className={hermesFonts}>{children}</div>;
}
