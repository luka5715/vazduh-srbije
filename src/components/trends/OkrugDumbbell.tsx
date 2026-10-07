import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { CATEGORIES, PARAMETER_LABELS, UNIT, classify, type Parameter } from '@shared/aqi';

import { ChartTooltip, TooltipRow } from '@/components/charts/ChartTooltip';
import { catMarkVar } from '@/components/charts/marks';
import { useDismissOutside } from '@/components/charts/useTouchInspect';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMeasure } from '@/hooks/useMeasure';
import { categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatDelta, formatInt, pluralSr, stationsShort } from '@/lib/format';
import { okrugAggregates, okrugLabel, resolveLensParameter, type OkrugAggregate } from '@/lib/insights';
import { linearScale } from '@/lib/scale';

import { PanelHead } from './PanelHead';
import { dumbbellLensNote, dumbbellScale, type DumbbellScale } from './trendData';

/** Broj okruga pre dugmeta „+N“. */
const LIMIT = 12;

type Direction = 'up' | 'down' | 'flat';

interface DumbbellRow {
  aggregate: OkrugAggregate;
  now: number | null;
  avg: number | null;
  delta: number | null;
  direction: Direction | null;
}

/** Smer promene SADA prema proseku 24 h (tolerancija ±1 µg/m³ ili ±5 % proseka). */
function directionOf(now: number | null, avg: number | null): { delta: number | null; direction: Direction | null } {
  if (now === null || avg === null) return { delta: null, direction: null };
  const delta = now - avg;
  const tolerance = Math.max(1, Math.abs(avg) * 0.05);
  return { delta, direction: Math.abs(delta) < tolerance ? 'flat' : delta > 0 ? 'up' : 'down' };
}

function toRow(aggregate: OkrugAggregate): DumbbellRow {
  return { aggregate, now: aggregate.nowMedian, avg: aggregate.avg24Median, ...directionOf(aggregate.nowMedian, aggregate.avg24Median) };
}

/** Vrednost u µg/m³ – isto pravilo zaokruživanja kao na ostalim stranicama (1 decimala ispod 100). */
const fmt = (value: number | null) => formatConcentration(value);

function deltaText(row: DumbbellRow): string {
  if (row.delta === null || row.direction === null) return '';
  if (row.direction === 'flat') return 'kao prosek 24 h';
  return `${formatDelta(row.delta)} ${UNIT} ${row.direction === 'up' ? 'iznad' : 'ispod'} proseka 24 h`;
}

/** „1 stanica“, „3 stanice“ – uzorak medijane okruga. */
function sampleText(count: number): string {
  return `${formatInt(count)} ${pluralSr(count, 'stanica', 'stanice', 'stanica')}`;
}

function describeRow(row: DumbbellRow, parameter: Parameter): string {
  const { aggregate } = row;
  if (row.now === null) return `${aggregate.label}: nema svežih merenja ${PARAMETER_LABELS[parameter]}`;
  const category = categoryOf(classify(parameter, row.now)).label;
  const avg = row.avg === null ? 'bez proseka 24 h' : `prosek 24 h ${fmt(row.avg)} ${UNIT}`;
  return `${aggregate.label} (${sampleText(aggregate.stations)}): sada ${fmt(row.now)} ${UNIT} (${category}), ${avg}${row.direction ? `, ${deltaText(row)}` : ''}`;
}

/**
 * „Okruzi“: po okrugu medijana polutanta SADA (puna tačka) prema medijani 24-časovnih
 * proseka stanica (prazna tačka), spojene linijom; sortirano po vrednosti sada. Jedna osa
 * u µg/m³ sa SEPA pragovima polutanta (isprekidane vodilje, traka kategorija gore). Uz naziv
 * okruga je broj stanica u medijani („1 st.“) – medijana jedne stanice nije podatak okruga.
 * Prikazuje SVE okruge; izabrani okrug (filter) je istaknut, a klik na red menja filter.
 */
