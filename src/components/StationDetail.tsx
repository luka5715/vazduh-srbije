import { ListFilter, MapPin } from 'lucide-react';
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';

import { PARAMETER_LABELS, PARAMETERS, UNIT, type Parameter } from '@shared/aqi';
import type { DailyStatRecord } from '@shared/contracts';
import { addDays, daysBetween, todayLocal } from '@shared/time';

import { DailyMaxChart, DailyTable } from '@/components/charts/DailyMaxChart';
import { HourlyMultiples, HourlyTable } from '@/components/charts/HourlyMultiples';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { Shimmer } from '@/components/fx/Shimmer';
import { DominantGauge } from '@/components/map/DominantGauge';
import { MyStationToggle } from '@/components/map/MyStationToggle';
import { nextThreshold } from '@/components/overview/overviewText';
import { PollutantTiles } from '@/components/map/PollutantTiles';
import { SectionHeader } from '@/components/ui/Card';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { EmptyNote, ErrorBanner, RefreshFailedNote } from '@/components/ui/Feedback';
import { KpiDelta } from '@/components/ui/Kpi';
import { ViewToggle, type View } from '@/components/ui/ViewToggle';
import { useAsyncData } from '@/hooks/useAsyncData';
import { catVar, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatDayShort, formatDelta, formatHourAt, formatInt } from '@/lib/format';
import { deltaVs24h, okrugLabel, okrugOf, type Lens } from '@/lib/insights';
import { isInactive, liveStatus, STALE_HOURS, type StationView } from '@/lib/stations';
import type { DataService } from '@/services/dataService';

const DAYS = 30;

export interface StationDetailProps {
  view: StationView;
  service: DataService;
  /** Menja se posle svake sinhronizacije → ponovno učitavanje dnevne statistike. */
  dataVersion: number;
  now: Date;
  /** Sočivo: kad je izabran polutant (ne „Najlošiji“), 30-dnevni grafikon počinje od njega. */
  lens?: Lens;
  /** Klase tri panela – paneli se crtaju direktno u mrežu roditelja (raspored određuje stranica). */
  classNames?: { summary?: string; hourly?: string; daily?: string };
  /** Ref na prvi panel (npr. „Detalji ↓“ na telefonu skroluje do njega). */
  summaryRef?: Ref<HTMLElement>;
  /** Prekidač „Postavi kao moju stanicu“ (bez ovoga se ne prikazuje). */
  myStation?: { mine: boolean; onToggle: () => void };
  /**
   * Aktivni filter okruga: kad je izabrana stanica van njega (npr. iz palete ili kartice „Moja
   * stanica“), zaglavlje to kaže i nudi njen okrug ili uklanjanje filtera.
   */
  scope?: { okrug: string | null; onChange: (okrug: string | null) => void };
}

/**
 * Detalji izabrane stanice u tri staklena panela (bez omotača – roditelj ih raspoređuje):
 * (1) zaglavlje sa prstenom dominantnog polutanta, očitavanjima i pločicama polutanata
 * (panel nosi lokalnu izmaglicu u boji kategorije stanice), (2) poslednja 24 sata,
 * (3) poslednjih 30 dana.
 */
