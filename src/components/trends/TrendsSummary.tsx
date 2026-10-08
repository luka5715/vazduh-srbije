import { ChevronRight } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { CATEGORIES, PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { PARTIAL_HATCH } from '@/components/charts/CategoryLegend';
import { catMarkVar } from '@/components/charts/marks';
import { shortStationsText } from '@/lib/coverage';
import { Shimmer } from '@/components/fx/Shimmer';
import { Sparkline } from '@/components/fx/Sparkline';
import { CategoryChip } from '@/components/ui/Category';
import { KpiDelta, KpiTile, KpiValue } from '@/components/ui/Kpi';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { catVar, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatDayLong, formatDayShort, formatDelta, formatInt, formatNumber, formatPercent, pluralSr } from '@/lib/format';
import { okrugLabel, resolveLensParameter } from '@/lib/insights';

import {
  ALERT_RANK,
  COMPARE_DAYS,
  dailyMedianSeries,
  dayWorstRanks,
  lastComplete,
  MIN_DAY_COVERAGE,
  pollutedComparison,
  scopeDailyStats,
  scopedDayCounts,
  trendSummary,
  weekOverWeek,
  worstStationOnDay,
  type PollutedComparison,
  type PollutedDay,
  type TrendSummary as TrendSummaryData,
} from './trendData';
import type { NetworkDaily } from './useNetworkDaily';

const WEEKDAY = new Intl.DateTimeFormat('sr-Latn-RS', { weekday: 'long', timeZone: 'UTC' });

/** Sati pokrivenog dana od 24 (za tekst: „≥ 18 h“). */
const COVERED_HOURS = Math.round(24 * MIN_DAY_COVERAGE);

/** Dan u nedelji za lokalni dan `YYYY-MM-DD` („nedelja“). */
function weekday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? '' : WEEKDAY.format(date);
}

/** Udeo kao „18 %“, null kao crtica. */
const percentOrDash = (share: number | null) => (share === null ? '–' : formatPercent(share));

/**
 * Tri pločice sažetka 30 dana (sočivo + filter okruga): tipičan dnevni nivo polutanta sa
 * skicom, udeo dana stanica „Zagađen“ ili lošije (poslednjih 15 prema prethodnih 15 dana) i
 * najlošiji dan (raspodela kategorija). Računaju se samo pokriveni dani stanica (≥ 18 h
 * merenja, vidi `isCoveredStat`); današnji, nepotpun dan se ne računa. Dok se dnevna
 * statistika učitava – skeleti; bez podataka ili pri grešci se ne prikazuje (paneli ispod
 * objašnjavaju stanje).
 */
export function TrendsSummary({ daily, className, style }: { daily: NetworkDaily; className?: string; style?: CSSProperties }) {
  const { filteredViews, okrug, lens } = useAtmosfera();
  const { state, days, compareDays, today } = daily;
  const stationIds = useMemo(() => (okrug ? new Set(filteredViews.map((view) => view.id)) : null), [okrug, filteredViews]);
  const rows = useMemo(() => (state.data ? scopedDayCounts(state.data, days, stationIds, lens, today) : []), [state.data, days, stationIds, lens, today]);
  const summary = useMemo(() => trendSummary(rows, today), [rows, today]);
  const comparison = useMemo(
    () => pollutedComparison(state.data ? scopedDayCounts(state.data, compareDays, stationIds, lens, today) : [], today),
    [state.data, compareDays, stationIds, lens, today],
  );

  if (state.status === 'loading') {
    return (
      <div aria-hidden className={cn('grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3', className)} style={style}>
        <Shimmer rounded="tile" className="h-[164px] sm:col-span-2 xl:col-span-1" />
        <Shimmer rounded="tile" className="h-[164px]" />
        <Shimmer rounded="tile" className="h-[164px]" />
      </div>
    );
  }
  if (state.status !== 'ready' || summary.completeDays === 0) return null;

  return (
    <div
      className={cn('grid gap-3 transition-opacity duration-200 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3', state.refreshing && 'opacity-60', className)}
      style={style}
      aria-busy={state.refreshing}
    >
      <PollutantLevelTile daily={daily} stationIds={stationIds} className="sm:col-span-2 xl:col-span-1" />
      <PollutedShareTile comparison={comparison} summary={summary} />
      <WorstDayTile daily={daily} stationIds={stationIds} summary={summary} rows={rows} />
    </div>
  );
}

