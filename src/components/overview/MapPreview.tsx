import { ArrowUpRight, ListFilter, X } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';

import { PARAMETER_LABELS, UNIT, classify } from '@shared/aqi';

import { GlassPanel } from '@/components/fx/GlassPanel';
import { SerbiaMap } from '@/components/SerbiaMap';
import { SectionHeader } from '@/components/ui/Card';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { LensScope } from '@/components/ui/LensScope';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { CATEGORIES, categoryOf, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatInt, pluralSr, stationsNoun, stationsShort } from '@/lib/format';
import { lensDistribution, lensLabel, okrugAggregates, okrugLabel, resolveLensParameter, stationsWithoutOkrug, type OkrugAggregate } from '@/lib/insights';
import { activeViews } from '@/lib/stations';

const TOP_OKRUGS = 4;

/**
 * Pregled mape: ista `SerbiaMap` kao na stranici Mapa, u kompaktnom obliku (bez mreže,
 * razmernika, legende i izmaglice – ovde nema mesta za natpis da je izmaglica ilustracija).
 * Boja tačke je kategorija kroz sočivo, izabrani okrug je uvećan i istaknut, a stanice van njega
 * prigušene; gust okrug je na celoj mapi grupa stanica – dodir na nju filtrira stranicu po tom
 * okrugu (`setOkrug`); neaktivne (ugašene) stanice se ne crtaju. Klik na stanicu je otvara na Mapi; ispod
 * je tekstualna legenda sa brojem stanica, a pored mape okruzi sa najvišom medijanom i brojem
 * stanica u uzorku (klik filtrira stranicu).
 */
