import { cn } from '@/lib/cn';

export interface ShimmerProps {
  className?: string;
  /** Zaobljenje: `ctl` (10 px), `tile` (14 px), `panel` (20 px) ili `full`. */
  rounded?: 'ctl' | 'tile' | 'panel' | 'full';
}

/**
 * Skelet za učitavanje sa svetlucanjem (dekorativan, aria-hidden). Roditelj nosi
 * `aria-busy` i opis. Pri ponovnom učitavanju se NE prikazuje – stari prikaz ostaje prigušen.
 */
export function Shimmer({ className, rounded = 'ctl' }: ShimmerProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'skeleton h-4 w-full',
        rounded === 'ctl' && 'rounded-ctl',
        rounded === 'tile' && 'rounded-tile',
        rounded === 'panel' && 'rounded-panel',
        rounded === 'full' && 'rounded-full',
        className,
      )}
    />
  );
}