/**
 * Tipičan dnevni nivo polutanta (za „Najlošiji“ PM10): po danu medijana dnevnih proseka
 * stanica (pokriveni dani), prosek poslednjih 7 završenih dana, promena i skica 30 dana.
 */
function PollutantLevelTile({ daily, stationIds, className }: { daily: NetworkDaily; stationIds: ReadonlySet<string> | null; className?: string }) {
  const { lens, okrug } = useAtmosfera();
  const { state, days, today } = daily;
  const parameter = resolveLensParameter(lens);
  const series = useMemo(
    () => (state.data ? dailyMedianSeries(scopeDailyStats(state.data, stationIds, parameter), days, parameter) : []),
    [state.data, stationIds, parameter, days],
  );
  // Današnji (nepotpun) dan ne ulazi u skicu.
  const complete = useMemo(() => series.map((value, index) => (days[index] === today ? null : value)), [series, days, today]);
  const week = useMemo(() => weekOverWeek(series, days, today), [series, days, today]);
  const finite = complete.filter((value): value is number => value !== null);
  const name = PARAMETER_LABELS[parameter];
  const label = okrug ? `${name} · tipičan dnevni nivo (medijana stanica) · ${okrugLabel(okrug)}` : `${name} · tipičan dnevni nivo (medijana stanica)`;

  return (
    <KpiTile
      label={label}
      className={className}
      footer={
        week ? (
          <KpiDelta delta={week.delta} unit={UNIT} worseWhen="up" suffix="nego 7 dana ranije" format={formatDelta} />
        ) : (
          <span className="text-faint">Premalo dana za nedeljno poređenje.</span>
        )
      }
    >
      <div className="flex items-baseline gap-2">
        <KpiValue value={week?.last ?? lastComplete(series, days, today)?.value ?? null} unit={UNIT} format={formatConcentration} />
        <span className="text-xs text-muted">{week ? 'prosek poslednjih 7 dana' : 'poslednji dan'}</span>
      </div>
      {finite.length > 1 ? (
        <Sparkline
          values={complete}
          label={`Medijana dnevnih proseka stanica, ${name}, po danu, poslednjih ${days.length} dana, od ${formatConcentration(Math.min(...finite))} do ${formatConcentration(Math.max(...finite))} ${UNIT}`}
          height={40}
          color="var(--accent)"
          annotate
          format={formatConcentration}
          tooltip={(index, value) => (
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold text-ink">{formatDayLong(days[index])}</p>
              <p className="text-muted">
                {value === null ? (
                  'Nema pokrivenih dana stanica'
                ) : (
                  <>
                    <span className="tnum font-semibold text-ink">{formatConcentration(value)}</span> {UNIT} · medijana dnevnih proseka stanica
                  </>
                )}
              </p>
            </div>
          )}
        />
      ) : null}
    </KpiTile>
  );
}

/**
 * Udeo dana stanica (pokrivenih) u kategoriji „Zagađen“ ili lošijoj: poslednjih 15 završenih
 * dana, poređenje sa prethodnih 15 i traka dnevnih udela oba perioda. Stara mera („dani sa
 * bar jednom zagađenom stanicom“, skoro uvek ~100 %) je u objašnjenju „Kako se računa“.
 */
