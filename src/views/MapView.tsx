import { ArrowDown, CloudFog } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { SerbiaMap } from '@/components/SerbiaMap';
import { StationDetail, StationDetailPlaceholder } from '@/components/StationDetail';
import { GlassPanel } from '@/components/fx/GlassPanel';
import { LinkNotice } from '@/components/map/LinkNotice';
import { useDetailBelow, WIDE_QUERY } from '@/components/map/selectedStrip';
import { SectionHeader } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/Category';
import { LensScope } from '@/components/ui/LensScope';
import { useAtmosfera } from '@/hooks/useAtmosfera';
import { useMeasure } from '@/hooks/useMeasure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMyStation } from '@/hooks/useMyStation';
import { cn } from '@/lib/cn';
import { formatConcentration } from '@/lib/format';
import { lensOf, okrugOf } from '@/lib/insights';
import { prefersReducedMotion } from '@/lib/motion';
import { isInactive, type StationView } from '@/lib/stations';

/**
 * Mapa: velika mapa stanica (sočivo boji markere; filter okruga uvećava mapu na okrug i prigušuje
 * ostale stanice; gust okrug je na celoj mapi grupa koju dodir otvara kroz `setOkrug`) i detalji
 * izabrane stanice. Izbor se upisuje u `?station=` (duboki link).
 *
 * Raspored:
 *  - xl (≥ 1280 px): mapa levo preko dva reda (5/12, na 2xl 4/12), desno zaglavlje stanice
 *    i 24 h; 30 dana ispod preko cele širine. Panel mape se rasteže do visine desne kolone,
 *    a okvir mape popunjava višak (mreža stepeni se nastavlja oko zemlje).
 *  - uže: sve jedno ispod drugog; kad je panel mape širok (tablet, uski desktop), legenda
 *    stoji pored mape, a na telefonu ispod nje. Traka izabrane stanice sa „Detalji ↓“
 *    (`SelectedStrip`, vidi `map/selectedStrip.ts`): na lg–xl odmah ispod okvira mape (pre
 *    legende), lepljiva uz dno ekrana; ispod lg (donja navigacija) lebdi iznad donje navigacije
 *    dok su detalji ispod ekrana – dodir na tačku se vidi na svakoj visini telefona.
 *
 * Neaktivne stanice (SEPA ih je ugasila) nisu na mapi – osim kad je baš neaktivna stanica
 * izabrana (npr. sa stranice Stanice); legenda kaže koliko ih nije prikazano. Neispravan link
 * (`?station=` koje nema) se prijavljuje (`LinkNotice`), a stanica van izabranog okruga to kaže
 * u zaglavlju detalja.
 */
