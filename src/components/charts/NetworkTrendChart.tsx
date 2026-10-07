import { useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

import { todayLocal } from '@shared/time';

import { CategoryDot } from '@/components/ui/Category';
import { useMeasure } from '@/hooks/useMeasure';
import { CATEGORIES, catVar, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatDayLong, formatDayShort, formatPercent } from '@/lib/format';
import { linearScale, nearestSlot, roundedTopBar } from '@/lib/scale';

import { PartialHatchPattern } from './CategoryLegend';
import { NOT_LOADED, NotLoadedNote } from './HeatGrid';
import { ChartTooltip, TooltipRow } from './ChartTooltip';
import { shortStationsText } from '@/lib/coverage';
import { useChartPointer } from './useTouchInspect';

const TOP = 10;
const BOTTOM = 26;
const LEFT = 40;
const RIGHT = 4;
/** Razmak u boji površine između segmenata (2 px). */
const GAP = 2;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

export interface DayCategoryCounts {
  day: string;
  /** Broj stanica po kategoriji 0–5 (najgora kategorija stanice tog dana). */
  counts: number[];
  /** Stanice u `counts` (pokriveni dani). */
  total: number;
  /**
   * Stanice koje su tog (završenog) dana merile kraće od 75 % sati – nisu u `counts` ni u
   * `total` (vidi `scopedDayCounts`). Prikazuju se samo u tooltip-u i tabeli.
   */
  short?: number;
  /**
   * Za ovaj (završen) dan baza nema NIJEDAN red dnevne statistike – istorija nije učitana
   * (`notLoadedDays`). Crta se prazan isprekidan okvir „nije učitano“, ne „nema podataka“.
   */
  notLoaded?: boolean;
}

export interface NetworkTrendChartProps {
  rows: DayCategoryCounts[];
  /** Današnji (nepotpun) dan – stub je bleđi, sa isprekidanim obrisom (podrazumevano danas). */
  today?: string;
  /** Opis grafikona za čitače ekrana. */
  label?: string;
}

/** Očitavanje dana za čitače ekrana: „06. 10. – Umeren 8, Prihvatljiv 12 (20 stanica)“. */
function dayReadout(row: DayCategoryCounts, today: string): string {
  const day = `${formatDayShort(row.day)}${row.day === today ? ' (danas, nepotpun dan)' : ''}`;
  const short = row.short && row.day !== today ? `; ${shortStationsText(row.short)}` : '';
  if (row.notLoaded) return `${day} – ${NOT_LOADED}`;
  if (row.total === 0) return `${day} – nema pokrivenih podataka${short}`;
  const parts = [...RANKS]
    .reverse()
    .filter((rank) => row.counts[rank])
    .map((rank) => `${CATEGORIES[rank].label} ${row.counts[rank]}`);
  return `${day} – ${parts.join(', ')} (${row.total} sa podacima)${short}`;
}

/**
 * Udeo stanica po SEPA kategoriji po danu – 100 % naslagani stubovi (≤ 24 px, 2 px razmaka
 * između segmenata, zaobljen vrh). Današnji (nepotpun) dan ima šrafuru i isprekidan okvir.
 * Završeni dani broje samo pokrivene dane stanica (≥ 18 h merenja); isključene stanice
 * (`short`) su navedene u tooltip-u i tabeli.
 * Hover/fokus ističe dan (ostali se priguše) i otvara tooltip; strelice ←/→ menjaju dan;
 * dodir: tap bira dan (tooltip ostaje), vertikalni pokret skroluje stranu.
 */
export function NetworkTrendChart({ rows, today = todayLocal(), label }: NetworkTrendChartProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hatchId = useId().replace(/:/g, '');

  const n = rows.length;
  const height = width > 0 && width < 480 ? 196 : 236;
  const x0 = LEFT;
  const x1 = Math.max(x0 + 60, width - RIGHT);
  const plotTop = TOP;
  const plotBottom = height - BOTTOM;
  const y = linearScale([0, 1], [plotBottom, plotTop]);
  const band = (x1 - x0) / Math.max(1, n);
  const barWidth = Math.max(3, Math.min(24, band - GAP));
  const xBar = (i: number) => x0 + i * band + (band - barWidth) / 2;
  const xCenter = (i: number) => x0 + (i + 0.5) * band;
  const labelEvery = Math.max(1, Math.ceil(50 / band));
  /** Poslednja oznaka („danas“) je poravnata udesno, pa prethodnu preskačemo ako bi se preklopile. */
  const regularLabel = (i: number) => (n - 1 - i) % labelEvery === 0 && (i === n - 1 || xCenter(n - 1) - xCenter(i) >= 58);
  /** Oznaka izabranog dana (hover/fokus) potiskuje susedne oznake sa kojima bi se sudarila. */
  const showDayLabel = (i: number) => {
    if (!regularLabel(i)) return false;
    if (hover === null || hover === i) return true;
    return Math.abs(xCenter(i) - xCenter(hover)) >= 54 && !(i === n - 1 && x1 - xCenter(hover) < 62);
  };
  const dayLabel = (i: number) => (rows[i].day === today ? 'danas' : formatDayShort(rows[i].day));

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (px < x0 || px > x1) {
      setHover(null);
      return;
    }
    setHover(nearestSlot(px, x0, x1, n));
  };
  const pointer = useChartPointer<SVGSVGElement>({ containerRef: ref, active: hover !== null, pick: onPointerMove, clear: () => setHover(null) });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setHover((h) => Math.max(0, (h ?? n) - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHover(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHover(n - 1);
    } else if (event.key === 'Escape') setHover(null);
  };

  const hovered = hover !== null ? rows[hover] : null;

  return (
    <div
      ref={ref}
      role="group"
      className="relative w-full rounded-ctl"
      tabIndex={0}
      aria-label={`${label ?? 'Udeo stanica po SEPA kategoriji po danu'}. Strelice levo i desno biraju dan.`}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
      onFocus={(event) => {
        if (event.target === event.currentTarget && hover === null && event.currentTarget.matches(':focus-visible')) setHover(n - 1);
      }}
    >
      <p className="sr-only" aria-live="polite">
        {hovered ? dayReadout(hovered, today) : ''}
      </p>
      {width > 0 ? (
        <svg
          style={{ width: '100%' }}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${label ?? 'Udeo stanica po SEPA kategoriji po danu'}, poslednjih ${n} dana`}
          className="block touch-pan-y select-none overflow-visible"
          {...pointer}
        >
          <defs>
            <PartialHatchPattern id={hatchId} />
          </defs>
          {Y_TICKS.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} className={t === 0 ? 'stroke-border-strong' : 'stroke-grid'} strokeWidth={1} />
              {t === 0 || t === 0.5 || t === 1 ? (
                <text x={x0 - 8} y={y(t) + 3.5} textAnchor="end" className="tnum fill-muted font-mono text-[10px]">
                  {formatPercent(t)}
                </text>
              ) : null}
            </g>
          ))}
          {hover !== null ? (
            <rect
              x={x0 + hover * band + 1}
              y={plotTop - 6}
              width={Math.max(2, band - 2)}
              height={plotBottom - plotTop + 6}
              rx={6}
              className="fill-ink"
              fillOpacity={0.07}
            />
          ) : null}
          {rows.map((row, i) => {
            if (row.notLoaded && row.day !== today) {
              // Dan bez ijednog reda u bazi: prazan isprekidan okvir pune visine („nije učitano“).
              return (
                <rect
                  key={row.day}
                  data-mark
                  x={xBar(i) + 0.5}
                  y={plotTop + 0.5}
                  width={Math.max(1, barWidth - 1)}
                  height={plotBottom - plotTop - 1}
                  rx={4}
                  className="fill-none stroke-faint"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  style={{ opacity: hover !== null && hover !== i ? 0.6 : 1 }}
                />
              );
            }
            if (row.total === 0) {
              // Završen dan samo sa kraćim danima stanica: bleda šrafirana „senka“ (nije uračunat).
              if (!row.short || row.day === today) return null;
              const ghost = roundedTopBar(xBar(i), plotTop, barWidth, plotBottom - plotTop, 4);
              return (
                <g key={row.day} data-mark style={{ opacity: hover !== null && hover !== i ? 0.6 : 1 }}>
                  <path d={ghost} style={{ fill: 'color-mix(in oklab, var(--muted) 16%, transparent)' }} />
                  <path d={ghost} fill={`url(#${hatchId})`} className="stroke-muted" strokeWidth={1} strokeDasharray="3 2" />
                </g>
              );
            }
            const partial = row.day === today;
            const segments: Array<{ rank: number; top: number; bottom: number }> = [];
            let cumulative = 0;
            for (const rank of RANKS) {
              const count = row.counts[rank] ?? 0;
              if (count === 0) continue;
              const from = cumulative / row.total;
              cumulative += count;
              const to = cumulative / row.total;
              segments.push({ rank, top: y(to), bottom: y(from) });
            }
            const barTop = segments[segments.length - 1]?.top ?? plotBottom;
            const dimmed = hover !== null && hover !== i;
            return (
              <g
                key={row.day}
                data-mark
                className="trend-col transition-[opacity,filter] duration-150"
                style={{ '--trend-delay': `${i * 6}ms`, opacity: dimmed ? 0.8 : 1, filter: hover === i ? 'brightness(1.08) saturate(1.05)' : undefined } as CSSProperties}
              >
                {partial ? (
                  <path
                    d={roundedTopBar(xBar(i) - 2, barTop - 2, barWidth + 4, plotBottom - barTop + 2, 5)}
                    className="fill-none stroke-muted"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                ) : null}
                {segments.map((segment, si) => {
                  const isTop = si === segments.length - 1;
                  const isBottom = si === 0;
                  const top = segment.top + (isTop ? 0 : GAP / 2);
                  const bottom = segment.bottom - (isBottom ? 0 : GAP / 2);
                  const h = Math.max(1, bottom - top);
                  const d = isTop ? roundedTopBar(xBar(i), bottom - h, barWidth, h, 4) : `M${xBar(i)} ${top}h${barWidth}v${h}h${-barWidth}Z`;
                  return <path key={segment.rank} d={d} style={{ fill: catVar(segment.rank) }} />;
                })}
                {/* Nepotpun dan: šrafura preko pune boje (boje ostaju na SEPA skali). */}
                {partial && segments.length ? (
                  <path d={roundedTopBar(xBar(i), barTop, barWidth, plotBottom - barTop, 4)} fill={`url(#${hatchId})`} />
                ) : null}
              </g>
            );
          })}
          {rows.map((row, i) =>
            showDayLabel(i) ? (
              <text
                key={row.day}
                x={i === n - 1 ? x1 : xCenter(i)}
                y={height - 8}
                textAnchor={i === n - 1 ? 'end' : 'middle'}
                className={cn('tnum font-mono text-[10px]', hover === i ? 'fill-ink font-semibold' : 'fill-muted')}
              >
                {dayLabel(i)}
              </text>
            ) : null,
          )}
          {hover !== null && !regularLabel(hover) ? (
            <text
              x={Math.min(x1 - 21, Math.max(x0 + 21, xCenter(hover)))}
              y={height - 8}
              textAnchor="middle"
              className="tnum fill-ink font-mono text-[10px] font-semibold"
            >
              {dayLabel(hover)}
            </text>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} className="skeleton" />
      )}
      {hovered && width > 0 && hover !== null ? (
        <ChartTooltip x={xCenter(hover)} y={0} containerWidth={width}>
          <p className="font-semibold text-ink">{formatDayLong(hovered.day)}</p>
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
            {hovered.day === today ? 'danas · nepotpun dan' : hovered.notLoaded ? NOT_LOADED : 'najgora dnevna kategorija'}
          </p>
          {hovered.notLoaded && hovered.day !== today ? (
            <NotLoadedNote />
          ) : hovered.total === 0 ? (
            <p className="text-muted">{hovered.short ? 'Nema pokrivenih podataka za ovaj dan.' : 'Nema podataka za ovaj dan.'}</p>
          ) : (
            <>
              {[...RANKS].reverse().map((rank) =>
                hovered.counts[rank] ? (
                  <TooltipRow
                    key={rank}
                    swatch={<CategoryDot rank={rank} size={8} />}
                    label={CATEGORIES[rank].label}
                    value={`${hovered.counts[rank]} · ${formatPercent(hovered.counts[rank] / hovered.total)}`}
                  />
                ) : null,
              )}
              <TooltipRow label="Stanica sa podacima" value={String(hovered.total)} muted />
            </>
          )}
          {hovered.short && hovered.day !== today ? <p className="mt-1 max-w-[220px] text-[11px] leading-4 text-muted">{shortStationsText(hovered.short)}.</p> : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** Tabelarni blizanac trenda mreže (najnoviji dan prvi). */
export function NetworkTrendTable({ rows, today = todayLocal(), label }: NetworkTrendChartProps) {
  const anyShort = rows.some((row) => row.day !== today && (row.short ?? 0) > 0);
  return (
    <div tabIndex={0} role="region" aria-label={label ?? 'Broj stanica po SEPA kategoriji po danu'} className="max-h-[360px] overflow-auto rounded-tile border border-border">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <caption className="sr-only">{label ?? 'Broj stanica po SEPA kategoriji po danu'}</caption>
        <thead className="sticky top-0 z-[1] bg-panel-solid text-left text-xs font-medium text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Dan
            </th>
            {RANKS.map((rank) => (
              <th key={rank} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <CategoryDot rank={rank} size={8} />
                  {CATEGORIES[rank].label}
                </span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Ukupno
            </th>
            {anyShort ? (
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Stanice koje su merile manje od 18 h tog dana – nisu uračunate">
                Kraći dan*
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.day} className="border-t border-border transition-colors hover:bg-card-2">
              <th scope="row" className="tnum whitespace-nowrap px-3 py-1.5 text-left font-medium text-ink">
                {formatDayShort(row.day)}
                {row.day === today ? <span className="ml-1.5 font-normal text-faint">danas, nepotpun</span> : null}
              </th>
              {RANKS.map((rank) => (
                <td key={rank} className="tnum px-2 py-1.5 text-right text-ink">
                  {row.counts[rank] || <span className="text-faint">–</span>}
                </td>
              ))}
              <td className="tnum px-3 py-1.5 text-right text-muted">
                {row.notLoaded && row.day !== today ? <span className="whitespace-nowrap text-faint">{NOT_LOADED}</span> : row.total || <span className="text-faint">–</span>}
              </td>
              {anyShort ? (
                <td className="tnum px-3 py-1.5 text-right text-muted">{(row.day !== today && row.short) || <span className="text-faint">–</span>}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {anyShort ? <p className="px-3 py-1.5 text-[11px] text-faint">* stanice sa manje od 18 h merenja tog dana – nisu uračunate u kategorije</p> : null}
    </div>
  );
}
