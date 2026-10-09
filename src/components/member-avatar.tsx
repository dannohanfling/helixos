/**
 * A member's face where the app shows who someone is (client headshots, Danno 8 Oct): their profile photo, read through the
 * signed-in route, or their emoji when they have none. The photo's address carries the membership id only; the route decides
 * who may see it. `version` changes when the photo does, so a new one shows at once.
 */
export function MemberAvatar({ membershipId, hasPhoto, emoji, size = 32, version, name }: { membershipId: string; hasPhoto: boolean; emoji: string | null | undefined; size?: number; version?: string | null; name?: string }) {
  if (!hasPhoto) return <span className="grid shrink-0 place-items-center rounded-full bg-surface-2" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }} data-testid="member-avatar" data-photo="0">{emoji ?? "🧭"}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in route; next/image cannot fetch it
    <img src={`/api/headshots/${membershipId}${version ? `?v=${encodeURIComponent(version)}` : ""}`} alt={name ? `${name}'s photo` : "Profile photo"} width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} loading="lazy" decoding="async" data-testid="member-avatar" data-photo="1" />
  );
}