export function OkrugDumbbell({ className, style }: { className?: string; style?: CSSProperties }) {
  const { views, lens, okrug, setOkrug } = useAtmosfera();
  const [view, setView] = useState<View>('chart');
  const [expanded, setExpanded] = useState(false);
  const parameter = resolveLensParameter(lens);
  const rows = useMemo(() => okrugAggregates(views, lens).map(toRow), [views, lens]);
  const scale = useMemo(() => dumbbellScale(parameter, rows.flatMap((row) => [row.now, row.avg])), [parameter, rows]);

  const visible = useMemo(() => {
    if (expanded || rows.length <= LIMIT) return rows;
    const head = rows.slice(0, LIMIT);
    const selected = okrug ? rows.find((row) => row.aggregate.okrug === okrug) : undefined;
    return selected && !head.includes(selected) ? [...head, selected] : head;
  }, [rows, expanded, okrug]);
  const hidden = rows.length - visible.length;

  const withValue = rows.filter((row) => row.now !== null);
  const rising = withValue.filter((row) => row.direction === 'up').length;
  const falling = withValue.filter((row) => row.direction === 'down').length;
  const top = withValue[0];
  const note = dumbbellLensNote(lens, parameter);
  const toggle = (name: string) => setOkrug(okrug === name ? null : name);

  return (
    <GlassPanel className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby="okrug-dumbbell-title" data-testid="okrug-dumbbell">
      <PanelHead
        id="okrug-dumbbell-title"
        eyebrow={
          <>
            Sada · prosek 24 h · <span className={okrug ? 'text-ink' : undefined}>{okrug ? `istaknut ${okrugLabel(okrug)}` : 'svi okruzi'}</span>
          </>
        }
        title={`Okruzi · ${PARAMETER_LABELS[parameter]}`}
        actions={withValue.length > 0 ? <ViewToggle value={view} onChange={setView} label="Prikaz okruga" /> : undefined}
        lead={
          top && top.now !== null ? (
            <>
              Najviša medijana sada: {top.aggregate.label} ({fmt(top.now)} {UNIT}; {sampleText(top.aggregate.stations)}).{' '}
              {rising > 0
                ? `U ${formatInt(rising)} od ${formatInt(withValue.length)} okruga vrednost je sada iznad proseka 24 h.`
                : falling === withValue.length
                  ? 'Svi okruzi su sada ispod svog proseka 24 h.'
                  : 'Nijedan okrug sada nije iznad svog proseka 24 h.'}
            </>
          ) : undefined
        }
        hint={
          <>
            {note ? `${note} ` : ''}
            {okrug ? 'Izabrani okrug je istaknut; klik na red menja filter, ponovni klik ga uklanja.' : 'Klik na okrug filtrira celu stranicu.'}
          </>
        }
      />

      {view === 'chart' && withValue.length > 0 ? <DumbbellLegend parameter={parameter} /> : null}

      {withValue.length === 0 ? (
        <p className="rounded-tile border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted">
          Nijedan okrug nema sveže merenje {PARAMETER_LABELS[parameter]}.
        </p>
      ) : view === 'chart' ? (
        <DumbbellChart replayKey={lens} overall={lens === 'worst'} rows={visible} parameter={parameter} scale={scale} selected={okrug} onToggle={toggle} />
      ) : (
        <DumbbellTable rows={visible} parameter={parameter} selected={okrug} onToggle={toggle} />
      )}

      {rows.length > LIMIT && withValue.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="touch-target self-start rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-card-2"
        >
          {expanded ? 'Prikaži manje' : `+${formatInt(hidden)} ${pluralSr(hidden, 'okrug', 'okruga', 'okruga')}`}
        </button>
      ) : null}
    </GlassPanel>
  );
}

/** Legenda oblika (boja tačke je SEPA kategorija vrednosti – vidi traku iznad ose). */
function DumbbellLegend({ parameter }: { parameter: Parameter }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legenda">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-full bg-ink" />
        Sada · medijana stanica
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-ink" />
        Prosek 24 h · medijana proseka stanica
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg aria-hidden width="14" height="10" className="shrink-0">
          <line x1="7" x2="7" y1="0" y2="10" className="stroke-muted" strokeWidth={1} strokeDasharray="2 2" />
        </svg>
        SEPA prag {PARAMETER_LABELS[parameter]}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden data-mark className="flex gap-px">
          {[0, 1, 2, 3].map((rank) => (
            <span key={rank} className="h-2.5 w-1.5 first:rounded-l-[3px] last:rounded-r-[3px]" style={{ backgroundColor: catMarkVar(rank) }} />
          ))}
        </span>
        boja tačke = kategorija
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-faint">st.</span>
        broj stanica u medijani
      </li>
    </ul>
  );
}

