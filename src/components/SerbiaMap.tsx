import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { mapFrame, mapGeometry } from '@/components/map/geometry';
import {
  buildMarkers,
  markerColor,
  neighborInDirection,
  summarizeMarkers,
  type MapMarker,
  type MarkerKind,
  type MarkerSummary,
  type NavDirection,
} from '@/components/map/markers';
import { CategoryChip } from '@/components/ui/Category';
import { useMeasure } from '@/hooks/useMeasure';
import { CATEGORIES, catVar, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatInt, pluralSr } from '@/lib/format';
import { lensLabel, okrugLabel, okrugOf, type Lens } from '@/lib/insights';
import { isInactive, liveStatus, type StationView } from '@/lib/stations';

import '@/styles/mapa.css';

export interface SerbiaMapProps {
  /** Stanice za crtanje. Za filter okruga prosledite SVE stanice i `okrug` (ostale se prigušuju). */
  views: StationView[];
  /** Izabrana stanica (veća tačka, prsten akcenta, talasi i natpis sa imenom). */
  selectedId?: string | null;
  /** Klik/Enter na marker. Bez ovoga markeri su i dalje fokusabilni (tooltip), ali ništa ne biraju. */
  onSelect?: (stationId: string) => void;
  /** Sočivo polutanta: boja markera je kategorija tog polutanta (podrazumevano `'worst'`). */
  lens?: Lens;
  /** Izabrani okrug: njegov okrug se ističe, stanice van njega su prigušene. */
  okrug?: string | null;
  /**
   * Kompaktni pregled (npr. kartica na drugoj stranici): manje tačke, bez legende,
   * natpisa stepeni, razmernika, talasa i natpisa izabrane stanice.
   */
  compact?: boolean;
  /**
   * Sloj izmaglice (mutni krugovi iste veličine u boji kategorije oko stanica); podrazumevano
   * uključen osim u kompaktnom obliku. Kompaktna mapa ga nikad ne crta – nema legende sa
   * natpisom da je izmaglica ilustracija, a ne merenje između stanica.
   */
  showHaze?: boolean;
  /** Neaktivne stanice koje pozivalac nije prosledio (napomena u legendi). */
  hiddenInactive?: number;
  /** Legenda (podrazumevano `!compact`): ispod mape, a pored nje kad je kontejner širi od 600 px. */
  showLegend?: boolean;
  /**
   * Najveća visina okvira mape (CSS dužina). Podrazumevano `var(--map-max-h, 560px)`; sa
   * `none` okvir sme da raste uz roditelja (flex), a mreža stepeni popunjava višak prostora.
   */
  maxHeight?: string;
  /**
   * Sadržaj odmah ispod okvira mape, pre legende (npr. traka izabrane stanice na telefonu):
   * izbor tačke je tako vidljiv bez skrolovanja preko duge legende.
   */
  afterMap?: ReactNode;
  className?: string;
}

const ARROWS: Record<string, NavDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * Poluprečnik kruga izmaglice (viewBox jedinice ≈ 0,58 km): ISTI za sve kategorije – veći krug
 * za lošiju kategoriju bi izgledao kao veće zagađeno područje, a merenje je samo u tački.
 */
export const HAZE_RADIUS = 46;

/** Natpis uz sloj izmaglice (legenda Mape). */
export const HAZE_CAPTION = 'Izmaglica je ilustracija oko stanica – nije merenje između stanica.';

/**
 * SVG mapa Srbije sa okruzima i stanicama („instrument“ stil): okruzi lebde nad panelom sa
 * blagim sjajem izmaglice, iza je mreža meridijana/paralela, a sloj izmaglice meša mutne
 * krugove u boji kategorije (screen u tamnoj, multiply u svetloj temi). Okvir prati veličinu
 * kontejnera (viši/širi okvir → mreža se nastavlja oko zemlje).
 *
 * Stanice su pravi `<button>` elementi preko mape (cilj 28 px, tooltip i na fokus). Na mapu
 * se ulazi jednim Tab-om; strelice vode do najbliže stanice u tom smeru, Home/End do prve
 * (severno) i poslednje (južno), Enter bira. Kategorija ≥ „Zagađen“ pulsira; izabrana ima talase.
 */
