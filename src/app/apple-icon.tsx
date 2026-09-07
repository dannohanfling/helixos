import { brandIcon } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS ignores the manifest and takes this for the home-screen tile; it rounds the corners itself. */
export default function AppleIcon() {
  return brandIcon(180, { maskable: true });
}