interface ChartProps {
  /** Promena ključa ponovo pokreće animaciju ulaska (npr. pri promeni sočiva). */
  replayKey: string;
  /** Sočivo „Najlošiji“: najgora kategorija okruga je ukupna (svi polutanti), ne samo PM10. */
  overall: boolean;
  rows: DumbbellRow[];
  parameter: Parameter;
  scale: DumbbellScale;
  selected: string | null;
  onToggle: (okrug: string) => void;
}

const TOP_AXIS = 30;
const BOTTOM_AXIS = 24;
/** Razmak od desne ivice vrednosti „sada“ do desne ivice proseka 24 h (krug + „57,5“). */
const AVG_COLUMN = 46;

function DumbbellChart({ replayKey, overall, rows, parameter, scale, selected, onToggle }: ChartProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  /** Red izabran dodirom: prvi tap prikazuje vrednosti, drugi tap na isti red menja filter okruga. */
  const [pinned, setPinned] = useState<number | null>(null);
  const pointerType = useRef('mouse');
  const narrow = width > 0 && width < 560;
  const clearActive = () => {
    setActive(null);
    setPinned(null);
  };
  useDismissOutside(ref, active !== null, clearActive);

  // Naziv + „ · 12 st.“ (uzorak); 12 px tekst ≈ 6,6 px po znaku.
  const longest = rows.reduce((max, row) => Math.max(max, row.aggregate.label.length + stationsShort(row.aggregate.stations).length + 3), 0);
  const labelWidth = narrow ? 0 : Math.min(216, Math.max(120, Math.round(longest * 6.4) + 16));
  const valueWidth = narrow ? 0 : 104;
  const rowHeight = narrow ? 46 : 32;
  const x0 = narrow ? 6 : labelWidth + 6;
  const x1 = Math.max(x0 + 80, width - valueWidth - (narrow ? 6 : 14));
  const x = linearScale([0, scale.max], [x0, x1]);
  const height = TOP_AXIS + rows.length * rowHeight + BOTTOM_AXIS;
  const rowTop = (i: number) => TOP_AXIS + i * rowHeight;
  /** y-koordinata linije reda (na telefonu ispod naziva). */
  const trackY = (i: number) => rowTop(i) + (narrow ? 32 : rowHeight / 2);

  // Oznake ose: 0, SEPA pragovi i kraj ose; preskače se oznaka koja bi se sudarila sa prethodnom.
  const ticks = useMemo(() => {
    const values = [0, ...scale.thresholds.map((t) => t.value), scale.max];
    const shown: number[] = [];
    for (const value of values) {
      const px = linearScale([0, scale.max], [x0, x1])(value);
      const last = shown.length ? linearScale([0, scale.max], [x0, x1])(shown[shown.length - 1]) : -Infinity;
      if (value === scale.max) {
        if (x1 - last < 54 && shown.length > 1) shown.pop();
        shown.push(value);
      } else if (px - last >= 26) shown.push(value);
    }
    return shown;
  }, [scale, x0, x1]);

  const indexFromEvent = (event: { currentTarget: SVGSVGElement; clientY: number }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const py = event.clientY - rect.top;
    const index = Math.floor((py - TOP_AXIS) / rowHeight);
    return index >= 0 && index < rows.length ? index : null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i === null ? 0 : Math.min(last, i + 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i === null ? last : Math.max(0, i - 1)));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(last);
    } else if ((event.key === 'Enter' || event.key === ' ') && active !== null && rows[active]) {
      event.preventDefault();
      onToggle(rows[active].aggregate.okrug);
    } else if (event.key === 'Escape') clearActive();
  };

  const activeRow = active !== null ? rows[active] : null;
  const tooltipX = activeRow ? x(Math.max(activeRow.now ?? 0, activeRow.avg ?? 0)) : 0;

  return (
    <div
      ref={ref}
      role="group"
      tabIndex={0}
      aria-label={`Okruzi, ${PARAMETER_LABELS[parameter]}: sada prema proseku 24 h. Strelice gore i dole biraju okrug, Enter filtrira stranicu.`}
      className="relative w-full rounded-ctl"
      onKeyDown={onKeyDown}
      onBlur={clearActive}
    >
      <p className="sr-only" aria-live="polite">
        {activeRow ? describeRow(activeRow, parameter) : ''}
      </p>
      {width > 0 ? (
        <svg
          style={{ width: '100%' }}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Okruzi po medijani ${PARAMETER_LABELS[parameter]} sada (puna tačka) i medijani proseka 24 h (prazna tačka), ${UNIT}. ${rows
            .slice(0, 5)
            .map((row) => describeRow(row, parameter))
            .join('; ')}${rows.length > 5 ? '; …' : ''}`}
          className="block touch-pan-y select-none overflow-visible"
          onPointerDown={(event) => {
            pointerType.current = event.pointerType;
          }}
          onPointerMove={(event) => {
            // Dodir bira red tapom (vidi onClick); prevlačenje prstom ne menja izbor.
            if (event.pointerType !== 'touch') setActive(indexFromEvent(event));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'touch') clearActive();
          }}
          onClick={(event) => {
            const index = indexFromEvent(event);
            if (index === null) return;
            if (pointerType.current === 'touch' && pinned !== index) {
              setActive(index);
              setPinned(index);
              return;
            }
            onToggle(rows[index].aggregate.okrug);
          }}
        >
          {/* Traka kategorija gore: pojasevi SEPA skale polutanta, 2 px razmaka. */}
          {scale.bands.map((band) => {
            const left = x(band.from) + (band.from > 0 ? 1 : 0);
            const right = x(band.to) - (band.to < scale.max ? 1 : 0);
            const name = CATEGORIES[band.rank].label;
            const fits = right - left >= name.length * 6.4 + 10;
            return (
              <g key={band.rank}>
                <rect x={left} y={TOP_AXIS - 10} width={Math.max(1, right - left)} height={4} rx={2} data-mark style={{ fill: catMarkVar(band.rank) }} />
                {fits ? (
                  <text x={(left + right) / 2} y={TOP_AXIS - 15} textAnchor="middle" className="fill-muted text-[11px]">
                    {name}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Isticanje izabranog (filter) i aktivnog reda. */}
          {rows.map((row, i) => {
            const isSelected = row.aggregate.okrug === selected;
            if (!isSelected && active !== i) return null;
            return (
              <rect
                key={`hl-${row.aggregate.okrug}`}
                x={0}
                y={rowTop(i) + 1}
                width={width}
                height={rowHeight - 2}
                rx={8}
                className={isSelected ? 'fill-haze stroke-haze' : 'fill-ink'}
                fillOpacity={isSelected ? 0.1 : 0.06}
                strokeOpacity={isSelected ? 0.45 : 0}
                strokeWidth={1}
              />
            );
          })}

          {/* Vodilje SEPA pragova (isprekidane – to su pragovi, ne mreža). Na telefonu samo oko
              linije svakog reda, da ne prelaze preko naziva okruga. */}
          {scale.thresholds.map((threshold) => {
            const gx = Math.round(x(threshold.value)) + 0.5;
            const props = { className: 'stroke-muted', strokeOpacity: 0.45, strokeWidth: 1, strokeDasharray: '2 3' };
            return narrow ? (
              <g key={threshold.value}>
                <line x1={gx} x2={gx} y1={TOP_AXIS - 4} y2={TOP_AXIS + 2} {...props} />
                {rows.map((row, i) => (
                  <line key={row.aggregate.okrug} x1={gx} x2={gx} y1={trackY(i) - 9} y2={trackY(i) + 10} {...props} />
                ))}
              </g>
            ) : (
              <line key={threshold.value} x1={gx} x2={gx} y1={TOP_AXIS - 4} y2={TOP_AXIS + rows.length * rowHeight} {...props} />
            );
          })}

          {/* Osa (dno). */}
          <line x1={x0} x2={x1} y1={height - BOTTOM_AXIS + 0.5} y2={height - BOTTOM_AXIS + 0.5} className="stroke-border-strong" strokeWidth={1} />
          {ticks.map((value) => {
            const isEnd = value === scale.max;
            return (
              <text
                key={value}
                x={isEnd ? x1 : x(value)}
                y={height - 7}
                textAnchor={isEnd ? 'end' : value === 0 ? 'start' : 'middle'}
                className="tnum fill-muted font-mono text-[11px]"
              >
                {formatInt(value)}
                {isEnd ? ` ${UNIT}` : ''}
              </text>
            );
          })}

          <g key={replayKey}>
          {rows.map((row, i) => {
            const { aggregate } = row;
            const isSelected = aggregate.okrug === selected;
            const dimmed = selected !== null && !isSelected && active !== i;
            const yTrack = trackY(i);
            const nowX = row.now !== null ? x(Math.min(row.now, scale.max)) : null;
            const avgX = row.avg !== null ? x(Math.min(row.avg, scale.max)) : null;
            const labelY = narrow ? rowTop(i) + 15 : yTrack + 4;
            const emphasis = isSelected || active === i;
            return (
              <g key={aggregate.okrug} style={{ opacity: dimmed ? 0.45 : 1 }} className="transition-opacity duration-150">
                <text x={narrow ? x0 : 0} y={labelY} className={cn('text-[12px]', emphasis ? 'fill-ink font-semibold' : 'fill-muted')}>
                  {aggregate.label}
                  <tspan className="tnum fill-faint font-mono text-[11px] font-normal"> · {stationsShort(aggregate.stations)}</tspan>
                </text>
                <line x1={x0} x2={x1} y1={yTrack + 0.5} y2={yTrack + 0.5} className="stroke-grid" strokeWidth={1} />
                {nowX === null ? (
                  <text x={x0 + 2} y={yTrack + 4} className="fill-muted text-[11px]">
                    nema svežih merenja
                  </text>
                ) : (
                  <>
                    {avgX !== null ? (
                      <line
                        x1={avgX}
                        x2={nowX}
                        y1={yTrack}
                        y2={yTrack}
                        pathLength={1}
                        className="db-link stroke-ink"
                        strokeOpacity={0.38}
                        strokeWidth={2}
                        strokeLinecap="round"
                        style={{ animationDelay: `${i * 24}ms` }}
                      />
                    ) : null}
                    {avgX !== null && row.avg !== null ? (
                      <circle
                        cx={avgX}
                        cy={yTrack}
                        r={4.5}
                        data-mark
                        className="fill-panel-solid"
                        strokeWidth={2}
                        style={{ stroke: catMarkVar(classify(parameter, row.avg)) }}
                      />
                    ) : null}
                    <circle
                      cx={nowX}
                      cy={yTrack}
                      r={5.5}
                      data-mark
                      className="db-now stroke-panel-solid"
                      strokeWidth={2}
                      style={
                        {
                          fill: catMarkVar(classify(parameter, row.now as number)),
                          '--db-from': `${(avgX ?? nowX) - nowX}px`,
                          animationDelay: `${i * 24}ms`,
                        } as CSSProperties
                      }
                    />
                  </>
                )}
                {row.now !== null ? <ValueLabel row={row} right={width - (narrow ? 4 : 2)} y={labelY} /> : null}
              </g>
            );
          })}
          </g>
        </svg>
      ) : (
        <div style={{ height: TOP_AXIS + Math.min(rows.length, LIMIT) * 32 + BOTTOM_AXIS }} className="skeleton" />
      )}

      {activeRow && width > 0 && active !== null ? (
        <ChartTooltip x={tooltipX} y={rowTop(active) + rowHeight + 2} containerWidth={width}>
          <DumbbellTooltip
            row={activeRow}
            parameter={parameter}
            overall={overall}
            selected={activeRow.aggregate.okrug === selected}
            touch={pinned === active}
          />
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/**
 * Vrednosti na kraju reda (ink): SADA (podebljano) i prosek 24 h uz mali prazan krug –
 * isti oblik kao na grafikonu. Kolone su poravnate udesno (`right` = desna ivica).
 */
function ValueLabel({ row, right, y }: { row: DumbbellRow; right: number; y: number }) {
  return (
    <g className="tnum">
      <text x={right - AVG_COLUMN} y={y} textAnchor="end" className="fill-ink text-[13px] font-semibold">
        {fmt(row.now)}
      </text>
      {row.avg !== null ? (
        <>
          <circle cx={right - AVG_COLUMN + 11} cy={y - 4} r={3} className="fill-none stroke-muted" strokeWidth={1.5} />
          <text x={right} y={y} textAnchor="end" className="fill-muted text-[12px]">
            {fmt(row.avg)}
          </text>
        </>
      ) : null}
    </g>
  );
}

function DumbbellTooltip({
  row,
  parameter,
  overall,
  selected,
  touch,
}: {
  row: DumbbellRow;
  parameter: Parameter;
  overall: boolean;
  selected: boolean;
  /** Red je izabran dodirom: drugi dodir menja filter. */
  touch: boolean;
}) {
  const { aggregate } = row;
  const nowCategory = row.now !== null ? categoryOf(classify(parameter, row.now)) : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold text-ink">{aggregate.label}</p>
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
        {PARAMETER_LABELS[parameter]} · {formatInt(aggregate.stations)} od {formatInt(aggregate.total)} {pluralSr(aggregate.total, 'stanice', 'stanice', 'stanica')} sa podacima
      </p>
      {row.now === null ? (
        <p className="text-faint">Nema svežih merenja.</p>
      ) : (
        <>
          <TooltipRow swatch={<CategoryDot rank={nowCategory?.rank ?? null} size={8} />} label="Sada (medijana)" value={`${fmt(row.now)} ${UNIT}`} />
          <TooltipRow
            swatch={row.avg !== null ? <CategoryDot rank={classify(parameter, row.avg)} size={8} hollow /> : undefined}
            label="Prosek 24 h (medijana)"
            value={row.avg !== null ? `${fmt(row.avg)} ${UNIT}` : '–'}
          />
          {row.direction ? <p className="text-muted">{deltaText(row)}</p> : null}
          {nowCategory ? (
            <p className="mt-0.5 flex items-center gap-1.5">
              <CategoryChip category={nowCategory} size="sm" />
              {aggregate.worstCategory && aggregate.worstCategory.rank > nowCategory.rank ? (
                <span className="text-muted">
                  {overall ? 'najlošija stanica (svi polutanti)' : 'najlošija stanica'}: {aggregate.worstCategory.label}
                </span>
              ) : null}
            </p>
          ) : null}
        </>
      )}
      <p className="mt-1 border-t border-border pt-1 text-[11px] text-muted">
        {touch
          ? selected
            ? 'Dodirnite ponovo da uklonite filter okruga'
            : 'Dodirnite ponovo za filter okruga'
          : selected
            ? 'Klik uklanja filter okruga'
            : 'Klik prikazuje samo ovaj okrug'}
      </p>
    </div>
  );
}

/** Tabelarni blizanac: sve vrednosti, promena rečima, dugme za filter okruga. */
function DumbbellTable({ rows, parameter, selected, onToggle }: { rows: DumbbellRow[]; parameter: Parameter; selected: string | null; onToggle: (okrug: string) => void }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`Okruzi: medijana ${PARAMETER_LABELS[parameter]} sada i medijana proseka 24 h, ${UNIT}`}
      className="max-h-[480px] overflow-auto rounded-tile border border-border"
    >
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <caption className="sr-only">
          Okruzi: medijana {PARAMETER_LABELS[parameter]} sada i medijana proseka 24 h, {UNIT}
        </caption>
        <thead className="sticky top-0 z-[1] bg-panel-solid text-left text-xs text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Okrug
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Sada
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Prosek 24 h
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium">
              Promena
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Stanice
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Kategorija sada
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { aggregate } = row;
            const isSelected = aggregate.okrug === selected;
            const Icon = row.direction === 'up' ? ArrowUpRight : row.direction === 'down' ? ArrowDownRight : ArrowRight;
            return (
              <tr key={aggregate.okrug} className={cn('border-t border-border transition-colors hover:bg-card-2', isSelected && 'bg-haze/10')}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => onToggle(aggregate.okrug)}
                    aria-pressed={isSelected}
                    className="rounded-[6px] text-left text-ink underline-offset-2 hover:underline"
                  >
                    {aggregate.label}
                  </button>
                </th>
                <td className="tnum px-2 py-1.5 text-right font-semibold text-ink">{fmt(row.now)}</td>
                <td className="tnum px-2 py-1.5 text-right text-ink">{fmt(row.avg)}</td>
                <td className="px-2 py-1.5 text-muted">
                  {row.direction ? (
                    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', row.direction === 'up' && 'font-semibold text-ink')}>
                      <Icon aria-hidden className="size-3.5" />
                      {deltaText(row)}
                    </span>
                  ) : (
                    <span className="text-faint">–</span>
                  )}
                </td>
                <td className="tnum px-2 py-1.5 text-right text-muted">
                  {formatInt(aggregate.stations)}/{formatInt(aggregate.total)}
                </td>
                <td className="px-3 py-1.5">
                  {row.now !== null ? <CategoryChip category={categoryOf(classify(parameter, row.now))} size="sm" /> : <span className="text-faint">–</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