export function MapPreview({ className, style }: { className?: string; style?: CSSProperties }) {
  const { views, filteredViews, lens, okrug, setOkrug, navigate, openStation } = useAtmosfera();
  const mapViews = useMemo(() => activeViews(views), [views]);
  const counts = useMemo(() => lensDistribution(filteredViews, lens).counts, [filteredViews, lens]);
  const withoutOkrug = useMemo(() => stationsWithoutOkrug(views), [views]);

  const parameter = resolveLensParameter(lens);
  const allAggregates = useMemo(() => okrugAggregates(filteredViews, lens), [filteredViews, lens]);
  const aggregates = allAggregates.filter((entry) => entry.nowMedian !== null).slice(0, TOP_OKRUGS);
  const selected = okrug ? (allAggregates.find((entry) => entry.okrug === okrug) ?? null) : null;

  return (
    <GlassPanel className={cn('ov-map flex flex-col gap-4 p-4 sm:p-5 lg:p-6', className)} style={style} aria-labelledby="map-preview-title">
      <SectionHeader
        id="map-preview-title"
        eyebrow={
<LensScope lens={lens} okrug={okrug} />
        }
        title="Mapa mreže"
        actions={
          <button
            type="button"
            onClick={() => navigate('mapa')}
            className="touch-target group inline-flex h-8 items-center gap-1 rounded-full border border-border-strong px-3 text-[13px] font-medium text-ink transition-colors hover:border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] hover:bg-card-2"
          >
            Otvori mapu
            <ArrowUpRight aria-hidden className="size-3.5 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
        }
      />

      <div className="ov-map__body">
        <div className="ov-map__frame flex min-w-0 flex-col items-center gap-3">
          <SerbiaMap
            views={mapViews}
            lens={lens}
            okrug={okrug}
            compact
            showHaze={false}
            onSelect={openStation}
            onOkrug={setOkrug}
            maxHeight="var(--ov-map-h, 360px)"
            className="w-full"
          />
          <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted" aria-label={`Broj stanica po kategoriji, ${lensLabel(lens)}`}>
            {RANKS.map((rank) =>
              counts[rank] ? (
                <li key={rank} className="inline-flex items-center gap-1.5">
                  <CategoryDot rank={rank} size={8} />
                  {CATEGORIES[rank].label}
                  <span className="tnum font-mono text-[12px] text-ink sm:text-[11px]">{formatInt(counts[rank])}</span>
                </li>
              ) : null,
            )}
          </ul>
          <p className="text-center text-xs text-faint">Klik na stanicu je otvara na mapi.</p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {okrug ? (
            <div className="flex flex-col gap-2 rounded-tile border border-[color-mix(in_oklab,var(--haze)_40%,var(--border))] bg-[color-mix(in_oklab,var(--haze)_7%,transparent)] px-3.5 py-3">
              <p className="eyebrow flex items-center gap-1.5">
                <ListFilter aria-hidden className="size-3" /> Aktivan filter
              </p>
              <p className="text-sm text-ink">
                {okrugLabel(okrug)} · <span className="tnum">{formatInt(activeViews(filteredViews).length)}</span>{' '}
                {stationsNoun(activeViews(filteredViews).length)}
              </p>
              {selected ? <OkrugStats entry={selected} /> : null}
              <p className="text-xs leading-5 text-muted">Mapa je uvećana na okrug (susedi prigušeni); KPI, ritam i rang-lista prikazuju samo ovaj okrug.</p>
              <button
                type="button"
                onClick={() => setOkrug(null)}
                className="inline-flex h-8 items-center gap-1.5 self-start rounded-full border border-border-strong px-3 text-[13px] text-ink transition-colors hover:bg-card-2"
              >
                <X aria-hidden className="size-3.5" />
                Prikaži celu mrežu
              </button>
            </div>
          ) : aggregates.length ? (
            <div className="flex flex-col gap-1.5">
              <p className="eyebrow">Okruzi · medijana {PARAMETER_LABELS[parameter]} sada</p>
              <ul className="flex flex-col">
                {aggregates.map((entry) => {
                  const category = categoryOf(classify(entry.parameter, entry.nowMedian as number));
                  return (
                    <li key={entry.okrug}>
                      <button
                        type="button"
                        onClick={() => setOkrug(entry.okrug)}
                        className="flex h-9 w-full items-center gap-2.5 rounded-ctl px-2 text-left text-[13px] transition-colors hover:bg-card-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-ink">{entry.label}</span>
                        <CategoryChip category={category} size="sm" />
                        <span className="w-[78px] shrink-0 whitespace-nowrap text-right">
                          <span className="tnum font-semibold text-ink">{formatConcentration(entry.nowMedian)}</span>{' '}
                          <span className="unit-label text-faint">{UNIT}</span>
                        </span>
                        {/* Uzorak medijane: okrug sa jednom stanicom je vrednost te stanice, ne slika okruga. */}
                        <span className="tnum w-[38px] shrink-0 whitespace-nowrap text-right text-xs text-muted">
                          <span aria-hidden>{stationsShort(entry.stations)}</span>
                          <span className="sr-only">
                            , {formatInt(entry.stations)} {stationsNoun(entry.stations)}
                          </span>
                        </span>
                        <span className="sr-only">. Filtriraj stranicu po ovom okrugu.</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="px-2 text-xs text-faint">
                Medijana svežih stanica okruga; „st.“ je broj stanica. Klik na okrug filtrira celu stranicu.
                {withoutOkrug > 0
                  ? ` ${formatInt(withoutOkrug)} ${pluralSr(withoutOkrug, 'stanica nema poznat okrug i nije', 'stanice nemaju poznat okrug i nisu', 'stanica nema poznat okrug i nije')} u listi okruga.`
                  : ''}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </GlassPanel>
  );
}

/** Brojevi izabranog okruga: medijana polutanta sada, medijana proseka 24 h i najgora kategorija. */
function OkrugStats({ entry }: { entry: OkrugAggregate }) {
  const label = PARAMETER_LABELS[entry.parameter];
  const nowCategory = entry.nowMedian === null ? null : categoryOf(classify(entry.parameter, entry.nowMedian));
  return (
    <div className="@container my-1">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @min-[420px]:grid-cols-3">
        <div className="min-w-0">
          <dt className="eyebrow">{label} sada</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="font-heading text-xl font-semibold text-ink">{entry.nowMedian === null ? '–' : formatConcentration(entry.nowMedian)}</span>
            {entry.nowMedian === null ? null : <span className="unit-label text-faint">{UNIT}</span>}
            {nowCategory ? <CategoryChip category={nowCategory} size="sm" className="self-center" /> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow">Prosek 24 h</dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="font-heading text-xl font-semibold text-ink">{entry.avg24Median === null ? '–' : formatConcentration(entry.avg24Median)}</span>
            {entry.avg24Median === null ? null : <span className="unit-label text-faint">{UNIT}</span>}
          </dd>
        </div>
        <div className="col-span-2 min-w-0 @min-[420px]:col-span-1">
          <dt className="eyebrow">Najlošije u okrugu</dt>
          <dd className="mt-1.5">
            <CategoryChip category={entry.worstCategory} size="sm" />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-faint">
        Medijane svežih stanica okruga ({formatInt(entry.stations)} od {formatInt(entry.total)}).
      </p>
    </div>
  );
}
