import type { Metadata, Viewport } from "next";
import { hermesFonts } from "@/components/hermes/fonts";
import { siteUrl } from "@/lib/app-url";
import { FUNNEL_DESCRIPTION, FUNNEL_TITLE } from "@/lib/hermes/funnel";
import "@/components/hermes/funnel/funnel.css";

/**
 * Hermes, Funnel 1 (H-674, plan H-721): the public page that sells starting with Danno, at /start. Its own layout, outside the
 * member app: no nav, no session, the gold look. Indexable, unlike the personal funnel pages: it is a sales page.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { absolute: FUNNEL_TITLE },
  description: FUNNEL_DESCRIPTION,
  alternates: { canonical: "/start" },
  openGraph: { title: FUNNEL_TITLE, description: FUNNEL_DESCRIPTION, url: "/start", siteName: "HelixOS", type: "website" },
  twitter: { card: "summary_large_image", title: FUNNEL_TITLE, description: FUNNEL_DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#030100" };

export default function FunnelLayout({ children }: { children: React.ReactNode }) {
  return <div className={hermesFonts}>{children}</div>;
}