export function StationDetail({ view, service, dataVersion, now, lens = 'worst', classNames, summaryRef, myStation, scope }: StationDetailProps) {
  const [hourlyView, setHourlyView] = useState<View>('chart');
  const [dailyView, setDailyView] = useState<View>('chart');
  const titleId = useId();
  const hourlyId = useId();
  const dailyId = useId();

  // Polutant 30-dnevnog grafikona: izbor korisnika važi dok se ne promeni stanica ili sočivo.
  const preferred: Parameter = (lens !== 'worst' ? lens : null) ?? view.dominant ?? 'PM10';
  const resetKey = `${view.id}|${preferred}`;
  const [choice, setChoice] = useState<{ key: string; parameter: Parameter } | null>(null);
  const parameter = choice && choice.key === resetKey ? choice.parameter : preferred;

  const today = todayLocal(now);
  const fromDay = addDays(today, -(DAYS - 1));
  const days = useMemo(() => daysBetween(fromDay, today), [fromDay, today]);
  const daily = useAsyncData(() => service.listDailyStats(view.id, fromDay), [service, view.id, fromDay, dataVersion]);
  // Statistika mora biti baš ove stanice: posle promene stanice `useAsyncData` čuva prethodni
  // rezultat dok se novi učitava (ili kad učitavanje ne uspe) – tuđi grafikon se ne prikazuje.
  const dailyData = daily.data && daily.data.every((stat) => stat.station_id === view.id) ? daily.data : null;
  const dailyLoading = daily.status === 'loading' || (daily.refreshing && (dailyData === null || dailyData.length === 0));
  const dailyFailed = !dailyLoading && dailyData === null && daily.error !== null;

  const measuredParameters = PARAMETERS.filter((p) => view.values[p] !== undefined || view.series.values[p] !== undefined);
  const availableParameters = dailyData
    ? PARAMETERS.filter((p) => dailyData.some((s) => s.parameter === p))
    : measuredParameters.length
      ? measuredParameters
      : [...PARAMETERS];
  const activeParameter = availableParameters.includes(parameter) ? parameter : (availableParameters[0] ?? parameter);

  const rank = view.category?.rank ?? null;
  const panelStyle = rank !== null ? ({ '--haze': catVar(rank) } as CSSProperties) : undefined;

  return (
    <>
      <GlassPanel
        ref={summaryRef}
        aria-labelledby={titleId}
        className={cn('@container flex flex-col gap-5 p-4 sm:p-5 lg:p-6', rank !== null && 'haze-local', classNames?.summary)}
        style={panelStyle}
      >
        <StationHeader view={view} now={now} titleId={titleId} myStation={myStation} scope={scope} />
        <section aria-label="Polutanti" className="flex flex-col gap-2.5">
          <p className="eyebrow">
            {view.stale ? 'Poslednje poznate vrednosti' : 'Trenutne vrednosti'} · <span className="normal-case">{UNIT}</span> · 24 h
          </p>
          <PollutantTiles view={view} highlight={view.dominant} />
        </section>
      </GlassPanel>

      <GlassPanel aria-labelledby={hourlyId} className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', classNames?.hourly)}>
        <SectionHeader
          as="h3"
          id={hourlyId}
          className={HEADER_INLINE}
          eyebrow={
            <>
              Satne vrednosti · <span className="normal-case">{UNIT}</span>
            </>
          }
          title={view.stale ? 'Poslednja 24 sata sa podacima' : 'Poslednja 24 sata'}
          hint={
            view.stale
              ? `Do poslednjeg merenja (${formatHourAt(view.observedAt, now)}, ${liveStatus(view.observedAt, now).ageText}) – zastarele vrednosti.`
              : 'Svaki polutant na svojoj skali; pozadina su SEPA kategorije, tačka na kraju je trenutna.'
          }
          actions={<ViewToggle value={hourlyView} onChange={setHourlyView} label="Prikaz satnih vrednosti" />}
        />
        <div data-testid="hourly-chart">{hourlyView === 'chart' ? <HourlyMultiples series={view.series} /> : <HourlyTable series={view.series} />}</div>
      </GlassPanel>

      <GlassPanel aria-labelledby={dailyId} className={cn('flex flex-col gap-4 p-4 sm:p-5 lg:p-6', classNames?.daily)}>
        <SectionHeader
          as="h3"
          id={dailyId}
          className={HEADER_INLINE}
          eyebrow={`Dnevni maksimum · ${DAYS} dana`}
          title={`Poslednjih ${DAYS} dana`}
          hint="Najveća satna vrednost svakog dana; isprekidane linije su SEPA pragovi kategorija."
          actions={<ViewToggle value={dailyView} onChange={setDailyView} label="Prikaz dnevne statistike" />}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ParameterPicker
            options={availableParameters}
            value={activeParameter}
            onChange={(p) => setChoice({ key: resetKey, parameter: p })}
          />
          {dailyData ? <DailyPeak stats={dailyData} parameter={activeParameter} days={days} /> : null}
        </div>
        {dailyData && daily.error && !daily.refreshing ? <RefreshFailedNote onRetry={daily.reload} loadedAt={daily.loadedAt} now={now} /> : null}
        <div data-testid="daily-chart" className={cn(daily.refreshing && !dailyLoading && 'opacity-60 transition-opacity')}>
          {dailyLoading ? (
            <div aria-busy="true" aria-label="Učitavanje dnevne statistike">
              <Shimmer className="h-[230px]" rounded="tile" />
            </div>
          ) : dailyFailed ? (
            <ErrorBanner title="Dnevna statistika nije učitana" message={daily.error ?? 'Nepoznata greška'} detail={daily.errorDetail} onRetry={daily.reload} />
          ) : dailyData && dailyData.length > 0 ? (
            dailyView === 'chart' ? (
              <DailyMaxChart stats={dailyData} parameter={activeParameter} days={days} />
            ) : (
              <DailyTable stats={dailyData} parameter={activeParameter} days={days} />
            )
          ) : (
            <EmptyNote>
              Nema dnevne statistike za ovu stanicu u poslednjih {DAYS} dana – istorija možda nije učitana (Sinhronizacija → „Dopuni nedostajuće dane“) ili SEPA za stanicu nije objavila merenja.
            </EmptyNote>
          )}
        </div>
      </GlassPanel>
    </>
  );
}