function PollutedShareTile({ comparison, summary }: { comparison: PollutedComparison; summary: TrendSummaryData }) {
  const alertLabel = CATEGORIES[ALERT_RANK].label;
  const { recent, previous, delta, daily } = comparison;
  const excluded = daily.reduce((sum, day) => sum + day.short, 0);
  return (
    <KpiTile
      label={`Udeo stanica-dana „${alertLabel}“ ili lošije`}
      footer={
        <div className="flex flex-col gap-1.5">
          {delta !== null ? (
            <KpiDelta delta={delta * 100} unit="p. p." worseWhen="up" suffix={`nego prethodnih ${COMPARE_DAYS} dana`} />
          ) : (
            <p className="text-faint">Premalo dana za poređenje sa prethodnih {COMPARE_DAYS} dana.</p>
          )}
          <details className="group/how">
            <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded-[6px] text-[13px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-3.5 transition-transform group-open/how:rotate-90" />
              Kako se računa
            </summary>
            <div className="mt-1.5 flex flex-col gap-1 text-[13px] leading-5 text-muted">
              <p>
                Dan stanice ulazi u račun kad ima merenja za bar {COVERED_HOURS} od 24 sata (75 %; na dane promene vremena srazmerno), a kategorija
                dana je kategorija najvišeg sata. Danas (nepotpun dan) se ne računa
                {excluded > 0
                  ? `; ${formatInt(excluded)} ${pluralSr(excluded, 'kraći dan stanice nije uračunat', 'kraća dana stanica nisu uračunata', 'kraćih dana stanica nije uračunato')}`
                  : ''}
                .
              </p>
              <p>
                Dani sa bar jednom stanicom „{alertLabel}“ ili lošije: <span className="tnum font-medium text-ink">{formatInt(summary.alertDays)}</span> od{' '}
                {formatInt(summary.completeDays)} {pluralSr(summary.completeDays, 'završenog dana', 'završena dana', 'završenih dana')} (ova mera je u velikoj
                mreži skoro uvek blizu 100 %, jer je dovoljan jedan sat jedne stanice).
              </p>
            </div>
          </details>
        </div>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <KpiValue value={recent.share === null ? null : recent.share * 100} unit="%" format={(value) => formatNumber(value, 0)} />
        <span className="text-xs text-muted">
          {recent.share === null
            ? `nema pokrivenih dana u poslednjih ${COMPARE_DAYS}`
            : `${formatInt(recent.polluted)} od ${formatInt(recent.stationDays)} · poslednjih ${COMPARE_DAYS} dana`}
        </span>
      </div>
      <PeriodStrip daily={daily} recentShare={recent.share} previousShare={previous.share} />
    </KpiTile>
  );
}

/**
 * Traka dnevnih udela „Zagađen“ ili lošije za dva perioda (prethodnih 15 | poslednjih 15):
 * stubovi od nule (vrh skale je najveći dnevni udeo, kao kod skice), isprekidana linija je
 * udeo celog perioda; dan bez pokrivenih podataka je bleda šrafirana oznaka.
 */
function PeriodStrip({ daily, recentShare, previousShare }: { daily: PollutedDay[]; recentShare: number | null; previousShare: number | null }) {
  const halves = [
    { days: daily.slice(0, Math.max(0, daily.length - COMPARE_DAYS)), share: previousShare, label: `prethodnih ${COMPARE_DAYS}` },
    { days: daily.slice(-COMPARE_DAYS), share: recentShare, label: `poslednjih ${COMPARE_DAYS}` },
  ];
  const top = Math.max(0.1, ...daily.map((day) => day.share ?? 0)) * 1.1;
  const pct = (share: number) => `${Math.min(100, (share / top) * 100).toFixed(1)}%`;
  const describe = (day: PollutedDay) =>
    `${formatDayShort(day.day)}: ${day.share === null ? 'nema pokrivenih dana stanica' : `${formatPercent(day.share)} od ${formatInt(day.total)} ${pluralSr(day.total, 'stanice', 'stanice', 'stanica')}`}${
      day.short > 0 ? `; ${shortStationsText(day.short)}` : ''
    }`;
  const summaryText = `Udeo stanica „${CATEGORIES[ALERT_RANK].label}“ ili lošije po danu: prethodnih ${COMPARE_DAYS} dana ${percentOrDash(previousShare)}, poslednjih ${COMPARE_DAYS} dana ${percentOrDash(recentShare)}.`;
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={summaryText} className="flex h-8 items-end gap-2">
        {halves.map((half) => (
          <div key={half.label} data-mark className="relative flex h-full min-w-0 flex-1 items-end gap-[2px] border-b border-border-strong">
            {half.days.map((day) => (
              <span
                key={day.day}
                title={describe(day)}
                className="min-w-0 flex-1 rounded-t-[2px]"
                style={
                  day.share === null
                    ? { height: '30%', backgroundColor: 'color-mix(in oklab, var(--muted) 16%, transparent)', backgroundImage: PARTIAL_HATCH }
                    : { height: day.share > 0 ? `max(2px, ${pct(day.share)})` : 0, backgroundColor: catMarkVar(ALERT_RANK) }
                }
              />
            ))}
            {half.share !== null ? (
              <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink/70" style={{ bottom: pct(half.share) }} />
            ) : null}
          </div>
        ))}
      </div>
      {/* Legenda polovina: 12 px na telefonu (donja granica tipografije), 11 px od `sm`. */}
      <div aria-hidden className="tnum flex gap-2 text-[12px] leading-4 text-muted sm:text-[11px]">
        {halves.map((half) => (
          <span key={half.label} className="flex-1 truncate">
            {half.label} · <span className="font-semibold text-ink">{percentOrDash(half.share)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Najlošiji završeni dan: datum, raspodela kategorija, udeo „Zagađen“ ili lošije i najlošija stanica. */
function WorstDayTile({
  daily,
  stationIds,
  summary,
  rows,
}: {
  daily: NetworkDaily;
  stationIds: ReadonlySet<string> | null;
  summary: TrendSummaryData;
  rows: ReturnType<typeof scopedDayCounts>;
}) {
  const { views, lens, openStation } = useAtmosfera();
  const { worst } = summary;
  const alertLabel = CATEGORIES[ALERT_RANK].label;
  const row = worst ? rows.find((r) => r.day === worst.day) : undefined;
  const worstRank = row ? dayWorstRanks([row])[0] : null;
  const station = useMemo(
    () => (worst && daily.state.data ? worstStationOnDay(daily.state.data, worst.day, stationIds, lens) : null),
    [worst, daily.state.data, stationIds, lens],
  );
  const stationView = station ? views.find((view) => view.id === station.stationId) : undefined;
  return (
    <KpiTile
      label="Najlošiji dan"
      aside={worstRank !== null ? <CategoryChip category={categoryOf(worstRank)} size="sm" /> : undefined}
      footer={
        worst
          ? `${formatInt(worst.count)} od ${formatInt(worst.total)} ${pluralSr(worst.total, 'stanice', 'stanice', 'stanica')} „${alertLabel}“ ili lošije (${formatPercent(worst.share)})`
          : `Nijedan završen dan nije imao stanicu „${alertLabel}“ ili lošije.`
      }
    >
      <p className="flex flex-wrap items-baseline gap-x-2 font-heading leading-none">
        <span className="text-[32px] font-semibold text-ink">{worst ? formatDayShort(worst.day) : '–'}</span>
        {worst ? <span className="text-sm font-medium text-faint">{weekday(worst.day)}</span> : null}
      </p>
      {row && row.total > 0 ? <DayShareBar counts={row.counts} total={row.total} /> : null}
      {station && stationView ? (
        <button
          type="button"
          onClick={() => openStation(station.stationId)}
          className="group -mx-1.5 flex min-w-0 flex-col rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-card-2"
        >
          {/* Ime dugmeta je vidljivi tekst (istim redom) + dopune samo za čitače ekrana. */}
          <span className="flex w-full flex-wrap items-baseline gap-x-2 text-[12px] leading-4 text-muted">
            <span>Najlošija stanica</span>
            <span className="tnum ml-auto">
              <span className="sr-only"> </span>
              <span className="font-semibold text-ink">{PARAMETER_LABELS[station.parameter]}</span> {formatConcentration(station.value)} {UNIT}
              <span className="sr-only"> (najviši sat tog dana), </span>
            </span>
          </span>
          <span className="w-full truncate text-[13px] font-medium leading-5 text-ink group-hover:underline">
            {stationView.station.name}
            <span className="sr-only">. Otvori na mapi.</span>
          </span>
        </button>
      ) : null}
    </KpiTile>
  );
}

/** 100 % vodoravna traka raspodele kategorija jednog dana (2 px razmaka između segmenata). */
function DayShareBar({ counts, total }: { counts: number[]; total: number }) {
  const parts = counts.map((count, rank) => ({ count, rank })).filter((part) => part.count > 0);
  const description = parts.map((part) => `${CATEGORIES[part.rank].label} ${part.count}`).join(', ');
  return (
    <div role="img" aria-label={`Raspodela ${formatInt(total)} stanica tog dana: ${description}`} data-mark className="flex h-2.5 gap-[2px]">
      {parts.map((part) => (
        <span
          key={part.rank}
          title={`${CATEGORIES[part.rank].label}: ${part.count}`}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: part.count, flexBasis: 0, backgroundColor: catVar(part.rank) }}
        />
      ))}
    </div>
  );
}
