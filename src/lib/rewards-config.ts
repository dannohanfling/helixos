import { existsSync, readFileSync } from "node:fs";
import committed from "@/data/rewards-config.json";
import type { RewardsConfig } from "@/lib/engine/rewards";

/**
 * The booking links and the cap-period choice, from src/data/rewards-config.json. Development and smoke walks only:
 * REWARDS_CONFIG_OVERRIDE names a JSON file read on every call, so a walk can hand one reward a link without touching the
 * committed file. Ignored in production by design; never remove the NODE_ENV condition.
 */
export function loadRewardsConfig(): RewardsConfig {
  const override = process.env.NODE_ENV !== "production" ? process.env.REWARDS_CONFIG_OVERRIDE : undefined;
  if (override && existsSync(override)) {
    try {
      const parsed = JSON.parse(readFileSync(override, "utf8")) as Partial<RewardsConfig>;
      return { perMonth: parsed.perMonth ?? committed.perMonth, bookingLinks: { ...committed.bookingLinks, ...(parsed.bookingLinks ?? {}) }, calendarIds: { ...committed.calendarIds, ...(parsed.calendarIds ?? {}) } } as RewardsConfig;
    } catch {
      /* a broken override file falls back to the committed config */
    }
  }
  return committed as RewardsConfig;
}