/** Zaglavlje panela: prekidač grafikon/tabela ostaje u istom redu sa naslovom od `sm` naviše. */
const HEADER_INLINE = 'sm:flex-nowrap sm:[&>div:first-child]:flex-1';

/** Vrh perioda: najveći dnevni maksimum izabranog polutanta i dan kada je izmeren. */
function DailyPeak({ stats, parameter, days }: { stats: DailyStatRecord[]; parameter: Parameter; days: string[] }) {
  const inRange = new Set(days);
  let peak: DailyStatRecord | null = null;
  for (const stat of stats) {
    if (stat.parameter !== parameter || !inRange.has(stat.day)) continue;
    if (!peak || stat.maxValue > peak.maxValue) peak = stat;
  }
  if (!peak) return null;
  return (
    <p className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
      <span className="eyebrow">Vrh</span>
      <CategoryDot rank={peak.categoryMax} size={8} />
      <span>
        <span className="font-semibold text-ink">{formatConcentration(peak.maxValue)}</span> {UNIT} ·{' '}
        <span className="tnum">{formatDayShort(peak.day)}</span>
      </span>
      <span className="sr-only">, {categoryOf(peak.categoryMax).label}</span>
    </p>
  );
}

/** Zaglavlje: prsten dominantnog polutanta, ime i mesto, kategorija sa savetom i tri očitavanja. */
function StationHeader({
  view,
  now,
  titleId,
  myStation,
  scope,
}: {
  view: StationView;
  now: Date;
  titleId: string;
  myStation?: StationDetailProps['myStation'];
  scope?: StationDetailProps['scope'];
}) {
  const okrug = okrugOf(view);
  const inactive = isInactive(view);
  const outside = scope?.okrug && okrug !== scope.okrug ? scope : null;
  const dominant = view.dominant;
  const value = dominant ? (view.values[dominant]?.v ?? null) : null;
  const rank = view.category?.rank ?? null;
  /** Sat stanice nije „uživo“ (isto pravilo kao čip mreže, `liveStatus`), ali je još svež (`STALE_HOURS`). */
  const delayed = !view.stale && view.observedAt ? !liveStatus(view.observedAt, now).live : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <DominantGauge parameter={dominant} value={value} rank={rank} stale={view.stale} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate">
            Izabrana stanica · <span className="text-ink/70">{view.station.code}</span>
          </p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold leading-tight text-ink sm:text-[22px]">
            {view.station.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted">
            {view.station.municipality ? <span>{view.station.municipality}</span> : null}
            {okrug ? (
              <>
                {view.station.municipality ? <span aria-hidden className="text-faint">·</span> : null}
                <span>{okrugLabel(okrug)}</span>
              </>
            ) : null}
            {view.position?.approximate ? (
              <span className="inline-flex items-center gap-1 text-faint">
                <MapPin aria-hidden className="size-3" />
                približna lokacija (centar okruga)
              </span>
            ) : null}
          </p>
          {myStation ? <MyStationToggle key={view.id} mine={myStation.mine} onToggle={myStation.onToggle} disabled={inactive} className="mt-2.5" /> : null}
        </div>
      </div>

      {outside?.okrug ? (
        <div
          data-testid="outside-okrug"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border border-border bg-card-2 px-3 py-2 text-[13px] leading-5 text-muted"
        >
          <span className="inline-flex min-w-0 flex-1 basis-48 items-center gap-1.5">
            <ListFilter aria-hidden className="size-3.5 shrink-0" />
            <span>
              Van filtera: <span className="text-ink">{okrugLabel(outside.okrug)}</span>
              {okrug ? '' : ' (okrug stanice nije poznat)'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {okrug ? (
              <button type="button" onClick={() => outside.onChange(okrug)} className="touch-target font-medium text-ink underline underline-offset-2 hover:no-underline">
                Prikaži {okrugLabel(okrug)}
              </button>
            ) : null}
            <button type="button" onClick={() => outside.onChange(null)} className="touch-target font-medium text-ink underline underline-offset-2 hover:no-underline">
              Ukloni filter
            </button>
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CategoryChip category={view.category} stale={view.stale} size="lg" />
        {view.category ? <p className="min-w-0 flex-1 basis-56 text-sm leading-5 text-ink">{view.category.advice}</p> : null}
      </div>

      {view.stale && view.observedAt ? (
        <div className="rounded-ctl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn-soft-ink">
          <p className="tnum font-medium">
            {/* Starost od KRAJA intervala (`liveStatus().ageText`) – ista kao u čipu ljuske za isti sat. */}
            Poslednji podaci: {formatHourAt(view.observedAt, now)} · {liveStatus(view.observedAt, now).ageText}
          </p>
          <p className="mt-0.5">
            {view.station.active === false
              ? 'Stanica je u SEPA mreži označena kao neaktivna.'
              : `Stanica nije javljala duže od ${STALE_HOURS} h, pa se ne računa u stanje mreže.`}{' '}
            Ispod su poslednje poznate vrednosti
            {view.lastCategory ? ` (tada: ${view.lastCategory.label.toLowerCase()})` : ''}.
          </p>
        </div>
      ) : !view.observedAt ? (
        <p className="text-[13px] text-muted">
          {inactive
            ? 'Stanica je u SEPA mreži označena kao neaktivna i nema snimka trenutnog stanja.'
            : 'Nema snimka trenutnog stanja – stanica nije javljala u prozoru poslednje sinhronizacije.'}
        </p>
      ) : (
        <Readouts view={view} now={now} delayed={delayed} dominant={dominant} value={value} />
      )}
    </div>
  );
}

/** Tri očitavanja „instrumenta“: vreme merenja, rastojanje do sledećeg praga i promena prema proseku 24 h. */
function Readouts({ view, now, delayed, dominant, value }: { view: StationView; now: Date; delayed: boolean; dominant: Parameter | null; value: number | null }) {
  const delta = dominant ? deltaVs24h(view, dominant) : null;
  const hour = liveStatus(view.observedAt, now);
  const rank = view.category?.rank ?? null;
  // Isto pravilo kao Pregled („Moja stanica“, „Najlošije sada“): rastojanje od PRIKAZANE vrednosti.
  const next = dominant && rank !== null && value !== null ? nextThreshold(dominant, value, rank) : null;

  const cell = 'flex min-w-0 items-baseline justify-between gap-3 py-2 @min-[460px]:flex-col @min-[460px]:items-start @min-[460px]:justify-start @min-[460px]:gap-1 @min-[460px]:py-0 @min-[460px]:px-4 @min-[460px]:first:pl-0';

  return (
    <dl className="grid grid-cols-1 divide-y divide-border border-y border-border @min-[460px]:grid-cols-3 @min-[460px]:divide-x @min-[460px]:divide-y-0 @min-[460px]:py-3">
      <div className={cell}>
        <dt className="eyebrow shrink-0">Izmereno</dt>
        <dd className={cn('min-w-0 text-right text-[13px] leading-5 text-muted @min-[460px]:text-left', delayed && 'text-warn')}>
          {/* Satni interval („20–21 h“, sa datumom kad nije današnji) i starost – kao čip mreže. */}
          <span className="tnum font-semibold text-ink">{hour.label}</span> · {hour.ageText}
          {delayed ? ' · kasni' : ''}
        </dd>
      </div>
      <div className={cell}>
        <dt className="eyebrow shrink-0">Do sledećeg praga</dt>
        <dd className="min-w-0 text-right text-[13px] leading-5 text-muted @min-[460px]:text-left">
          {next && dominant ? (
            <>
              {next.remaining > 0 ? (
                <>
                  <span className="tnum font-semibold text-ink">{formatConcentration(next.remaining)}</span> {UNIT}
                </>
              ) : (
                <span className="font-semibold text-ink">na samoj granici</span>
              )}
              <span className="block text-xs text-faint">
                {next.nextLabel} od {formatInt(next.limit)} ({PARAMETER_LABELS[dominant]})
              </span>
            </>
          ) : rank === 5 ? (
            'iznad svih pragova'
          ) : (
            '–'
          )}
        </dd>
      </div>
      <div className={cell}>
        <dt className="eyebrow shrink-0">Prosek 24 h</dt>
        <dd className="min-w-0 text-right @min-[460px]:w-full @min-[460px]:text-left">
          {delta && dominant ? (
            <>
              <KpiDelta
                delta={delta.delta}
                unit={UNIT}
                worseWhen="up"
                format={formatDelta}
                className="justify-end @min-[460px]:justify-start"
              />
              <span className="block text-xs text-faint">
                prosek {formatConcentration(delta.avg24)} ({PARAMETER_LABELS[dominant]})
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted">–</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Izbor polutanta za 30-dnevni grafikon: radio grupa (strelice biraju, jedan tab-stop). */
function ParameterPicker({ options, value, onChange }: { options: readonly Parameter[]; value: Parameter; onChange: (p: Parameter) => void }) {
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.indexOf(value);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = options[next];
    onChange(target);
    requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>(`[data-param="${target}"]`)?.focus());
  };
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Polutant"
      onKeyDown={onKeyDown}
      className="scroll-row -mx-1 flex gap-1 px-1 sm:mx-0 sm:flex-wrap sm:px-0 pointer-coarse:py-1"
    >
      <div className="inline-flex shrink-0 gap-1 rounded-full border border-border bg-card-2 p-1">
        {options.map((p) => {
          const active = p === value;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              data-param={p}
              onClick={() => onChange(p)}
              className={cn(
                'touch-target h-7 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
                active ? 'bg-ink text-page shadow-[0_6px_18px_-8px_var(--haze-glow)]' : 'text-muted hover:text-ink',
              )}
            >
              {PARAMETER_LABELS[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mesto za detalje dok ništa nije izabrano. */
export function StationDetailPlaceholder({ className }: { className?: string }) {
  return (
    <GlassPanel className={cn('flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center', className)}>
      <span className="grid size-14 place-items-center rounded-full border border-border-strong bg-card-2">
        <MapPin aria-hidden className="size-6 text-muted" />
      </span>
      <p className="mt-2 text-sm font-semibold text-ink">Izaberite stanicu</p>
      <p className="max-w-xs text-[13px] leading-5 text-muted">Dodirnite tačku na mapi ili potražite stanicu (Ctrl K) da vidite satne vrednosti i 30-dnevnu istoriju.</p>
    </GlassPanel>
  );
}