export function MapView() {
  const { views, okrug, setOkrug, selected, selectedId, selectStation, service, dataVersion, now, lens } = useAtmosfera();
  const detailRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [haze, setHaze] = useState(true);
  const { isMine, toggleMyStation } = useMyStation(views);

  const mapViews = useMemo(() => views.filter((view) => !isInactive(view) || view.id === selectedId), [views, selectedId]);
  const hiddenInactive = views.length - mapViews.length;

  // lg i šire: bočna traka umesto donje navigacije – traka izabrane stanice je u toku (lg–xl).
  const wide = useMediaQuery(WIDE_QUERY);
  const detailBelow = useDetailBelow(detailRef, Boolean(selected) && !wide);

  const scrollToDetail = useCallback(() => {
    detailRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const strip = selected ? (
    <SelectedStrip view={selected} outside={okrug !== null && okrugOf(selected) !== okrug} onDetails={scrollToDetail} placement={wide ? 'flow' : 'fixed'} />
  ) : null;

  return (
    <div data-testid="view-mapa" className="grid grid-cols-1 gap-4 lg:gap-5 xl:grid-cols-12">
      <LinkNotice className="xl:col-span-12" />
      <GlassPanel
        aria-labelledby={titleId}
        className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:p-6 xl:col-span-5 xl:row-span-2 2xl:col-span-4 [--map-max-h:560px] xl:[--map-max-h:none]"
      >
        <SectionHeader
          className="flex-nowrap [&>div:first-child]:flex-1"
          id={titleId}
          eyebrow={<LensScope lens={lens} okrug={okrug} />}
          title="Mapa stanica"
          hint="Boja tačke je SEPA kategorija kroz sočivo. Izaberite stanicu za detalje."
          actions={
            <button
              type="button"
              aria-pressed={haze}
              onClick={() => setHaze((on) => !on)}
              title="Izmaglica je ilustracija oko stanica – nije merenje između stanica"
              className={cn(
                'touch-target inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color] duration-150',
                haze
                  ? 'border-[color-mix(in_oklab,var(--haze)_45%,var(--border-strong))] bg-[color-mix(in_oklab,var(--haze)_12%,transparent)] text-ink'
                  : 'border-border-strong bg-panel text-muted hover:text-ink',
              )}
            >
              <CloudFog aria-hidden className="size-3.5" />
              Izmaglica
            </button>
          }
        />
        <SerbiaMap
          className="flex-auto"
          views={mapViews}
          okrug={okrug}
          lens={lens}
          selectedId={selectedId}
          onSelect={selectStation}
          onOkrug={setOkrug}
          showHaze={haze}
          hiddenInactive={hiddenInactive}
          afterMap={wide ? strip : null}
        />
      </GlassPanel>
      {/* Telefon: traka lebdi iznad donje navigacije dok su detalji ispod ekrana (van panela – fiksan položaj). */}
      {!wide && detailBelow ? strip : null}

      {selected ? (
        <StationDetail
          view={selected}
          service={service}
          dataVersion={dataVersion}
          now={now}
          lens={lens}
          summaryRef={detailRef}
          myStation={{ mine: isMine(selected.id), onToggle: () => toggleMyStation(selected.id) }}
          scope={{ okrug, onChange: setOkrug }}
          classNames={{ summary: 'xl:col-span-7 2xl:col-span-8', hourly: 'xl:col-span-7 2xl:col-span-8', daily: 'xl:col-span-12' }}
        />
      ) : (
        <StationDetailPlaceholder className="xl:col-span-7 xl:row-span-2 2xl:col-span-8" />
      )}
    </div>
  );
}

/**
 * Traka izabrane stanice (dok su detalji ispod mape, tj. ispod xl): ime, kategorija i
 * vrednost kroz sočivo, sa dugmetom do detalja – izbor tačke ne pomera stranicu, pa se mapa
 * može mirno istraživati. `placement`: `flow` ispod okvira mape (lg–xl, lepljiva uz dno ekrana),
 * `fixed` iznad donje navigacije (< lg; položaj i animacija u mapa.css, `.map-strip--fixed`).
 * Fiksna traka objavljuje svoju visinu kao `--map-strip-h` na `<html>` dok postoji, da plutajuće
 * obaveštenje sinhronizacije (`SyncToast`) stane iznad nje, a ne preko nje.
 */
function SelectedStrip({ view, outside, onDetails, placement }: { view: StationView; outside: boolean; onDetails: () => void; placement: 'flow' | 'fixed' }) {
  const { lens } = useAtmosfera();
  const reading = lensOf(view, lens);
  const [stripRef, stripSize] = useMeasure<HTMLDivElement>();
  useEffect(() => {
    if (placement !== 'fixed' || !stripSize.height) return;
    const root = document.documentElement;
    root.style.setProperty('--map-strip-h', `${Math.round(stripSize.height) + 8}px`);
    return () => {
      root.style.removeProperty('--map-strip-h');
    };
  }, [placement, stripSize.height]);
  return (
    <div
      ref={stripRef}
      data-testid="selected-strip"
      data-placement={placement}
      className={cn(
        'map-strip flex items-center gap-3 rounded-tile border py-2 pl-3 pr-2 xl:hidden',
        placement === 'flow' ? 'border-border bg-card-2 lg:sticky lg:bottom-3 lg:z-10' : 'map-strip--fixed border-border-strong bg-panel-solid shadow-float lg:hidden',
      )}
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{view.station.name}</p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {isInactive(view) ? (
            <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border border-dashed border-border-strong px-1.5 text-[12px] font-medium text-muted sm:text-[11px]">
              Neaktivna
            </span>
          ) : (
            <CategoryChip category={view.stale ? null : reading.category} stale={view.stale} size="sm" />
          )}
          {reading.parameter && reading.value !== null ? (
            // Vrednost je glavni podatak trake: ne skraćuje se; „van filtera“ prelazi u novi red.
            <span className="shrink-0 whitespace-nowrap">
              {PARAMETER_LABELS[reading.parameter]} <span className="tnum font-semibold text-ink">{formatConcentration(reading.value)}</span> {UNIT}
            </span>
          ) : null}
          {outside ? (
            <span
              className="inline-flex h-5 min-w-0 items-center truncate rounded-full border border-dashed border-border-strong px-1.5 text-xs text-muted"
              title="Stanica je van izabranog okruga"
            >
              van filtera
            </span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={onDetails}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-ctl bg-ink px-3 text-[13px] font-medium text-page transition-[filter] hover:brightness-110 pointer-coarse:h-11 pointer-coarse:px-3.5"
      >
        Detalji
        <ArrowDown aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
