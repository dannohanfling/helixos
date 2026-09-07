/**
 * The Evolve Omega logo, as supplied: the black-ring artwork on light surfaces, the gold-ring version on dark ones, served
 * at 2× for the size it renders. For anything under about 64px use the Ω glyph (BrandMark); the ring turns to mush.
 */
export function BrandLogo({ size = 128, className = "" }: { size?: 64 | 96 | 128 | 160 | 256 | 512; className?: string }) {
  const file = size <= 64 ? 128 : size <= 128 ? 256 : size <= 256 ? 512 : 1024;
  return (
    <picture className={className}>
      <source srcSet={`/brand/evolve-omega-logo-on-dark-${file}.png`} media="(prefers-color-scheme: dark)" />
      <img src={`/brand/evolve-omega-logo-${file}.png`} width={size} height={size} alt="Evolve Omega" decoding="async" />
    </picture>
  );
}

/** The small mark: the Greek capital omega in brand gold on the near-black tile. The only permitted derivative of the logo. */
export function BrandMark({ className = "h-8 w-8 text-lg" }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-lg font-black ${className}`} style={{ background: "#111318", color: "#F0C030" }} aria-hidden="true">
      Ω
    </span>
  );
}
