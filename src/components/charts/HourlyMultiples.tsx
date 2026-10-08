import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

import { classify, PARAMETER_LABELS, PARAMETERS, THRESHOLDS_1H, UNIT, type Parameter } from '@shared/aqi';
import type { SnapshotSeries } from '@shared/contracts';

import { CategoryDot } from '@/components/ui/Category';
import { useMeasure } from '@/hooks/useMeasure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { catVar, categoryOf } from '@/lib/category';
import { formatConcentration, formatNumber, formatTime } from '@/lib/format';
import { linearScale, nearestSlot, niceMax } from '@/lib/scale';

import { ChartTooltip, LineKey, TooltipRow } from './ChartTooltip';
import { catMarkVar } from './marks';
import { useChartPointer } from './useTouchInspect';

import '@/styles/mapa.css';

const HOUR_MS = 3_600_000;
const ROW_HEIGHT = 50;
const ROW_GAP = 16;
const LABEL_WIDTH = 62;
const VALUE_WIDTH = 50;
const AXIS_HEIGHT = 22;
const TOP = 4;

export interface HourlyMultiplesProps {
  series: SnapshotSeries;
}

interface Row {
  parameter: Parameter;
  values: Array<number | null>;
  max: number;
  lastIndex: number;
}

function buildRows(series: SnapshotSeries): Row[] {
  const rows: Row[] = [];
  for (const parameter of PARAMETERS) {
    const values = series.values[parameter];
    if (!values || values.length === 0) continue;
    let max = 0;
    let lastIndex = -1;
    values.forEach((v, i) => {
      if (v === null) return;
      if (v > max) max = v;
      lastIndex = i;
    });
    if (lastIndex < 0) continue;
    rows.push({ parameter, values, max, lastIndex });
  }
  return rows;
}

/** Deli niz na segmente bez null vrednosti. */
function segments(values: Array<number | null>): Array<Array<{ i: number; v: number }>> {
  const result: Array<Array<{ i: number; v: number }>> = [];
  let current: Array<{ i: number; v: number }> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) result.push(current);
      current = [];
      return;
    }
    current.push({ i, v });
  });
  if (current.length) result.push(current);
  return result;
}

/** Očitavanje jednog sata za čitače ekrana: „07:00 – PM10 24,5 µg/m³, Prihvatljiv; NO₂ …“. */
function hourReadout(rows: Row[], index: number, hour: string): string {
  const parts = rows.map((row) => {
    const v = row.values[index];
    if (typeof v !== 'number') return `${PARAMETER_LABELS[row.parameter]} nema merenja`;
    return `${PARAMETER_LABELS[row.parameter]} ${formatConcentration(v)} ${UNIT}, ${categoryOf(classify(row.parameter, v)).label}`;
  });
  return `${hour} – ${parts.join('; ')}`;
}

/**
 * Poslednja 24 sata: mali višestruki grafikoni (jedan po polutantu, svaki sa svojom
 * y-osom, jer se skale razlikuju 10×), zajednički x i zajednički nišan + tooltip.
 * U pozadini svakog reda su blagi pojasevi SEPA kategorija (granice = pragovi) sa trakom
 * pune boje kategorije na levoj ivici, linija 2 px sa blagom ispunom, krajnja tačka u boji
 * trenutne kategorije i vrednost na kraju. Dodir: tap bira sat (tooltip ostaje).
 */
