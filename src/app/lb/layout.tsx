import type { Metadata, Viewport } from "next";
import { lbFonts } from "@/components/leaderboard/fonts";
import "@/components/leaderboard/board.css";

/**
 * A client's hosted loyalty leaderboard (H-28): /lb/<slug>, outside the member app, no nav, no session. Meant to be shared and
 * to sit inside the client's own page as an iframe: HelixOS sends no frame-ancestors or X-Frame-Options (next.config.ts), so
 * framing already works; if that ever changes, this route needs its exception. Indexable on purpose.
 */
export const metadata: Metadata = { title: { absolute: "Leaderboard" }, referrer: "no-referrer" };

export const viewport: Viewport = { themeColor: "#000000" };

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={lbFonts}>{children}</div>;
}
