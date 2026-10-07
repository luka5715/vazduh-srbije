import { cn } from '@/lib/cn';

export interface LiveDotProps {
  /** Boja tačke – token (podrazumevano `var(--ok)`). */
  color?: string;
  /** Prečnik u px (podrazumevano 8). */
  size?: number;
  /** Pulsirajući prsten (isključen = mirna tačka, npr. kad nema svežih podataka). */
  pulse?: boolean;
  className?: string;
}

/**
 * Tačka „uživo“ sa talasom koji se širi i gasi. Dekorativna (aria-hidden): tekst pored
 * nje nosi značenje. Uz smanjeno kretanje talas se ne prikazuje (globalni CSS blok).
 */
export function LiveDot({ color = 'var(--ok)', size = 8, pulse = true, className }: LiveDotProps) {
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      {pulse ? (
        <span
          className="absolute inset-0 rounded-full motion-safe:animate-pulse-live"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="absolute inset-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 ${size}px ${color}` }} />
    </span>
  );
}