export function HourlyMultiples({ series }: HourlyMultiplesProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  /** Oznake sati su `tick-label`: 11 px ispod 640 px (znak ≈ 6,8 px), 10 px od `sm` (≈ 6,2 px). */
  const smUp = useMediaQuery('(min-width: 40rem)', true);
  const hourLabelWidth = 5 * (smUp ? 6.2 : 6.8);
  const gradientId = useId().replace(/:/g, '');
  const rows = useMemo(() => buildRows(series), [series]);
  const startMs = Date.parse(series.start);
  const slots = 24;

  const height = TOP + rows.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP + AXIS_HEIGHT;
  const x0 = LABEL_WIDTH;
  const x1 = Math.max(x0 + 40, width - VALUE_WIDTH);
  const band = (x1 - x0) / slots;
  const xAt = (i: number) => x0 + (i + 0.5) * band;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (px < x0 - band || px > x1 + band) {
      setHover(null);
      return;
    }
    setHover(nearestSlot(px, x0, x1, slots));
  };
  const pointer = useChartPointer<SVGSVGElement>({ containerRef: ref, active: hover !== null, pick: onPointerMove, clear: () => setHover(null) });

  /** Fokus sa tastature odmah prikazuje poslednji (najnoviji) sat. */
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && hover === null && event.currentTarget.matches(':focus-visible')) setHover(slots - 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setHover((h) => Math.min(slots - 1, (h ?? slots - 1) + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setHover((h) => Math.max(0, (h ?? slots) - 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setHover(event.key === 'Home' ? 0 : slots - 1);
    } else if (event.key === 'Escape') {
      setHover(null);
    }
  };

  if (rows.length === 0) {
    return <p className="text-sm text-muted">Nema satnih merenja u poslednja 24 sata.</p>;
  }

  const hourLabel = (i: number) => formatTime(startMs + i * HOUR_MS);
  // Oznake sati unazad od poslednjeg (trenutnog) sata, svakih 3/4/6/8/12 h – prvi korak za koji
  // između natpisa ostaje bar 8 px: poslednji natpis je poravnat udesno (zauzima celu širinu
  // levo od kraja ose), prethodni je centriran (pola širine), pa je potreban korak 1,5 širine + 8.
  const step = [3, 4, 6, 8, 12].find((s) => s * band >= 1.5 * hourLabelWidth + 8) ?? 12;
  const ticks = Array.from({ length: Math.floor((slots - 1) / step) + 1 }, (_, k) => slots - 1 - k * step).filter((i) => i === slots - 1 || xAt(i) - 16 >= x0 - band / 2);

  const parameterList = rows.map((r) => PARAMETER_LABELS[r.parameter]).join(', ');

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Satne vrednosti poslednja 24 sata: ${parameterList}. Strelice levo i desno biraju sat; vrednosti su i u tabeli.`}
      className="relative w-full rounded-ctl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={() => setHover(null)}
    >
      <p className="sr-only" aria-live="polite">
        {hover !== null ? hourReadout(rows, hover, hourLabel(hover)) : ''}
      </p>
      {width > 0 ? (
        <svg
          style={{ width: '100%' }}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Satne vrednosti poslednja 24 sata za ${parameterList}, od ${hourLabel(0)} do ${hourLabel(23)}`}
          className="block touch-pan-y overflow-visible select-none"
          {...pointer}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {rows.map((row, rowIndex) => {
            const top = TOP + rowIndex * (ROW_HEIGHT + ROW_GAP);
            const bottom = top + ROW_HEIGHT;
            const limits = THRESHOLDS_1H[row.parameter];
            // Gornji kraj ose je SEPA prag iznad podataka (red se završava na granici kategorije),
            // a bar prvi prag, da „Dobar“ pojas ne izgleda dramatično; iznad svih pragova lepa vrednost.
            const target = Math.max(row.max * 1.1, limits[0]);
            const yMax = limits.find((limit) => limit >= target) ?? niceMax(target, 5);
            const y = linearScale([0, yMax], [bottom, top]);
            const parts = segments(row.values);
            const last = row.values[row.lastIndex];
            const lastValue = typeof last === 'number' ? last : 0;
            const lastRank = classify(row.parameter, lastValue);
            const hoverValue = hover !== null ? row.values[hover] : null;
            // Pojasevi kategorija unutar [0, yMax] – 1 px razmak između susednih.
            const bands = [0, ...limits]
              .map((from, rank) => ({ rank, from, to: rank < limits.length ? limits[rank] : Number.POSITIVE_INFINITY }))
              .filter((b) => b.from < yMax)
              .map((b) => ({ rank: b.rank, yTop: y(Math.min(b.to, yMax)), yBottom: y(b.from) }));
            const valueY = Math.min(bottom - 2, Math.max(top + 10, y(lastValue) + 4));
            return (
              <g key={row.parameter}>
                {/* Naziv polutanta i opseg ose (tekst u boji teksta, ne u boji podataka). */}
                <text x={0} y={top + 13} className="fill-ink font-heading text-[13px] font-semibold">
                  {PARAMETER_LABELS[row.parameter]}
                </text>
                {/* Jedinica i opseg ose: 12 px na telefonu, 11 px od `sm` (čitljiv indeks ³). */}
                <text x={0} y={top + 28} className="unit-label fill-muted font-normal">
                  {UNIT}
                </text>
                <text x={0} y={top + 43} className="tnum fill-muted font-mono text-[12px] sm:text-[11px]">
                  0–{formatNumber(yMax, 0)}
                </text>
                {bands.map((b) => {
                  const bandY = b.yTop + (b.rank > 0 && b.yTop > top ? 0.5 : 0);
                  const bandH = Math.max(0, b.yBottom - b.yTop - (b.rank > 0 ? 1 : 0));
                  return (
                    <g key={b.rank}>
                      <rect x={x0} width={x1 - x0} y={bandY} height={bandH} className="hm-band" style={{ fill: catVar(b.rank) }} />
                      {/* Traka pune boje na levoj ivici: kategorija pojasa se čita i bez blede ispune. */}
                      <rect x={x0} width={3} y={bandY} height={bandH} data-mark style={{ fill: catMarkVar(b.rank) }} />
                    </g>
                  );
                })}
                {/* Tanka linija na svakoj granici pojaseva (SEPA prag). */}
                {bands.map((b) =>
                  b.rank > 0 && b.yBottom < bottom ? (
                    <line key={`t${b.rank}`} x1={x0 + 3} x2={x1} y1={b.yBottom} y2={b.yBottom} className="stroke-grid" strokeWidth={1} />
                  ) : null,
                )}
                <line x1={x0} x2={x1} y1={bottom + 0.5} y2={bottom + 0.5} className="stroke-border" strokeWidth={1} />
                {parts.map((part) =>
                  part.length > 1 ? (
                    <path
                      key={`a${part[0].i}`}
                      d={`${part.map((p, k) => `${k ? 'L' : 'M'}${xAt(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')}L${xAt(part[part.length - 1].i).toFixed(1)} ${bottom}L${xAt(part[0].i).toFixed(1)} ${bottom}Z`}
                      fill={`url(#${gradientId})`}
                    />
                  ) : null,
                )}
                {parts.map((part) =>
                  part.length > 1 ? (
                    <path
                      key={`l${part[0].i}`}
                      d={part.map((p, k) => `${k ? 'L' : 'M'}${xAt(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')}
                      fill="none"
                      className="stroke-accent"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : (
                    <circle key={`d${part[0].i}`} cx={xAt(part[0].i)} cy={y(part[0].v)} r={2} className="fill-accent" />
                  ),
                )}
                {/* Krajnja tačka u boji kategorije, sa prstenom u boji površine. */}
                <circle cx={xAt(row.lastIndex)} cy={y(lastValue)} r={4.5} stroke="var(--panel-solid)" strokeWidth={2} data-mark style={{ fill: catMarkVar(lastRank) }} />
                <text x={x1 + 10} y={valueY} className="tnum fill-ink text-[12px] font-semibold">
                  {formatConcentration(lastValue)}
                </text>
                {/* Nišan u ovom redu. */}
                {hover !== null && typeof hoverValue === 'number' ? (
                  <circle cx={xAt(hover)} cy={y(hoverValue)} r={4} stroke="var(--accent)" strokeWidth={2} fill="var(--panel-solid)" />
                ) : null}
              </g>
            );
          })}
          {/* X osa. */}
          {ticks.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 5}
              textAnchor={i === slots - 1 ? 'end' : 'middle'}
              className="tick-label fill-muted"
            >
              {hourLabel(i)}
            </text>
          ))}
          {hover !== null ? (
            <line x1={xAt(hover)} x2={xAt(hover)} y1={TOP} y2={height - AXIS_HEIGHT + 2} className="stroke-muted" strokeOpacity={0.7} strokeWidth={1} />
          ) : null}
          {/* Prozirna površina za pokazivač preko cele visine. */}
          <rect x={0} y={0} width={width} height={height} fill="transparent" />
        </svg>
      ) : (
        <div style={{ height }} className="skeleton" />
      )}
      {hover !== null && width > 0 ? (
        <ChartTooltip x={xAt(hover)} y={0} containerWidth={width}>
          <p className="tnum mb-1 font-semibold text-ink">{hourLabel(hover)}</p>
          {rows.map((row) => {
            const v = row.values[hover];
            const rank = typeof v === 'number' ? classify(row.parameter, v) : null;
            return (
              <TooltipRow
                key={row.parameter}
                swatch={rank === null ? <LineKey color="var(--faint)" /> : <CategoryDot rank={rank} size={8} />}
                label={`${PARAMETER_LABELS[row.parameter]}${rank === null ? '' : ` · ${categoryOf(rank).label}`}`}
                value={typeof v === 'number' ? formatConcentration(v) : '–'}
                muted={rank === null}
              />
            );
          })}
          <p className="mt-1 text-[11px] text-faint">{UNIT}</p>
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** Tabelarni blizanac 24-satnog grafikona. */
export function HourlyTable({ series }: HourlyMultiplesProps) {
  const rows = useMemo(() => buildRows(series), [series]);
  const startMs = Date.parse(series.start);
  if (rows.length === 0) return <p className="text-sm text-muted">Nema satnih merenja u poslednja 24 sata.</p>;
  return (
    <div tabIndex={0} role="region" aria-label={`Satne vrednosti poslednja 24 sata, ${UNIT}`} className="max-h-[360px] overflow-auto rounded-tile border border-border">
      <table className="w-full min-w-[320px] border-collapse text-[13px]">
        <caption className="sr-only">Satne vrednosti poslednja 24 sata, {UNIT}</caption>
        <thead className="sticky top-0 z-[1] bg-panel-solid text-left">
          <tr className="border-b border-border-strong">
            <th scope="col" className="px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-muted">
              Sat
            </th>
            {rows.map((row) => (
              <th key={row.parameter} scope="col" className="tnum px-3 py-2 text-right text-xs font-semibold text-muted">
                {PARAMETER_LABELS[row.parameter]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, i) => 23 - i).map((i) => (
            <tr key={i} className="border-t border-border transition-colors hover:bg-card-2">
              <th scope="row" className="tnum px-3 py-1.5 text-left font-medium text-ink">
                {formatTime(startMs + i * HOUR_MS)}
              </th>
              {rows.map((row) => {
                const v = row.values[i];
                return (
                  <td key={row.parameter} className="tnum px-3 py-1.5 text-right text-ink">
                    {typeof v === 'number' ? (
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {formatConcentration(v)}
                        <CategoryDot rank={classify(row.parameter, v)} size={8} title={categoryOf(classify(row.parameter, v)).label} />
                        <span className="sr-only">{categoryOf(classify(row.parameter, v)).label}</span>
                      </span>
                    ) : (
                      <span className="text-faint">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
