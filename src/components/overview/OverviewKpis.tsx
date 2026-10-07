import { ClockAlert } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT, classify, type Parameter } from '@shared/aqi';

import { markEdge } from '@/components/charts/marks';
import { RingGauge } from '@/components/fx/RingGauge';
import { Sparkline } from '@/components/fx/Sparkline';
import { CategoryChip } from '@/components/ui/Category';
import { KpiDelta, KpiTile, KpiValue } from '@/components/ui/Kpi';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CATEGORIES, catVar, categoryOf } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatDateTime, formatDelta, formatInt, formatPercent, pluralSr } from '@/lib/format';
import { lensLabel, networkDelta24h, networkHourly, okrugLabel, okrugOf, rankByLens, trimLowCoverage } from '@/lib/insights';
import { activeViews, type StationView } from '@/lib/stations';

import { nextThreshold, stationsGenitive } from './overviewText';
import { ScaleBand } from './ScaleBand';

/**
 * Četiri KPI pločice Pregleda (filtrirana mreža; sočivo za „Najlošije sada“). „Najlošije
 * sada“ postoji samo ovde (heroj je ne ponavlja); medijane nose i SEPA skalu svog polutanta.
 */
export function OverviewKpis({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    // Telefon: 1-2-1 (stanice i „najlošije“ preko cele širine, dve medijane jedna pored druge).
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4', className)} style={style}>
      <StationsTile className="col-span-2 sm:col-span-1" />
      <MedianTile parameter="PM10" />
      <MedianTile parameter="PM2.5" />
      <WorstTile className="col-span-2 sm:col-span-1" />
    </div>
  );
}

function StationsTile({ className }: { className?: string }) {
  const { kpis, filteredViews, okrug } = useAtmosfera();
  const wide = useMediaQuery('(min-width: 640px)', true);
  const { reporting, total, stale, inactive } = kpis;
  // Neaktivne (ugašene) stanice nisu deo mreže: ni u brojaču ni u kvadratićima.
  const networkViews = useMemo(() => activeViews(filteredViews), [filteredViews]);
  const share = total ? reporting / total : 0;
  return (
    // Pokrivenost je stanje mreže podataka, ne kvalitet vazduha: prsten je u boji akcenta
    // (izmaglica bi ga obojila u kategoriju i zagađena mreža bi „pocrvenela“ i ovde).
    <KpiTile
      label="Sveže stanice"
      className={className}
      aside={
        <RingGauge
          value={share}
          size={wide ? 50 : 42}
          color="var(--accent)"
          label={`${formatInt(reporting)} od ${formatInt(total)} stanica javlja sveže podatke`}
        >
          <span className="tnum font-mono text-[10px] text-muted">{formatPercent(share).replace(' ', '')}</span>
        </RingGauge>
      }
      footer={
        <>
          <span className="block">
            od {formatInt(total)} {stationsGenitive(total)} {okrug ? `· ${okrugLabel(okrug)}` : 'u mreži'}
          </span>
          {stale > 0 ? (
            // Neutralan čip: žuta je boja kategorije „Umeren“, a ovo je stanje podataka, ne vazduha.
            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border-strong bg-card-2 px-2 text-xs leading-5 text-muted">
              <ClockAlert aria-hidden className="size-3.5 shrink-0" />
              {formatInt(stale)} bez svežih podataka
            </span>
          ) : null}
          {inactive > 0 ? (
            <span className="mt-0.5 block text-xs text-faint">
              {formatInt(inactive)} {pluralSr(inactive, 'neaktivna stanica nije uračunata', 'neaktivne stanice nisu uračunate', 'neaktivnih stanica nije uračunato')}
            </span>
          ) : null}
        </>
      }
    >
      <div className="flex items-baseline gap-1.5">
        <KpiValue value={reporting} />
        <span className="font-heading text-lg font-medium text-faint">/ {formatInt(total)}</span>
      </div>
      <StationStrip views={networkViews} />
    </KpiTile>
  );
}

