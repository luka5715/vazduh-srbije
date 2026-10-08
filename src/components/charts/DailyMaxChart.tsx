import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

import { PARAMETER_LABELS, THRESHOLDS_1H, UNIT, type Parameter } from '@shared/aqi';
import type { DailyStatRecord } from '@shared/contracts';
import { todayLocal } from '@shared/time';

import { CategoryDot } from '@/components/ui/Category';
import { useMeasure } from '@/hooks/useMeasure';
import { catVar, categoryOf, CATEGORIES } from '@/lib/category';
import { formatConcentration, formatDayLong, formatDayShort, formatHour, formatInt, formatNumber } from '@/lib/format';
import { linearScale, nearestSlot, roundedTopBar, ticks } from '@/lib/scale';

import { CategoryLegend, PartialHatchPattern } from './CategoryLegend';
import { ChartTooltip, RectKey, TooltipRow } from './ChartTooltip';
import { dayLengthHours, isCoveredStat, minCoveredHours } from '@/lib/coverage';
import { useChartPointer } from './useTouchInspect';

const HEIGHT = 236;
const TOP = 12;
const BOTTOM = 26;
const LEFT = 36;
/** Najmanji vertikalni razmak (px) između natpisa pragova desno od grafikona. */
const LABEL_GAP = 13;

export interface DailyMaxChartProps {
  stats: DailyStatRecord[];
  parameter: Parameter;
  /** Lokalni dani (YYYY-MM-DD) koje grafikon pokriva, rastuće. */
  days: string[];
}

/** Broj sati lokalnog dana: 23, 24 ili 25 (prelazak na letnje/zimsko vreme) – imenilac za „Sati merenja“. */
const hoursInDay = dayLengthHours;

/** Završen dan sa merenjem kraćim od 75 % sati (vidi `isCoveredStat`) – šrafiran i ne broji se. */
function isShortDay(stat: DailyStatRecord, today: string): boolean {
  return stat.day !== today && !isCoveredStat(stat);
}

/** Fina „lepa“ gornja granica ose (1; 1,2; 1,5; 2; 2,5; 3; 4; 5; 6; 8; 10 × 10^n) – manje praznog prostora od `niceMax`. */
function fineCeil(value: number, minimum = 10): number {
  const target = Math.max(value, minimum);
  if (!Number.isFinite(target) || target <= 0) return minimum;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * magnitude >= target - 1e-9) ?? 10;
  return step * magnitude;
}

/** Broj podeoka (3–6) za koji je korak „okrugao“ (1; 2; 2,5; 5 × 10^n). */
function tickCount(max: number): number {
  for (const count of [4, 5, 3, 6]) {
    const step = max / count;
    const magnitude = 10 ** Math.floor(Math.log10(step));
    if ([1, 2, 2.5, 5, 10].some((nice) => Math.abs(step / magnitude - nice) < 1e-9)) return count;
  }
  return 4;
}

/**
 * Natpisi pragova se ne preklapaju: od najvišeg ka najnižem, natpis koji bi bio bliži od
 * `LABEL_GAP` prethodnom prikazanom se izostavlja (linija ostaje; vrednost je u tooltip-u i tabeli).
 */
function visibleLabels(items: Array<{ y: number; rank: number }>): Set<number> {
  const shown = new Set<number>();
  let lastY = Number.NEGATIVE_INFINITY;
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    if (item.y - lastY >= LABEL_GAP) {
      shown.add(item.rank);
      lastY = item.y;
    }
  }
  return shown;
}

/**
 * Stubovi dnevnog maksimuma izabranog polutanta sa SEPA pragovima kao linijama (iznad stubova,
 * sa oreolom u boji površine); nepotpuni dani (današnji i dani sa manje od 18 h merenja) imaju
 * šrafuru i isprekidan obris, a kraći završeni dani se ne broje u „Dana po kategoriji“.
 * Dodir: tap bira dan (tooltip ostaje).
 */
