import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface RingGaugeProps {
  /** Popunjenost 0–1 (vrednosti van opsega se ograničavaju). */
  value: number;
  /** Boja luka – token, npr. `catVar(2)`, `'var(--accent)'`, `'var(--haze)'`. */
  color?: string;
  /** Prečnik u px (podrazumevano 64). */
  size?: number;
  /** Debljina luka u px (podrazumevano ~11 % prečnika, najmanje 4). */
  thickness?: number;
  /** Boja staze (podrazumevano blagi korak iste boje preko `--grid`). */
  track?: string;
  /** Opis za čitače ekrana (npr. „25 od 26 stanica javlja“). Bez opisa prsten je dekorativan. */
  label?: string;
  /** Sadržaj u centru (broj, ikona). */
  children?: ReactNode;
  className?: string;
}

/**
 * Prstenasti merač: staza + luk koji kreće od vrha u smeru kazaljke. Pri montiranju se
 * luk „puni“ (0,7 s), a pri promeni vrednosti glatko prelazi (stroke-dashoffset).
 * Uz smanjeno kretanje (globalni CSS blok) odmah stoji na vrednosti.
 */
export function RingGauge({ value, color = 'var(--accent)', size = 64, thickness, track, label, children, className }: RingGaugeProps) {
  const stroke = thickness ?? Math.max(4, Math.round(size * 0.11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const offset = circumference * (1 - clamped);
  const trackColor = track ?? `color-mix(in oklab, ${color} 16%, var(--grid))`;

  return (
    <div
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden data-mark>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
        {clamped > 0 ? (
          <circle
            className="ring-arc"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap={clamped >= 1 ? 'butt' : 'round'}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ '--ring-from': `${circumference}px` } as CSSProperties}
          />
        ) : null}
      </svg>
      {children !== undefined ? <div className="relative grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}
