/**
 * The Evolve Omega logo, as supplied. Two variants and one rule: light surfaces get the black-ring artwork, dark surfaces the
 * all-gold on-dark one (the black ring vanishes on dark). The app follows the viewer's colour scheme, so every instance is a
 * <picture> that swaps on prefers-color-scheme, always served at 2× the size it renders. The email uses the light variant
 * flattened onto white and lives in public/email; a different surface with different rules, and the two are not unified.
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

/**
 * The in-app mark: the real logo, no container (it is already a circular medallion; a circle inside a rounded square is two
 * competing containers). 40px in the sidebar and the mobile header, 96px on a loading state, from the 2× files.
 */
export function AppLogo({ size, className = "" }: { size: 40 | 80 | 96; className?: string }) {
  const file = size <= 40 ? 80 : size <= 80 ? 160 : 320;
  return (
    <picture className={`shrink-0 ${className}`}>
      <source srcSet={`/brand/app-logo-ondark-${file}.png`} media="(prefers-color-scheme: dark)" />
      <img src={`/brand/app-logo-light-${file}.png`} width={size} height={size} alt="Evolve Omega" decoding="async" data-testid="app-logo" />
    </picture>
  );
}
