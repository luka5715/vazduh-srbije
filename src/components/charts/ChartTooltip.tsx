import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface ChartTooltipProps {
  /** Pozicija u pikselima unutar relativnog kontejnera grafikona. */
  x: number;
  y: number;
  /** Širina kontejnera – tooltip se prebacuje levo kad bi iskočio udesno. */
  containerWidth: number;
  /**
   * `below` (podrazumevano): gornja ivica tooltip-a je na `y` (kao do sada);
   * `above`: donja ivica je na `y` (iznad tačke, npr. ćelije toplotne mape);
   * `beside`: vertikalno centriran na `y`, pored tačke (sparkline u pločici – ne pokriva
   * natpis i vrednost iznad grafikona).
   */
  placement?: 'below' | 'above' | 'beside';
  children: ReactNode;
}

/**
 * HTML tooltip iznad SVG grafikona, u staklenom stilu (overlay sme da ima backdrop-filter).
 * Sadržaj ubacuje React (nikad innerHTML). Vrednost je jaka, naziv serije sekundaran;
 * ne hvata pokazivač.
 */
export function ChartTooltip({ x, y, containerWidth, placement = 'below', children }: ChartTooltipProps) {
  const flip = x > containerWidth * 0.55;
  return (
    <div
      role="presentation"
      className={cn(
        'pointer-events-none absolute z-30 min-w-[140px] max-w-[260px] rounded-ctl border border-border-strong px-3 py-2 text-xs text-ink shadow-float',
        'bg-[color-mix(in_oklab,var(--panel-solid)_86%,transparent)] backdrop-blur-md',
      )}
      style={{
        left: flip ? undefined : Math.round(x) + 14,
        right: flip ? Math.max(0, Math.round(containerWidth - x)) + 14 : undefined,
        top: placement === 'below' ? Math.max(0, Math.round(y)) : placement === 'beside' ? Math.round(y) : undefined,
        bottom: placement === 'above' ? `calc(100% - ${Math.round(y)}px)` : undefined,
        transform: placement === 'beside' ? 'translateY(-50%)' : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** Red u tooltip-u: oznaka serije (kratka linija/tačka u boji) + naziv + vrednost. */
export function TooltipRow({ swatch, label, value, muted = false }: { swatch?: ReactNode; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className={cn('flex min-w-0 items-center gap-1.5', muted ? 'text-faint' : 'text-muted')}>
        {swatch}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('tnum shrink-0 font-semibold', muted ? 'text-faint' : 'text-ink')}>{value}</span>
    </div>
  );
}

/** Kratka linija u boji serije – ključ za linijske grafikone. */
export function LineKey({ color }: { color: string }) {
  return <span aria-hidden data-mark className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

/** Kvadratić u boji serije – ključ za stubove i površine. */
export function RectKey({ color }: { color: string }) {
  return <span aria-hidden data-mark className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
}