/**
 * Jedinični prikaz mreže: kvadratić po stanici u boji njene kategorije (najlošije prve),
 * stanice bez svežih podataka kao šuplji kvadratići na kraju. Opis za čitače nabraja brojeve.
 */
function StationStrip({ views }: { views: StationView[] }) {
  const sorted = useMemo(
    () =>
      [...views].sort((a, b) => {
        const ra = a.category?.rank ?? -1;
        const rb = b.category?.rank ?? -1;
        return rb - ra || a.station.name.localeCompare(b.station.name, 'sr-Latn');
      }),
    [views],
  );
  const counts = CATEGORIES.map((category) => views.filter((view) => view.category?.rank === category.rank).length);
  const missing = views.filter((view) => !view.category).length;
  const description = [
    ...counts.map((count, rank) => (count ? `${CATEGORIES[rank].label} ${count}` : null)).filter(Boolean),
    missing ? `bez svežih podataka ${missing}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  if (!views.length) return null;
  return (
    <div
      role="img"
      aria-label={`Stanice po kategoriji: ${description}`}
      data-mark
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9px, 1fr))' }}
    >
      {sorted.map((view) => (
        <span
          key={view.id}
          title={`${view.station.name} · ${view.category?.label ?? 'bez svežih podataka'}`}
          className={cn('aspect-square rounded-[3px]', !view.category && 'border border-faint/60')}
          style={view.category ? { backgroundColor: catVar(view.category.rank), boxShadow: markEdge(view.category.rank) } : undefined}
        />
      ))}
    </div>
  );
}

function MedianTile({ parameter }: { parameter: Parameter }) {
  const { filteredViews, kpis } = useAtmosfera();
  const value = parameter === 'PM10' ? kpis.medianPm10 : kpis.medianPm25;
  // Sati sa premalo stanica na krajevima prozora (stanice kasne različito) nemaju medijanu:
  // kraj linije i promena „… nego pre 24 h“ opisuju isti, dobro pokriven sat.
  const slots = useMemo(() => trimLowCoverage(networkHourly(filteredViews, parameter)), [filteredViews, parameter]);
  const delta = networkDelta24h(slots);
  const rank = value === null ? null : classify(parameter, value);
  const values = slots.map((slot) => slot.median);
  const finite = values.filter((v): v is number => v !== null);
  const label = PARAMETER_LABELS[parameter];
  return (
    <KpiTile label={`Medijana ${label}`} aside={<CategoryChip category={rank === null ? null : categoryOf(rank)} size="sm" />}>
      <KpiValue value={value} unit={UNIT} format={formatConcentration} />
      {/* `block` umesto `flex`: u uskoj pločici reči se prelamaju jedna po jedna, a strelica ostaje uz broj;
          „24 h“ je spojeno tvrdim razmakom (bez usamljenog „h“ u novom redu). */}
      <KpiDelta
        delta={delta ? delta.delta : null}
        unit={UNIT}
        worseWhen="up"
        suffix={'nego pre 24\u00a0h'}
        format={formatDelta}
        className="block [&>span+span]:ml-1"
      />
      {/* Položaj medijane na SEPA skali (ranije merač u heroju) – kategorija je u čipu iznad. */}
      <ScaleBand parameter={parameter} value={value} subject={`Medijana ${label}`} />
      {slots.length && finite.length ? (
        <Sparkline
          className="mt-auto"
          values={values}
          annotate
          height={42}
          label={`Medijana ${label} mreže po satu, poslednja 24 sata, od ${formatConcentration(Math.min(...finite))} do ${formatConcentration(Math.max(...finite))} ${UNIT}`}
          tooltip={(index, slotValue) => (
            <div>
              <p className="tnum font-mono text-[11px] text-muted">{formatDateTime(slots[index].t)}</p>
              {slotValue === null ? (
                <p className="mt-0.5 text-muted">
                  {slots[index].n > 0
                    ? `Premalo stanica (${slots[index].n}) za medijanu mreže`
                    : 'Nema merenja'}
                </p>
              ) : (
                <>
                  <p className="mt-0.5">
                    <span className="tnum text-sm font-semibold text-ink">{formatConcentration(slotValue)}</span> <span className="text-faint">{UNIT}</span>
                  </p>
                  <p className="text-muted">
                    medijana {slots[index].n} {pluralSr(slots[index].n, 'stanice', 'stanice', 'stanica')}
                  </p>
                </>
              )}
            </div>
          )}
        />
      ) : (
        <p className="mt-auto text-xs text-faint">Nema satnih serija za poslednja 24 sata.</p>
      )}
    </KpiTile>
  );
}

function WorstTile({ className }: { className?: string }) {
  const { filteredViews, lens, openStation } = useAtmosfera();
  const wide = useMediaQuery('(min-width: 640px)', true);
  const top = useMemo(() => rankByLens(filteredViews, lens, 1)[0] ?? null, [filteredViews, lens]);
  const label = lens === 'worst' ? 'Najlošije sada' : `Najlošije sada · ${lensLabel(lens)}`;

  if (!top || !top.reading.category || !top.reading.parameter || top.reading.value === null) {
    return (
      <KpiTile label={label} className={className}>
        <p className="text-sm text-faint">{lens === 'worst' ? 'Nema stanica sa svežim podacima.' : `Nijedna stanica nema svežu vrednost ${lensLabel(lens)}.`}</p>
      </KpiTile>
    );
  }

  const { view, reading } = top;
  const parameter = reading.parameter as Parameter;
  const value = reading.value as number;
  const category = reading.category!;
  const next = nextThreshold(parameter, value, category.rank);
  const okrug = okrugOf(view);
  const where = [view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ');

  return (
    <KpiTile
      label={label}
      className={className}
      onClick={() => openStation(view.id)}
      actionLabel="Prikaži na mapi."
      aside={
        // Prsten = vrednost / gornja granica kategorije; natpis ispod kaže šta procenat znači.
        // Visina (prsten + natpis) = najveći dodatak pločice (44/50 px), pa naziv stanice
        // počinje u istoj visini kao vrednosti susednih pločica.
        <div className="flex flex-col items-center gap-0.5">
          <RingGauge
            value={next ? next.share : 1}
            size={wide ? 36 : 30}
            thickness={4}
            color={catVar(category.rank)}
            label={
              next
                ? `${formatConcentration(value)} od ${formatInt(next.limit)} ${UNIT}, gornje granice kategorije ${category.label}`
                : `${formatConcentration(value)} ${UNIT}, iznad svih SEPA pragova`
            }
          >
            <span className="tnum font-mono text-[10px] leading-none text-muted">{next ? formatPercent(next.share).replace(' ', '') : '>'}</span>
          </RingGauge>
          <span aria-hidden className="font-mono text-[10px] leading-3 text-muted">
            {next ? 'do praga' : 'iznad'}
          </span>
        </div>
      }
      footer={
        // „Još“ je razlika od PRIKAZANE vrednosti (57,5 → još 2,5 do 60), isto kao na Mapi.
        next ? (
          next.remaining > 0 ? (
            <>
              Još <span className="tnum font-semibold text-ink">{formatConcentration(next.remaining)}</span> {UNIT} do kategorije {next.nextLabel}
            </>
          ) : (
            <>Na samoj granici kategorije {next.nextLabel}</>
          )
        ) : (
          'Iznad svih SEPA pragova.'
        )
      }
    >
      <div className="min-w-0">
        <p className="line-clamp-2 font-heading text-[17px] font-semibold leading-6 text-ink sm:text-lg">{view.station.name}</p>
        {where ? <p className="truncate text-xs leading-5 text-muted">{where}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CategoryChip category={category} size="sm" />
        <span className="text-[13px] text-muted">
          {PARAMETER_LABELS[parameter]} <span className="tnum font-semibold text-ink">{formatConcentration(value)}</span>{' '}
          <span className="unit-label font-normal text-faint">{UNIT}</span>
        </span>
      </div>
    </KpiTile>
  );
}
