import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { useMeasure } from '@/hooks/useMeasure';
import { cn } from '@/lib/cn';
import { formatConcentration } from '@/lib/format';

export interface SparklineProps {
  /** Vrednosti redom (najstarija prva); `null` prekida liniju. */
  values: Array<number | null>;
  /** Opis za čitače ekrana, npr. „Medijana PM10 mreže, poslednja 24 sata, od 31 do 44 µg/m³“. */
  label: string;
  /** Visina crteža u px (podrazumevano 44; sa `annotate` dodaje se mesto za natpise). */
  height?: number;
  /**
   * Boja linije i ispune – token (podrazumevano `var(--accent)`). Za boju kategorije
   * (`var(--cat-N)`) linija i tačke koriste tanku varijantu `var(--cat-mark-N)` (svetla tema:
   * tamnija nijansa ≥ 3 : 1), a ispuna ostaje na boji kategorije.
   */
  color?: string;
  /** Donja granica ose (podrazumevano 0 – površina od nule je poštena). */
  min?: number;
  /** Gornja granica ose (podrazumevano najveća vrednost + 10 %). */
  max?: number;
  /** Tačke i natpisi najveće i najmanje vrednosti. */
  annotate?: boolean;
  /** Formatiranje natpisa (podrazumevano koncentracija: 1 decimala ispod 100, vidi `formatConcentration`). */
  format?: (value: number) => string;
  /** Tačka na poslednjoj vrednosti (podrazumevano da). */
  endDot?: boolean;
  /** Površina ispod linije sa gradijentom (podrazumevano da). */
  fill?: boolean;
  /** Referentna linija (npr. prag), puna tanka linija u `--faint`. */
  reference?: number;
  /**
   * Sadržaj tooltip-a za tačku `index`. Kad je zadat, sparkline dobija hover/fokus
   * očitavanje (vertikalna linija prati pokazivač, strelice levo/desno sa tastature), a isti
   * sadržaj se najavljuje čitačima ekrana (skriveni `aria-live` red) pri kretanju tastaturom.
   */
  tooltip?: (index: number, value: number | null) => ReactNode;
  className?: string;
}

interface Point {
  index: number;
  x: number;
  y: number;
  value: number;
}

/** Tačka vrha/dna bliža od ovoga (u uzorcima ili px) krajnjoj tački se ne crta posebno. */
const NEAR_END_SAMPLES = 2;
const NEAR_END_PX = 10;
/** Uži grafikon od ovoga: tooltip desne strane ide iznad grafikona (ne pokriva liniju). */
const NARROW_TOOLTIP_PX = 260;

/**
 * Mali linijski grafikon za KPI pločice: linija 2 px, ispuna gradijentom (~22 % → 0),
 * iscrtavanje pri montiranju (≤ 0,7 s), opcione tačke vrha i dna sa natpisima u ink boji.
 * Širina prati kontejner (ResizeObserver); oznake su uvek unutar granica. Tačka vrha ili
 * dna uz samu krajnju tačku se ne crta (natpis ostaje), da se kružići ne dodiruju.
 */