export function DailyMaxChart({ stats, parameter, days }: DailyMaxChartProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hatchId = useId().replace(/:/g, '');
  const today = todayLocal();

  const byDay = useMemo(() => {
    const map = new Map<string, DailyStatRecord>();
    for (const stat of stats) if (stat.parameter === parameter) map.set(stat.day, stat);
    return map;
  }, [stats, parameter]);

  const thresholds = THRESHOLDS_1H[parameter];
  const dataMax = Math.max(0, ...days.map((d) => byDay.get(d)?.maxValue ?? 0));
  // Prikaži bar sledeći prag iznad podataka da se vidi koliko je do sledeće kategorije.
  const nextThreshold = thresholds.find((t) => t >= dataMax) ?? thresholds[thresholds.length - 1];
  const yMax = fineCeil(Math.max(dataMax * 1.05, nextThreshold * 1.08), 10);

  const wide = width >= 520;
  const right = wide ? 148 : 40;
  const x0 = LEFT;
  const x1 = Math.max(x0 + 60, width - right);
  const plotTop = TOP;
  const plotBottom = HEIGHT - BOTTOM;
  const y = linearScale([0, yMax], [plotBottom, plotTop]);
  const n = days.length;
  const band = (x1 - x0) / Math.max(1, n);
  // Stub ≤ 22 px, a razmak između stubova raste sa širinom (bar 2 px, ~25 % trake).
  const barWidth = Math.max(3, Math.min(22, band - Math.max(2, band * 0.25)));
  const xBar = (i: number) => x0 + i * band + (band - barWidth) / 2;
  const xCenter = (i: number) => x0 + (i + 0.5) * band;
  /** Natpis dana („07. 10.“) je ~40 px: svaki k-ti dan unazad od danas (bar ~16 px razmaka), centriran ispod stuba. */
  const labelEvery = Math.max(1, Math.ceil(56 / band));
  const showDayLabel = (i: number) => (n - 1 - i) % labelEvery === 0 && xCenter(i) - 21 >= 0;

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

  /** Fokus sa tastature odmah prikazuje poslednji (današnji) dan. */
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && hover === null && n > 0 && event.currentTarget.matches(':focus-visible')) setHover(n - 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setHover((h) => Math.max(0, (h ?? n) - 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setHover(event.key === 'Home' ? 0 : n - 1);
    } else if (event.key === 'Escape') setHover(null);
  };

  const hoveredDay = hover !== null ? days[hover] : null;
  const hovered = hoveredDay ? byDay.get(hoveredDay) : undefined;
  const visibleThresholds = thresholds.map((t, i) => ({ value: t, rank: i, y: y(t) })).filter((t) => t.value <= yMax);
  const labelled = visibleLabels(visibleThresholds);
  const dayCounts = [0, 0, 0, 0, 0, 0];
  let shortDays = 0;
  for (const day of days) {
    const stat = byDay.get(day);
    if (!stat) continue;
    if (isShortDay(stat, today)) shortDays++;
    else dayCounts[Math.min(5, Math.max(0, stat.categoryMax))]++;
  }
  const gridTicks = ticks(yMax, tickCount(yMax));
  const readout =
    hover !== null && hoveredDay
      ? hovered
        ? `${formatDayShort(hoveredDay)}${hoveredDay === today ? ' (danas, nepotpun dan)' : isShortDay(hovered, today) ? ' (nepotpun dan)' : ''} – maksimum ${formatConcentration(hovered.maxValue)} ${UNIT}, ${categoryOf(hovered.categoryMax).label}`
        : `${formatDayShort(hoveredDay)} – nema podataka`
      : '';

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={ref}
        role="group"
        aria-label={`Dnevni maksimum ${PARAMETER_LABELS[parameter]}, poslednjih ${n} dana. Strelice levo i desno biraju dan; vrednosti su i u tabeli.`}
        className="relative w-full rounded-ctl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={() => setHover(null)}
      >
        <p className="sr-only" aria-live="polite">
          {readout}
        </p>
        {width > 0 ? (
          <svg
            style={{ width: '100%' }}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={`Dnevni maksimum ${PARAMETER_LABELS[parameter]} za poslednjih ${n} dana, sa SEPA pragovima; današnji dan je nepotpun`}
            className="block touch-pan-y overflow-visible select-none"
            {...pointer}
          >
            <defs>
              <PartialHatchPattern id={hatchId} />
            </defs>
            {/* Mreža i y-osa (pune tanke linije). */}
            {gridTicks.map((t) => (
              <g key={t}>
                {t > 0 && !visibleThresholds.some((th) => Math.abs(th.y - y(t)) < 4) ? (
                  <line x1={x0} x2={x1} y1={y(t) + 0.5} y2={y(t) + 0.5} className="stroke-grid" strokeWidth={1} />
                ) : null}
                <text x={x0 - 8} y={y(t) + 3.5} textAnchor="end" className="tick-label fill-muted">
                  {formatNumber(t, 0)}
                </text>
              </g>
            ))}
            {/* Kolona pod pokazivačem (ispod stubova). */}
            {hover !== null ? (
              <rect x={x0 + hover * band} y={plotTop} width={band} height={plotBottom - plotTop} rx={3} className="fill-ink" fillOpacity={0.06} />
            ) : null}
            {/* Stubovi; današnji dan je nepotpun: puna boja kategorije + šrafura i isprekidan obris. */}
            {days.map((day, i) => {
              const stat = byDay.get(day);
              if (!stat) return null;
              const top = y(stat.maxValue);
              const h = Math.max(1, plotBottom - top);
              const d = roundedTopBar(xBar(i), plotBottom - h, barWidth, h, 4);
              const partial = day === today || isShortDay(stat, today);
              const isHover = hover === i;
              const dim = hover !== null && !isHover;
              return (
                <g key={day} data-mark>
                  <path d={d} style={{ fill: catVar(stat.categoryMax) }} fillOpacity={dim ? 0.7 : 1} className="transition-[fill-opacity] duration-150" />
                  {partial ? (
                    <>
                      <path d={d} fill={`url(#${hatchId})`} />
                      <path d={d} className="fill-none stroke-muted" strokeWidth={1} strokeDasharray="3 2" />
                    </>
                  ) : null}
                </g>
              );
            })}
            {/* Pragovi kategorija PREKO stubova: oreol 3 px u boji površine + isprekidana linija 1 px;
                desno broj sa strelicom (iznad linije počinje sledeća kategorija) i naziv kad ima mesta. */}
            {visibleThresholds.map(({ value, rank, y: ty }) => (
              <g key={value}>
                <line x1={x0} x2={x1} y1={ty + 0.5} y2={ty + 0.5} className="stroke-panel-solid" strokeWidth={3} />
                <line x1={x0} x2={x1} y1={ty + 0.5} y2={ty + 0.5} className="stroke-muted" strokeWidth={1} strokeDasharray="3 3" />
                {labelled.has(rank) ? (
                  <text x={x1 + 8} y={ty + 3.5} className="tick-label fill-muted">
                    {formatNumber(value, 0)}
                    {/* Iznad linije počinje sledeća kategorija (vrednost ≤ prag je još u nižoj). */}
                    {wide ? <tspan className="fill-muted font-body text-[11px]">{` ↑ ${CATEGORIES[rank + 1].label}`}</tspan> : ' ↑'}
                  </text>
                ) : null}
              </g>
            ))}
            {/* Osnovna linija preko stubova. */}
            <line x1={x0} x2={x1} y1={plotBottom + 0.5} y2={plotBottom + 0.5} className="stroke-border-strong" strokeWidth={1} />
            {/* X osa: svaki k-ti dan unazad od današnjeg (danas je uvek označen). */}
            {days.map((day, i) =>
              showDayLabel(i) ? (
                <text
                  key={day}
                  x={xCenter(i)}
                  y={HEIGHT - 7}
                  textAnchor="middle"
                  className="tick-label fill-muted"
                >
                  {formatDayShort(day)}
                </text>
              ) : null,
            )}
            <rect x={0} y={0} width={width} height={HEIGHT} fill="transparent" />
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} className="skeleton" />
        )}
        {hover !== null && hoveredDay && width > 0 ? (
          <ChartTooltip x={xCenter(hover)} y={0} containerWidth={width}>
            <p className="tnum mb-1 font-semibold text-ink">
              {formatDayLong(hoveredDay)}
              {hoveredDay === today ? <span className="ml-1 font-normal text-muted">· danas – nepotpun dan</span> : null}
              {hovered && isShortDay(hovered, today) ? <span className="ml-1 font-normal text-muted">· nepotpun dan</span> : null}
            </p>
            {hovered ? (
              <>
                <TooltipRow swatch={<RectKey color={catVar(hovered.categoryMax)} />} label={`Maks. u ${formatHour(hovered.maxHour)}`} value={`${formatConcentration(hovered.maxValue)} ${UNIT}`} />
                <TooltipRow label="Prosek" value={formatConcentration(hovered.avgValue)} />
                <TooltipRow label="Min." value={formatConcentration(hovered.minValue)} />
                <TooltipRow label="Sati merenja" value={`${hovered.hours}/${hoursInDay(hoveredDay)}`} muted />
                <p className="mt-1 flex items-center gap-1.5 text-muted">
                  <CategoryDot rank={hovered.categoryMax} size={8} />
                  {categoryOf(hovered.categoryMax).label}
                </p>
                {isShortDay(hovered, today) ? (
                  <p className="mt-1 max-w-[220px] text-[11px] leading-4 text-muted">
                    Manje od {formatInt(minCoveredHours(hoveredDay))} h merenja – ne broji se u „Dana po kategoriji“.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted">Nema podataka za ovaj dan.</p>
            )}
          </ChartTooltip>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <p className="eyebrow">Dana po kategoriji</p>
        <CategoryLegend counts={dayCounts} partialDay partialLabel={shortDays > 0 ? `nepotpun dan (danas ili < 18 h; ne broji se: ${formatInt(shortDays)})` : undefined} />
      </div>
    </div>
  );
}

/** Tabelarni blizanac 30-dnevnog grafikona. */
export function DailyTable({ stats, parameter, days }: DailyMaxChartProps) {
  const today = todayLocal();
  const byDay = new Map<string, DailyStatRecord>();
  for (const stat of stats) if (stat.parameter === parameter) byDay.set(stat.day, stat);
  const head = 'px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-muted';
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`Dnevna statistika ${PARAMETER_LABELS[parameter]}, ${UNIT}; današnji dan je nepotpun`}
      className="max-h-[360px] overflow-auto rounded-tile border border-border"
    >
      <table className="w-full min-w-[420px] border-collapse text-[13px]">
        <caption className="sr-only">
          Dnevna statistika {PARAMETER_LABELS[parameter]}, {UNIT}; današnji dan je nepotpun
        </caption>
        <thead className="sticky top-0 z-[1] bg-panel-solid text-left">
          <tr className="border-b border-border-strong">
            <th scope="col" className={head}>
              Dan
            </th>
            <th scope="col" className={`${head} text-right`}>
              Maks.
            </th>
            <th scope="col" className={`${head} text-right`}>
              Sat maks.
            </th>
            <th scope="col" className={`${head} text-right`}>
              Prosek
            </th>
            <th scope="col" className={`${head} text-right`}>
              Min.
            </th>
            <th scope="col" className={`${head} text-right`}>
              Sati
            </th>
            <th scope="col" className={head}>
              Kategorija
            </th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((day) => {
            const stat = byDay.get(day);
            const partial = day === today;
            const short = stat ? isShortDay(stat, today) : false;
            return (
              <tr key={day} className="border-t border-border transition-colors hover:bg-card-2">
                <th scope="row" className="tnum px-3 py-1.5 text-left font-medium text-ink">
                  {formatDayShort(day)}
                  {partial ? <span className="ml-1 font-normal text-faint">(danas, nepotpun)</span> : null}
                  {short ? <span className="ml-1 font-normal text-faint">(nepotpun)</span> : null}
                </th>
                {stat ? (
                  <>
                    <td className="tnum px-3 py-1.5 text-right text-ink">{formatConcentration(stat.maxValue)}</td>
                    <td className="tnum px-3 py-1.5 text-right text-muted">{formatHour(stat.maxHour)}</td>
                    <td className="tnum px-3 py-1.5 text-right text-ink">{formatConcentration(stat.avgValue)}</td>
                    <td className="tnum px-3 py-1.5 text-right text-ink">{formatConcentration(stat.minValue)}</td>
                    <td className="tnum px-3 py-1.5 text-right text-muted">
                      {stat.hours}/{hoursInDay(day)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
                        <CategoryDot rank={stat.categoryMax} size={8} />
                        {categoryOf(stat.categoryMax).label}
                      </span>
                    </td>
                  </>
                ) : (
                  <td colSpan={6} className="px-3 py-1.5 text-faint">
                    Nema podataka
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
