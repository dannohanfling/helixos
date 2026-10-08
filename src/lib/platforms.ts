/**
 * The platforms a member works in beside HelixOS (Danno, 7 Oct): outbound links only, shown to coaches, clients and team
 * members alike, in the sidebar's Platforms section and on the phone's Everything menu. One list, so another platform is one
 * line here and nowhere else. Each opens in a new tab and reaches no HelixOS data.
 */
export type Platform = { href: string; label: string; line: string; icon: string };

export const PLATFORMS: Platform[] = [
  { href: "https://communityloyalty.io", label: "Community Loyalty", line: "your chatbot and automations", icon: "🤖" },
  { href: "https://academy.evolveomega.com", label: "Academy", line: "courses and community", icon: "🎓" },
  { href: "https://app.evolveomega.com", label: "Omnichannel Marketing System", line: "CRM, calendar, funnels", icon: "💸" },
];