export function SerbiaMap({
  views,
  selectedId = null,
  onSelect,
  lens = 'worst',
  okrug = null,
  compact = false,
  showHaze,
  hiddenInactive = 0,
  showLegend,
  maxHeight = 'var(--map-max-h, 560px)',
  afterMap,
  className,
}: SerbiaMapProps) {
  const geometry = mapGeometry();
  const { projection, districts } = geometry;
  const uid = useId().replace(/:/g, '');
  const hintId = `${uid}-hint`;
  const [areaRef, size] = useMeasure<HTMLDivElement>();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const frame = useMemo(() => mapFrame(geometry, size.width, size.height), [geometry, size.width, size.height]);
  const { vb } = frame;
  const leftPct = (x: number) => ((x - vb.x) / vb.w) * 100;
  const topPct = (y: number) => ((y - vb.y) / vb.h) * 100;

  const markers = useMemo(() => buildMarkers(views, projection, { lens, okrug }), [views, projection, lens, okrug]);
  const summary = useMemo(() => summarizeMarkers(markers), [markers]);
  const withoutPosition = views.filter((view) => view.position === null).length;
  const hovered = markers.find((m) => m.id === hoverId) ?? null;
  const selected = markers.find((m) => m.id === selectedId) ?? null;
  const legend = showLegend ?? !compact;
  const haze = (showHaze ?? true) && !compact;
  const activeDistrict = okrug ? (districts.find((district) => district.name === okrug) ?? null) : null;
  const measured = size.width > 0;

  // Jedan tab-stop za sve stanice (roving tabindex): poslednja fokusirana, izabrana ili prva.
  const tabbableId =
    (cursorId && markers.some((m) => m.id === cursorId) ? cursorId : null) ?? selected?.id ?? markers[0]?.id ?? null;

  const setButton = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(id, node);
    else buttons.current.delete(id);
  }, []);

  const clearHover = (id: string) => setHoverId((current) => (current === id ? null : current));
  const focusMarker = (id: string | null | undefined) => {
    if (!id) return;
    setCursorId(id);
    buttons.current.get(id)?.focus();
  };
  const onMarkerKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      focusMarker(neighborInDirection(markers, id, direction));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusMarker(event.key === 'Home' ? markers[0]?.id : markers[markers.length - 1]?.id);
    } else if (event.key === 'Escape') {
      setHoverId(null);
    }
  };

  const label = `Mapa Srbije sa ${markers.length} ${pluralSr(markers.length, 'stanicom', 'stanice', 'stanica')}; boja tačke je kategorija kroz sočivo ${lensLabel(lens)}${okrug ? `, istaknut ${okrugLabel(okrug)}` : ''}. Stanice su dugmad preko mape.`;
  const vbAttr = `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`;

  return (
    <div data-testid="serbia-map" className={cn('smap @container flex w-full min-w-0 flex-col', compact && 'smap--compact', className)}>
      <div className={cn('flex flex-auto flex-col gap-4', legend && '@min-[600px]:flex-row @min-[600px]:items-start @min-[600px]:gap-6')}>
        {/* Okvir mape i (opciono) sadržaj ispod njega; u redu sa legendom ova kolona se rasteže. */}
        <div className="flex min-w-0 shrink-0 grow basis-auto flex-col gap-4 @min-[600px]:self-stretch">
          <div
            ref={areaRef}
            className="smap__area relative min-w-0 shrink-0 grow basis-auto"
            style={{ aspectRatio: `${projection.width} / ${projection.height}`, maxHeight }}
          >
            {/* Mreža stepeni preko celog okvira (blago se gubi ka uglovima). */}
            <svg viewBox={vbAttr} preserveAspectRatio="none" className="smap__graticule-layer absolute inset-0 h-full w-full" aria-hidden>
              {frame.graticule.map((line) =>
                line.axis === 'lat' ? (
                  <line key={line.key} x1={vb.x} x2={vb.x + vb.w} y1={line.at} y2={line.at} className="smap__graticule" vectorEffect="non-scaling-stroke" />
                ) : (
                  <line key={line.key} x1={line.at} x2={line.at} y1={vb.y} y2={vb.y + vb.h} className="smap__graticule" vectorEffect="non-scaling-stroke" />
                ),
              )}
            </svg>

            <svg viewBox={vbAttr} className="smap__land absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={label}>
              {districts.map((district) => (
                <path
                  key={district.name}
                  d={district.d}
                  fillRule="evenodd"
                  className="smap__district"
                  data-kosovo={district.kosovo || undefined}
                  data-muted={okrug && district.name !== okrug ? true : undefined}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{okrugLabel(district.name)}</title>
                </path>
              ))}
              {/* Izabrani okrug se crta još jednom na vrhu, da mu ivica ne bude prekrivena susedima. */}
              {activeDistrict ? (
                <path d={activeDistrict.d} fillRule="evenodd" className="smap__district pointer-events-none" data-active vectorEffect="non-scaling-stroke" />
              ) : null}
            </svg>

            {haze ? (
              <svg viewBox={vbAttr} className="smap__haze pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <defs>
                  <clipPath id={`${uid}-land`}>
                    {districts.map((district) => (
                      <path key={district.name} d={district.d} />
                    ))}
                  </clipPath>
                  {RANKS.map((rank) => (
                    <radialGradient key={rank} id={`${uid}-h${rank}`}>
                      <stop offset="0%" style={{ stopColor: catVar(rank) }} stopOpacity={0.7} />
                      <stop offset="45%" style={{ stopColor: catVar(rank) }} stopOpacity={0.32} />
                      <stop offset="100%" style={{ stopColor: catVar(rank) }} stopOpacity={0} />
                    </radialGradient>
                  ))}
                </defs>
                <g clipPath={`url(#${uid}-land)`}>
                  {markers.map((marker) =>
                    marker.rank === null || marker.dimmed ? null : (
                      <circle key={marker.id} cx={marker.x} cy={marker.y} r={HAZE_RADIUS} fill={`url(#${uid}-h${marker.rank})`} />
                    ),
                  )}
                </g>
              </svg>
            ) : null}

            {!compact && measured ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 font-mono text-[9px] leading-none text-faint">
                {frame.graticule.map((line) =>
                  line.axis === 'lat' ? (
                    line.pct > 5 && line.pct < 99 ? (
                      <span key={line.key} className="tnum absolute right-0 -translate-y-[calc(100%+3px)]" style={{ top: `${line.pct}%` }}>
                        {line.label}N
                      </span>
                    ) : null
                  ) : line.pct > 1 && line.pct < 90 ? (
                    <span key={line.key} className="tnum absolute top-0 translate-x-[3px]" style={{ left: `${line.pct}%` }}>
                      {line.label}E
                    </span>
                  ) : null,
                )}
                <span className="absolute bottom-0 left-0 flex flex-col gap-1" style={{ width: `${frame.scaleBarPct}%` }}>
                  <span className="tnum">50 km</span>
                  <span className="block h-1.5 border-x border-b border-muted/70" />
                </span>
              </div>
            ) : null}

            <div role="group" aria-label={`Stanice na mapi (${markers.length})`} aria-describedby={hintId} className="pointer-events-none absolute inset-0">
              <p id={hintId} className="sr-only">
                Strelice vode do najbliže stanice u tom smeru, Home i End do prve i poslednje, Enter bira stanicu.
              </p>
              {markers.map((marker) => {
                const isSelected = marker.id === selectedId;
                const style = {
                  left: `${leftPct(marker.x)}%`,
                  top: `${topPct(marker.y)}%`,
                  zIndex: isSelected ? 6 : marker.dimmed ? 1 : marker.rank === null ? 2 : 3 + Number(marker.alert),
                  '--mk': markerColor(marker),
                } as CSSProperties;
                return (
                  <button
                    key={marker.id}
                    ref={(node) => setButton(marker.id, node)}
                    type="button"
                    className="mk"
                    tabIndex={marker.id === tabbableId ? 0 : -1}
                    data-kind={marker.kind}
                    data-dim={marker.dimmed && !isSelected ? true : undefined}
                    data-selected={isSelected || undefined}
                    aria-label={marker.label}
                    aria-pressed={onSelect ? isSelected : undefined}
                    onClick={onSelect ? () => onSelect(marker.id) : undefined}
                    onPointerEnter={() => setHoverId(marker.id)}
                    onPointerLeave={() => clearHover(marker.id)}
                    onFocus={() => {
                      setCursorId(marker.id);
                      setHoverId(marker.id);
                    }}
                    onBlur={() => clearHover(marker.id)}
                    onKeyDown={(event) => onMarkerKey(event, marker.id)}
                    style={style}
                  >
                    <span aria-hidden className="mk__glow" />
                    {marker.alert ? <span aria-hidden className="mk__halo" /> : null}
                    {isSelected && !compact ? (
                      <>
                        <span aria-hidden className="mk__ripple" />
                        <span aria-hidden className="mk__ripple mk__ripple--late" />
                      </>
                    ) : null}
                    {/* Boja tačke je podatak (kategorija): ostaje i u režimu visokog kontrasta. */}
                    <span aria-hidden data-mark className="mk__dot" />
                  </button>
                );
              })}
            </div>

            {/* Ime izabrane stanice uz tačku (ne hvata pokazivač – markeri ispod ostaju dostupni). */}
            {selected && !compact && measured ? <SelectedLabel marker={selected} left={leftPct(selected.x)} top={topPct(selected.y)} lens={lens} /> : null}

            {hovered && measured && (hovered.id !== selectedId || compact)
              ? (() => {
                  const top = topPct(hovered.y);
                  const below = top < 24;
                  return (
                    <ChartTooltip
                      x={(leftPct(hovered.x) / 100) * size.width}
                      y={(top / 100) * size.height + (below ? 16 : -16)}
                      placement={below ? 'below' : 'above'}
                      containerWidth={size.width}
                    >
                      <MarkerTooltip marker={hovered} lens={lens} />
                    </ChartTooltip>
                  );
                })()
              : null}
          </div>
          {afterMap}
        </div>

        {legend ? (
          <MapLegend
            summary={summary}
            lens={lens}
            okrug={okrug}
            total={markers.length}
            withoutPosition={withoutPosition}
            hiddenInactive={hiddenInactive}
            haze={haze}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Legenda: raspodela kategorija kroz sočivo (traka + brojevi), vrste oznaka i napomene. */
function MapLegend({
  summary,
  lens,
  okrug,
  total,
  withoutPosition,
  hiddenInactive,
  haze,
}: {
  summary: MarkerSummary;
  lens: Lens;
  okrug: string | null;
  total: number;
  withoutPosition: number;
  hiddenInactive: number;
  haze: boolean;
}) {
  const ranked = summary.byRank.reduce((sum, count) => sum + count, 0);
  const inScope = total - summary.dimmed;
  return (
    <div className="smap__legend flex min-w-0 flex-col gap-3.5 @min-[600px]:w-[236px] @min-[600px]:shrink-0 @min-[600px]:pt-1">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Kategorija · {lensLabel(lens)}</p>
          <p className="tnum shrink-0 font-mono text-[11px] text-muted">
            {formatInt(ranked)}/{formatInt(inScope)}
          </p>
        </div>
        {/* Traka raspodele (2 px razmak između segmenata); brojevi su i u listi ispod. */}
        <div aria-hidden data-mark className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-card-2">
          {RANKS.map((rank) =>
            summary.byRank[rank] > 0 ? (
              <span key={rank} className="smap__share h-full first:rounded-l-full last:rounded-r-full" style={{ flexGrow: summary.byRank[rank], background: catVar(rank) }} />
            ) : null,
          )}
        </div>
        <ul
          className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs @min-[420px]:grid-cols-3 @min-[600px]:grid-cols-1"
          aria-label={`Broj stanica po kategoriji kroz sočivo ${lensLabel(lens)}${okrug ? `, ${okrugLabel(okrug)}` : ''}`}
        >
          {RANKS.map((rank) => {
            const count = summary.byRank[rank];
            return (
              <li key={rank} className={cn('flex min-w-0 items-center gap-1.5', count === 0 ? 'text-faint' : 'text-ink')}>
                <MarkerKey kind="exact" color={catVar(rank)} dim={count === 0} />
                <span className="truncate">{CATEGORIES[rank].label}</span>
                <span className={cn('tnum ml-auto font-mono text-[11px] @min-[420px]:ml-0 @min-[600px]:ml-auto', count === 0 ? 'text-faint' : 'text-muted')}>{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted @min-[600px]:flex-col" aria-label="Vrste oznaka na mapi">
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="approx" color="var(--muted)" />
          približna lokacija (centar okruga)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="stale" />
          bez svežih podataka
          <span className="tnum font-mono text-[11px] text-faint">{summary.stale}</span>
        </li>
        {summary.none > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <MarkerKey kind="none" />
            {lens === 'worst' ? 'nema podataka' : `ne meri ${lensLabel(lens)}`}
            <span className="tnum font-mono text-[11px] text-faint">{summary.none}</span>
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="exact" color={catVar(3)} halo />
          pulsira: Zagađen i lošije
          <span className="tnum font-mono text-[11px] text-faint">{summary.alert}</span>
        </li>
        {okrug ? (
          <li className="inline-flex items-center gap-1.5">
            <MarkerKey kind="exact" color="var(--muted)" dim />
            van okruga (prigušeno)
            <span className="tnum font-mono text-[11px] text-faint">{summary.dimmed}</span>
          </li>
        ) : null}
        {haze ? (
          <li className="inline-flex w-full items-start gap-1.5" data-testid="haze-caption">
            <span aria-hidden className="smap__haze-key mt-px" />
            <span>{HAZE_CAPTION}</span>
          </li>
        ) : null}
      </ul>

      <p className="text-xs leading-5 text-muted">
        Okruzi na Kosovu i Metohiji su prikazani bledo – državna mreža SEPA tamo nema stanica. Bliske
        stanice su malo razmaknute da se tačke ne preklapaju.
        {withoutPosition
          ? ` ${withoutPosition} ${pluralSr(withoutPosition, 'stanica nije', 'stanice nisu', 'stanica nije')} na mapi (nepoznata opština).`
          : ''}
        {hiddenInactive
          ? ` ${formatInt(hiddenInactive)} ${pluralSr(hiddenInactive, 'neaktivna stanica (SEPA ju je ugasila) nije', 'neaktivne stanice (SEPA ih je ugasila) nisu', 'neaktivnih stanica (SEPA ih je ugasila) nije')} na mapi.`
          : ''}
      </p>
    </div>
  );
}

/** Mala oznaka za legendu – iste klase kao pravi marker. */
function MarkerKey({ kind, color, halo = false, dim = false }: { kind: MarkerKind; color?: string; halo?: boolean; dim?: boolean }) {
  return (
    <span aria-hidden data-mark className="mk-key" data-kind={kind} data-dim={dim || undefined} style={{ '--mk': color ?? 'var(--faint)' } as CSSProperties}>
      {halo ? <span className="mk__halo" /> : null}
      <span className="mk__dot" />
    </span>
  );
}

function readingText(marker: MapMarker, lens: Lens): string | null {
  if (marker.kind === 'stale') return 'zastarelo';
  const { parameter, value } = marker.reading;
  if (!parameter || value === null) return marker.view.snapshot ? `ne meri ${lensLabel(lens)}` : null;
  return `${PARAMETER_LABELS[parameter]} ${formatConcentration(value)}`;
}

/** Natpis izabrane stanice: ime + vrednost kroz sočivo, levo ili desno od tačke. */
function SelectedLabel({ marker, left, top, lens }: { marker: MapMarker; left: number; top: number; lens: Lens }) {
  // Natpis ide na stranu sa više mesta (ime se skraćuje tek kad ni tu ne staje).
  const flip = left > 50;
  const reading = readingText(marker, lens);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-[7] flex items-center gap-1.5 rounded-full border border-border-strong bg-[color-mix(in_oklab,var(--panel-solid)_90%,transparent)] py-0.5 pl-2 pr-2.5 text-[11px] font-medium text-ink shadow-float"
      style={{
        left: flip ? undefined : `calc(${left}% + 17px)`,
        right: flip ? `calc(${100 - left}% + 17px)` : undefined,
        top: `${top}%`,
        // Natpis nikad ne izlazi iz okvira mape (ime se skraćuje).
        maxWidth: `min(260px, calc(${flip ? left : 100 - left}% - 19px))`,
        transform: 'translateY(-50%)',
      }}
    >
      <span className="truncate">{marker.view.station.name}</span>
      {reading ? <span className="tnum shrink-0 font-mono text-[11px] text-muted">{reading}</span> : null}
    </span>
  );
}

/** „Izmereno 16–17 h · pre 2 h“ – satni interval i starost, kao čip mreže (`liveStatus`). */
function measuredText(observedAt: Date): string {
  const { label, ageText } = liveStatus(observedAt, new Date());
  return `Izmereno ${label} · ${ageText}`;
}

function staleText(observedAt: Date): string {
  const { label, ageText } = liveStatus(observedAt, new Date());
  return `Poslednji podaci ${label} · ${ageText}`;
}

function MarkerTooltip({ marker, lens }: { marker: MapMarker; lens: Lens }) {
  const { view, reading } = marker;
  const okrug = okrugOf(view);
  const place = [view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ');
  return (
    <>
      <p className="font-semibold text-ink">{view.station.name}</p>
      {place ? <p className="text-muted">{place}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {marker.kind === 'none' && view.snapshot && !view.stale ? (
          <span className="inline-flex h-5 items-center rounded-full border border-border px-1.5 text-[11px] text-muted">Ne meri {lensLabel(lens)}</span>
        ) : (
          <CategoryChip category={view.stale ? null : reading.category} stale={view.stale} size="sm" />
        )}
        {reading.parameter && reading.value !== null ? (
          <span className={cn('text-muted', view.stale && 'text-faint')}>
            {PARAMETER_LABELS[reading.parameter]}{' '}
            <span className="tnum font-semibold text-ink">{formatConcentration(reading.value)}</span> {UNIT}
          </span>
        ) : null}
      </div>
      {view.observedAt ? (
        <p className="tnum mt-1 text-faint">
          {view.stale ? staleText(view.observedAt) : measuredText(view.observedAt)}
        </p>
      ) : null}
      {view.position?.approximate ? <p className="mt-1 text-faint">Približna lokacija (centar okruga)</p> : null}
      {isInactive(view) ? <p className="mt-1 text-faint">Neaktivna stanica (SEPA ju je ugasila)</p> : null}
      {marker.dimmed ? <p className="mt-1 text-faint">Van izabranog okruga</p> : null}
    </>
  );
}
