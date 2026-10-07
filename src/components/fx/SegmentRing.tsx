import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface RingSegment {
  /** Stabilan ključ (npr. rang kategorije). */
  key: string | number;
  /** Naziv za opis i legendu (npr. „Umeren“). */
  label: string;
  /** Količina (npr. broj stanica); 0 se ne crta. */
  value: number;
  /** Boja – token, npr. `catVar(rank)`. */
  color: string;
}

export interface SegmentRingProps {
  segments: RingSegment[];
  /** Prečnik u px (podrazumevano 168). */
  size?: number;
  /** Debljina prstena u px (podrazumevano ~9 % prečnika). */
  thickness?: number;
  /** Razmak između segmenata u px duž kruga (podrazumevano 2). */
  gap?: number;
  /**
   * Naslov opisa za čitače ekrana, npr. „Raspodela svežih stanica po kategoriji“.
   * Komponenta dodaje „Umeren 21, Prihvatljiv 4 …“.
   */
  label: string;
  /** Sadržaj u centru (npr. „25 / 26 stanica“). */
  children?: ReactNode;
  className?: string;
}

/**
 * Segmentirani prsten (udeo celine, ≤ 6 segmenata): segmenti redom od vrha u smeru
 * kazaljke, sa razmakom od 2 px u boji površine (bez obruba). Pri montiranju se segmenti
 * iscrtavaju jedan za drugim (≤ 0,7 s); pri promeni vrednosti glatko prelaze.
 * Pristupačni opis nabraja segmente sa vrednostima (boja nikad nije jedini nosilac).
 */
export function SegmentRing({ segments, size = 168, thickness, gap = 2, label, children, className }: SegmentRingProps) {
  const stroke = thickness ?? Math.max(6, Math.round(size * 0.09));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((segment) => segment.value > 0 && Number.isFinite(segment.value));
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  const gapLength = visible.length > 1 ? gap : 0;
  const description = `${label}: ${
    visible.length ? visible.map((segment) => `${segment.label} ${segment.value}`).join(', ') : 'nema podataka'
  }`;

  let cursor = 0;
  const arcs = visible.map((segment, index) => {
    const share = segment.value / total;
    const length = Math.max(0.5, share * circumference - gapLength);
    const arc = { segment, length, start: cursor, index };
    cursor += share * circumference;
    return arc;
  });

  return (
    <div className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} role="img" aria-label={description}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden data-mark>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--grid)" strokeWidth={stroke} />
        {arcs.map(({ segment, length, start, index }) => (
          <circle
            key={segment.key}
            className="seg-arc"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={stroke}
            strokeDasharray={`${length} ${circumference}`}
            strokeDashoffset={-start}
            style={{ '--seg-c': `${circumference}px`, animationDelay: `${index * 70}ms` } as CSSProperties}
          />
        ))}
      </svg>
      {children !== undefined ? <div className="relative grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}
