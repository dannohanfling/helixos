import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireViewer } from "@/lib/auth";
import { streakFor } from "@/lib/queries/daily";
import { totalPoints } from "@/lib/queries/points";
import { LevelUp } from "@/components/level-up";
import { TIER_ICONS, tierFor } from "@/lib/engine/tiers";

// Every page here is per-user and reads the session cookie. Never prerender it, and never let the build touch the database.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const [points, streak] = await Promise.all([totalPoints(viewer.workspace.id, viewer.user.id), streakFor(viewer.workspace.id, viewer.user.id, viewer.today)]);
  const tier = tierFor(points);
  return (
    <AppShell viewer={viewer} points={points} streak={streak.running}>
      {children}
      {viewer.role === "client" ? <LevelUp tier={{ level: tier.level, name: tier.name, icon: TIER_ICONS[tier.name] ?? "🏅", welcome: tier.welcome }} celebrated={viewer.membership.celebratedTierLevel} /> : null}
    </AppShell>
  );
}
