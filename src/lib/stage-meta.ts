import type { CONTACT_STAGES } from "@/db/schema";

export const STAGE_META: Record<(typeof CONTACT_STAGES)[number], { label: string; tone: "neutral" | "accent" | "good" | "warn" | "danger" }> = {
  new: { label: "Reached out", tone: "neutral" },
  replied: { label: "Replied", tone: "accent" },
  conversation: { label: "In conversation", tone: "accent" },
  call_booked: { label: "Call booked", tone: "good" },
  no_show: { label: "No-show", tone: "warn" },
  client: { label: "Client", tone: "good" },
  cold: { label: "Cold", tone: "neutral" },
};