export function Sparkline({
  values,
  label,
  height = 44,
  color = 'var(--accent)',
  min,
  max,
  annotate = false,
  format = formatConcentration,
  endDot = true,
  fill = true,
  reference,
  tooltip,
  className,
}: SparklineProps) {
  const gradientId = useId().replace(/:/g, '');
  const mark = color.replace(/^var\(--cat-([0-5])\)$/, 'var(--cat-mark-$1)');
  const [wrapRef, size] = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  /** Tačka najavljena čitačima ekrana – menja se samo sa tastature i pri fokusu, ne pokazivačem. */
  const [spoken, setSpoken] = useState<number | null>(null);
  const width = size.width;
  const padTop = annotate ? 16 : 5;
  const padBottom = annotate ? 16 : 5;
  const padX = 6;
  const totalHeight = height + (annotate ? 24 : 0);

  const geometry = useMemo(() => {
    const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (finite.length === 0 || width <= 0) return null;
    const lo = min ?? Math.min(0, ...finite);
    const hiRaw = max ?? Math.max(...finite, reference ?? Number.NEGATIVE_INFINITY) * 1.1;
    const hi = hiRaw > lo ? hiRaw : lo + 1;
    const n = values.length;
    const step = n > 1 ? (width - padX * 2) / (n - 1) : 0;
    const yOf = (value: number) => padTop + (1 - (Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * (totalHeight - padTop - padBottom);
    const xOf = (index: number) => (n > 1 ? padX + index * step : width / 2);
    const segments: Point[][] = [];
    let current: Point[] = [];
    values.forEach((value, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      current.push({ index, x: xOf(index), y: yOf(value), value });
    });
    if (current.length) segments.push(current);
    const points = segments.flat();
    let peak = points[0];
    let low = points[0];
    for (const point of points) {
      if (point.value > peak.value) peak = point;
      if (point.value < low.value) low = point;
    }
    const baseY = yOf(lo);
    return {
      segments,
      points,
      peak,
      low,
      last: points[points.length - 1],
      baseY,
      xOf,
      yOf,
      referenceY: reference !== undefined ? yOf(reference) : null,
    };
  }, [values, width, min, max, reference, padTop, padBottom, totalHeight]);

  const linePath = (segment: Point[]) => segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  const areaPath = (segment: Point[], baseY: number) =>
    segment.length > 1
      ? `${linePath(segment)}L${segment[segment.length - 1].x.toFixed(1)} ${baseY.toFixed(1)}L${segment[0].x.toFixed(1)} ${baseY.toFixed(1)}Z`
      : '';

  const anchorFor = (x: number) => (x < 22 ? 'start' : x > width - 22 ? 'end' : 'middle');
  const interactive = Boolean(tooltip) && values.length > 0;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !geometry) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const step = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;
    const index = step > 0 ? Math.round((x - padX) / step) : 0;
    setActive(Math.min(values.length - 1, Math.max(0, index)));
  };

  const moveTo = (index: number | null) => {
    setActive(index);
    setSpoken(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const base = active ?? values.length - 1;
      moveTo(Math.min(values.length - 1, Math.max(0, base + (event.key === 'ArrowRight' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveTo(event.key === 'Home' ? 0 : values.length - 1);
    } else if (event.key === 'Escape') {
      moveTo(null);
    }
  };

  const activeValue = active !== null ? values[active] : null;
  const activeX = active !== null && geometry ? geometry.xOf(active) : null;
  const spokenValue = spoken !== null ? (values[spoken] ?? null) : null;

  // Tačke vrha/dna uz krajnju tačku se ne crtaju (natpis ostaje): kružići bi se dodirivali.
  const nearEnd = (point: Point | undefined) =>
    Boolean(
      endDot &&
        point &&
        geometry?.last &&
        (Math.abs(geometry.last.index - point.index) <= NEAR_END_SAMPLES || Math.abs(geometry.last.x - point.x) < NEAR_END_PX),
    );
  const showPeakDot = geometry ? !nearEnd(geometry.peak) : false;
  const showLowDot = geometry ? !nearEnd(geometry.low) : false;

  // Uzan grafikon, tačka u desnih 45 %: tooltip „pored“ bi prekrio liniju levo od tačke, pa
  // ide iznad grafikona (donja ivica na vrhu crteža) – linija i vertikala ostaju vidljive.
  const tooltipAbove = activeX !== null && width < NARROW_TOOLTIP_PX && activeX > width * 0.55;

  return (
    <div
      ref={wrapRef}
      className={cn('relative w-full', interactive && 'cursor-crosshair rounded-[6px]', className)}
      style={{ height: totalHeight }}
      // Interaktivan: grupa (fokus + strelice) sa najavom očitavanja; inače statična slika.
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      tabIndex={interactive ? 0 : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerLeave={interactive ? () => setActive(null) : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      onFocus={interactive ? () => moveTo(active ?? values.length - 1) : undefined}
      onBlur={interactive ? () => moveTo(null) : undefined}
    >
      {geometry ? (
        <svg width={width} height={totalHeight} viewBox={`0 0 ${width} ${totalHeight}`} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {geometry.referenceY !== null ? (
            <line x1={0} x2={width} y1={geometry.referenceY} y2={geometry.referenceY} stroke="var(--faint)" strokeOpacity={0.5} strokeWidth={1} />
          ) : null}
          {fill
            ? geometry.segments.map((segment) =>
                segment.length > 1 ? <path key={`a${segment[0].index}`} className="spark-area" d={areaPath(segment, geometry.baseY)} fill={`url(#${gradientId})`} /> : null,
              )
            : null}
          {geometry.segments.map((segment) =>
            segment.length > 1 ? (
              <path
                key={`l${segment[0].index}`}
                className="spark-line"
                d={linePath(segment)}
                pathLength={1}
                fill="none"
                stroke={mark}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle key={`d${segment[0].index}`} cx={segment[0].x} cy={segment[0].y} r={2} fill={mark} />
            ),
          )}
          {activeX !== null ? <line x1={activeX} x2={activeX} y1={0} y2={totalHeight} stroke="var(--muted)" strokeOpacity={0.6} strokeWidth={1} /> : null}
          {annotate && geometry.peak.index !== geometry.low.index ? (
            <g fontFamily="var(--font-mono)" fontSize={10} fill="var(--muted)">
              {showPeakDot ? (
                <circle cx={geometry.peak.x} cy={geometry.peak.y} r={3.5} fill={mark} stroke="var(--panel-solid)" strokeWidth={2} />
              ) : null}
              <text x={geometry.peak.x} y={geometry.peak.y - 7} textAnchor={anchorFor(geometry.peak.x)} className="tnum">
                maks. {format(geometry.peak.value)}
              </text>
              {showLowDot ? (
                <circle cx={geometry.low.x} cy={geometry.low.y} r={3.5} fill="var(--panel-solid)" stroke={mark} strokeWidth={2} />
              ) : null}
              <text x={geometry.low.x} y={geometry.low.y + 15} textAnchor={anchorFor(geometry.low.x)} className="tnum">
                min. {format(geometry.low.value)}
              </text>
            </g>
          ) : null}
          {endDot && geometry.last ? (
            <circle cx={geometry.last.x} cy={geometry.last.y} r={4} fill={mark} stroke="var(--panel-solid)" strokeWidth={2} />
          ) : null}
          {activeX !== null && typeof activeValue === 'number' ? (
            <circle cx={activeX} cy={geometry.yOf(activeValue)} r={4} fill={mark} stroke="var(--panel-solid)" strokeWidth={2} />
          ) : null}
        </svg>
      ) : null}
      {interactive && active !== null && activeX !== null && tooltip ? (
        <ChartTooltip x={activeX} y={tooltipAbove ? 0 : totalHeight / 2} containerWidth={width} placement={tooltipAbove ? 'above' : 'beside'}>
          {tooltip(active, activeValue)}
        </ChartTooltip>
      ) : null}
      {interactive && tooltip ? (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {spoken !== null ? tooltip(spoken, spokenValue) : null}
        </div>
      ) : null}
    </div>
  );
}
