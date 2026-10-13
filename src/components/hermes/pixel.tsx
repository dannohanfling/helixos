import { pixelBeacon } from "@/lib/hermes/rules";

/**
 * The Meta Pixel, as its no-script image beacon: one request carrying the pixel id and the event name only, no script, no
 * cookie set by this page and no personal data. Rendered only where Danno switched it on, on the cold page and the confirmation.
 */
export function Pixel({ id, event }: { id: string; event: "PageView" | "CompleteRegistration" }) {
  // eslint-disable-next-line @next/next/no-img-element -- Meta's tracking beacon, not a picture: next/image would proxy it.
  return <img className="hm-pixel" src={pixelBeacon(id, event)} width={1} height={1} alt="" referrerPolicy="no-referrer-when-downgrade" data-testid={`hm-pixel-${event}`} />;
}
