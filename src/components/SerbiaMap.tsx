import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { PARAMETER_LABELS, UNIT } from '@shared/aqi';

import { ChartTooltip, TooltipRow } from '@/components/charts/ChartTooltip';
import { districtBounds, mapFrame, mapGeometry, unitsToKm } from '@/components/map/geometry';
import {
  buildMarks,
  CLUSTER_DISC_PX,
  clusterNote,
  LABEL_GAP_PX,
  LABEL_MAX_PX,
  labelPlacement,
  MARKER_DOT_PX,
  markerColor,
  markerSpacing,
  markInFrame,
  neighborInDirection,
  spacingNote,
  summarizeMarkers,
  type LabelFrame,
  type LabelSize,
  type MapCluster,
  type MapMark,
  type MapMarker,
  type MarkerKind,
  type MarkerSummary,
  type NavDirection,
} from '@/components/map/markers';
import { CategoryChip, CategoryDot } from '@/components/ui/Category';
import { useMeasure } from '@/hooks/useMeasure';
import { CATEGORIES, catVar, RANKS } from '@/lib/category';
import { cn } from '@/lib/cn';
import { formatConcentration, formatInt, formatNumber, pluralSr } from '@/lib/format';
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
  /**
   * Dodir/Enter na grupu stanica (gust okrug): pozivalac postavlja filter okruga (`?okrug=`), a
   * mapa se uveća na taj okrug. Bez ovoga grupa je i dalje fokusabilna (tooltip), ali ništa ne otvara.
   */
  onOkrug?: (okrug: string) => void;
  /** Sočivo polutanta: boja markera je kategorija tog polutanta (podrazumevano `'worst'`). */
  lens?: Lens;
  /** Izabrani okrug: mapa se uveća na njega, njegov obris se ističe, stanice van njega su prigušene. */
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

/** Prva oznaka za fokus: prva neprigušena (na uvećanom okrugu najsevernija u okviru može biti sused), inače prva. */
function firstMarkId(marks: ReadonlyArray<MapMark>): string | null {
  return (marks.find((mark) => !mark.dimmed) ?? marks[0])?.id ?? null;
}

/**
 * Poluprečnik kruga izmaglice (viewBox jedinice ≈ 0,58 km): ISTI za sve kategorije – veći krug
 * za lošiju kategoriju bi izgledao kao veće zagađeno područje, a merenje je samo u tački.
 * Na uvećanom okrugu se smanjuje srazmerno okviru, pa na ekranu ostaje iste veličine.
 */
export const HAZE_RADIUS = 46;
/** Izmaglica grupe stanica je 1,5× šira od izmaglice jedne stanice. */
export const CLUSTER_HAZE_SCALE = 1.5;
/** Najveće dugme oznake (grupa, 36 px): oznaka ostaje na mapi dok joj celo dugme staje u okvir. */
const MARK_BUTTON_PX = 36;

/** Natpis uz sloj izmaglice (legenda Mape). */
export const HAZE_CAPTION = 'Izmaglica je ilustracija oko stanica – nije merenje između stanica.';

/**
 * SVG mapa Srbije sa okruzima i stanicama („instrument“ stil): okruzi lebde nad panelom sa
 * blagim sjajem izmaglice, iza je mreža meridijana/paralela, a sloj izmaglice meša mutne
 * krugove u boji kategorije (screen u tamnoj, multiply u svetloj temi). Okvir prati veličinu
 * kontejnera (viši/širi okvir → mreža se nastavlja oko zemlje).
 *
 * Stanice su pravi `<button>` elementi preko mape (cilj 28 px, tooltip i na fokus). Na mapu
 * se ulazi jednim Tab-om; strelice vode do najbliže oznake u tom smeru, Home/End do prve
 * (severno) i poslednje (južno), Enter bira. Kategorija ≥ „Zagađen“ pulsira; izabrana ima talase.
 *
 * Preklopljene tačke se razmiču tek koliko tačka zauzima piksela (`markerSpacing`: prečnik
 * tačke + 2 px preračunat u jedinice okvira iz izmerene širine), pa veća mapa pomera manje;
 * legenda kaže najveći pomak u km („razmaknute (do N km)“), a tooltip pomerene stanice koliko.
 * Okrug čije bi se tačke morale pomeriti više od 5 km (bar tri stanice) je na celoj mapi JEDNA
 * grupa (`MapCluster`: disk sa brojem i prstenom udela kategorija); dodir/Enter je otvara kroz
 * `onOkrug`, a mapa se uveća na okrug (`districtBounds` → `mapFrame`), gde se tačke razmiču za
 * ≤ 1–2 km i grupe nema. Oznake van uvećanog okvira se ne crtaju; prigušene stanice susednih
 * okruga u okviru ostaju kao kontekst. Izabrana stanica u grupi: grupa nosi prsten akcenta, talase
 * i natpis sa imenom stanice (broj grupe ostaje pošten). Natpis izabrane stanice ide na stranu
 * (desno/levo/iznad/ispod) na kojoj prekriva najmanje drugih oznaka, a po potrebi se odmakne uz tanku
 * spojnicu (`labelPlacement`) – u gustom uvećanom okrugu natpis uz tačku bi inače sakrio susedne tačke.
 */
export function SerbiaMap({
  views,
  selectedId = null,
  onSelect,
  onOkrug,
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
  /** Grupa otvorena tastaturom nestaje sa mape – fokus posle uvećanja ide na prvu oznaku. */
  const refocus = useRef(false);

  // Izabrani okrug uvećava okvir na njegov pravougaonik (bez animacije – viewBox se ne pretapa).
  const focus = okrug ? districtBounds(geometry, okrug) : null;
  const zoomed = focus !== null;
  const frame = useMemo(() => mapFrame(geometry, size.width, size.height, focus), [geometry, size.width, size.height, focus]);
  const { vb } = frame;
  const leftPct = (x: number) => ((x - vb.x) / vb.w) * 100;
  const topPct = (y: number) => ((y - vb.y) / vb.h) * 100;
  const unitsPerPx = size.width > 0 ? vb.w / size.width : 0;

  // Razmak tačaka iz piksela: dok okvir nije izmeren važi rezervni razmak (jedan kadar).
  const minDistance = markerSpacing(vb.w, size.width, compact ? MARKER_DOT_PX.compact : MARKER_DOT_PX.full);
  const allMarks = useMemo(() => buildMarks(views, projection, { lens, okrug, minDistance, selectedId }), [views, projection, lens, okrug, minDistance, selectedId]);
  // Uvećan okrug seče ostatak zemlje: ostaju oznake čije celo dugme staje u okvir (fokus na
  // isečeno dugme bi pomerio sadržaj okvira).
  const marks = useMemo(
    () => (zoomed ? allMarks.filter((mark) => markInFrame(mark, vb, (MARK_BUTTON_PX / 2) * unitsPerPx)) : allMarks),
    [allMarks, zoomed, vb, unitsPerPx],
  );
  const summary = useMemo(() => summarizeMarkers(marks), [marks]);
  const shiftKm = (units: number) => unitsToKm(geometry, units);
  const withoutPosition = views.filter((view) => view.position === null).length;
  const hovered = marks.find((mark) => mark.id === hoverId) ?? null;
  const selected = marks.find((mark): mark is MapMarker => mark.type === 'station' && mark.id === selectedId) ?? null;
  // Izabrana stanica u grupi: grupa nosi prsten akcenta, talase i natpis sa imenom stanice.
  const selectedCluster = marks.find((mark): mark is MapCluster => mark.type === 'cluster' && mark.selected) ?? null;
  const selectedMember = selectedCluster?.members.find((member) => member.id === selectedId) ?? null;
  const legend = showLegend ?? !compact;
  const haze = (showHaze ?? true) && !compact;
  // Izmaglica iste veličine na ekranu i na uvećanom okrugu (poluprečnik u jedinicama prati okvir).
  const hazeRadius = HAZE_RADIUS * Math.min(1, vb.w / projection.width);
  const activeDistrict = okrug ? (districts.find((district) => district.name === okrug) ?? null) : null;
  const measured = size.width > 0;
  const stationCount = marks.reduce((count, mark) => count + (mark.type === 'cluster' ? mark.count : 1), 0);

  // Jedan tab-stop za sve oznake (roving tabindex): poslednja fokusirana, izabrana ili prva.
  const tabbableId = (cursorId && marks.some((mark) => mark.id === cursorId) ? cursorId : null) ?? selected?.id ?? selectedCluster?.id ?? firstMarkId(marks);

  const setButton = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(id, node);
    else buttons.current.delete(id);
  }, []);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    // Dugme grupe je nestalo dok je bilo fokusirano (fokus je pao na <body>): prva stanica okruga u okviru.
    const first = firstMarkId(marks);
    if (first && document.activeElement === document.body) {
      setCursorId(first);
      buttons.current.get(first)?.focus();
    }
  }, [marks]);

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
      focusMarker(neighborInDirection(marks, id, direction));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusMarker(event.key === 'Home' ? marks[0]?.id : marks[marks.length - 1]?.id);
    } else if (event.key === 'Escape') {
      setHoverId(null);
    }
  };
  const openCluster = (event: MouseEvent<HTMLButtonElement>, cluster: MapCluster) => {
    if (!onOkrug) return;
    // Enter/Space daju klik bez pokazivača (`detail` 0): posle uvećanja fokus prelazi na prvu stanicu.
    if (event.detail === 0) refocus.current = true;
    onOkrug(cluster.okrug);
  };

  /** Zajednički atributi dugmeta oznake (stanica ili grupa): položaj, fokus, tooltip, tastatura. */
  const markProps = (mark: MapMark, zIndex: number) => ({
    ref: (node: HTMLButtonElement | null) => setButton(mark.id, node),
    type: 'button' as const,
    tabIndex: mark.id === tabbableId ? 0 : -1,
    'aria-label': mark.label,
    onPointerEnter: () => setHoverId(mark.id),
    onPointerLeave: () => clearHover(mark.id),
    onFocus: () => {
      setCursorId(mark.id);
      setHoverId(mark.id);
    },
    onBlur: () => clearHover(mark.id),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onMarkerKey(event, mark.id),
    style: { left: `${leftPct(mark.x)}%`, top: `${topPct(mark.y)}%`, zIndex, '--mk': markerColor(mark) } as CSSProperties,
  });

  const groupCount = summary.clusters.length;
  const label = `Mapa Srbije sa ${stationCount} ${pluralSr(stationCount, 'stanicom', 'stanice', 'stanica')}${
    groupCount ? `, od toga ${summary.clustered} u ${groupCount} ${pluralSr(groupCount, 'grupi', 'grupe', 'grupa')}` : ''
  }; boja tačke je kategorija kroz sočivo ${lensLabel(lens)}${okrug ? `, uvećan i istaknut ${okrugLabel(okrug)}` : ''}. Stanice su dugmad preko mape.`;
  const vbAttr = `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`;

  return (
    <div data-testid="serbia-map" className={cn('smap @container flex w-full min-w-0 flex-col', compact && 'smap--compact', className)}>
      <div className={cn('flex flex-auto flex-col gap-4', legend && '@min-[600px]:flex-row @min-[600px]:items-start @min-[600px]:gap-6')}>
        {/* Okvir mape i (opciono) sadržaj ispod njega; u redu sa legendom ova kolona se rasteže. */}
        <div className="flex min-w-0 shrink-0 grow basis-auto flex-col gap-4 @min-[600px]:self-stretch">
          <div
            ref={areaRef}
            className={cn('smap__area relative min-w-0 shrink-0 grow basis-auto', zoomed && 'overflow-hidden')}
            data-zoomed={zoomed || undefined}
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
                  {marks.map((mark) =>
                    mark.rank === null || mark.dimmed ? null : (
                      <circle
                        key={mark.id}
                        cx={mark.x}
                        cy={mark.y}
                        r={mark.type === 'cluster' ? hazeRadius * CLUSTER_HAZE_SCALE : hazeRadius}
                        fill={`url(#${uid}-h${mark.rank})`}
                      />
                    ),
                  )}
                </g>
              </svg>
            ) : null}

            {/* Natpisi mreže i razmernika: `tick-label` (11 px na telefonu, 10 px od sm) – ne ispod donje granice tipografije. */}
            {!compact && measured ? (
              <div aria-hidden className="tick-label pointer-events-none absolute inset-0 leading-none text-faint">
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
                  <span className="tnum">{frame.scaleBarKm} km</span>
                  <span className="block h-1.5 border-x border-b border-muted/70" />
                </span>
              </div>
            ) : null}

            <div role="group" aria-label={`Stanice na mapi (${stationCount})`} aria-describedby={hintId} className="pointer-events-none absolute inset-0">
              <p id={hintId} className="sr-only">
                Strelice vode do najbliže oznake u tom smeru, Home i End do prve i poslednje, Enter bira stanicu; grupu stanica (broj u krugu) Enter otvara kao
                uvećan okrug.
              </p>
              {marks.map((mark) => {
                if (mark.type === 'cluster') {
                  return (
                    <button
                      key={mark.id}
                      {...markProps(mark, mark.selected ? 6 : mark.dimmed ? 1 : 5)}
                      className="mk mk--cluster"
                      data-dim={mark.dimmed && !mark.selected ? true : undefined}
                      data-selected={mark.selected || undefined}
                      onClick={(event) => openCluster(event, mark)}
                    >
                      {mark.alert ? <span aria-hidden className="mk__halo" /> : null}
                      {mark.selected && !compact ? (
                        <>
                          <span aria-hidden className="mk__ripple" />
                          <span aria-hidden className="mk__ripple mk__ripple--late" />
                        </>
                      ) : null}
                      <ClusterDisc cluster={mark} compact={compact} />
                    </button>
                  );
                }
                const isSelected = mark.id === selectedId;
                return (
                  <button
                    key={mark.id}
                    {...markProps(mark, isSelected ? 6 : mark.dimmed ? 1 : mark.rank === null ? 2 : 3 + Number(mark.alert))}
                    className="mk"
                    data-kind={mark.kind}
                    data-dim={mark.dimmed && !isSelected ? true : undefined}
                    data-selected={isSelected || undefined}
                    aria-pressed={onSelect ? isSelected : undefined}
                    onClick={onSelect ? () => onSelect(mark.id) : undefined}
                  >
                    <span aria-hidden className="mk__glow" />
                    {mark.alert ? <span aria-hidden className="mk__halo" /> : null}
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

            {/* Ime izabrane stanice uz tačku ili uz grupu koja je sadrži, na strani koja prekriva najmanje drugih oznaka
                (ne hvata pokazivač – markeri ispod ostaju dostupni). */}
            {selected && !compact && measured ? (
              <SelectedLabel marker={selected} anchor={selected} marks={marks} frame={{ vb, width: size.width, height: size.height }} lens={lens} gapPx={LABEL_GAP_PX.station} />
            ) : null}
            {selectedCluster && selectedMember && !compact && measured ? (
              <SelectedLabel
                marker={selectedMember}
                anchor={selectedCluster}
                marks={marks}
                frame={{ vb, width: size.width, height: size.height }}
                lens={lens}
                gapPx={LABEL_GAP_PX.cluster}
              />
            ) : null}

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
                      {hovered.type === 'cluster' ? <ClusterTooltip cluster={hovered} /> : <MarkerTooltip marker={hovered} lens={lens} shiftKm={shiftKm(hovered.shift)} />}
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
            total={marks.length}
            withoutPosition={withoutPosition}
            hiddenInactive={hiddenInactive}
            haze={haze}
            maxShiftKm={shiftKm(summary.maxShift)}
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
  maxShiftKm,
}: {
  summary: MarkerSummary;
  lens: Lens;
  okrug: string | null;
  /** Broj oznaka na mapi (stanice + grupe). */
  total: number;
  withoutPosition: number;
  hiddenInactive: number;
  haze: boolean;
  /** Najveći pomak tačke od pravog mesta zbog razmicanja (km); 0 kad ništa nije pomereno. */
  maxShiftKm: number;
}) {
  const spacing = spacingNote(maxShiftKm);
  const groups = clusterNote(summary.clusters);
  const ranked = summary.byRank.reduce((sum, count) => sum + count, 0);
  // Stanice u opsegu: sve oznake, grupe kao broj članova, bez prigušenih.
  const inScope = total - summary.clusters.length + summary.clustered - summary.dimmed;
  return (
    <div className="smap__legend flex min-w-0 flex-col gap-3.5 @min-[600px]:w-[236px] @min-[600px]:shrink-0 @min-[600px]:pt-1">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Kategorija · {lensLabel(lens)}</p>
          <p className="tnum shrink-0 font-mono text-[12px] text-muted sm:text-[11px]">
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
                <span className={cn('tnum ml-auto font-mono text-[12px] sm:text-[11px] @min-[420px]:ml-0 @min-[600px]:ml-auto', count === 0 ? 'text-faint' : 'text-muted')}>{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted @min-[600px]:flex-col" aria-label="Vrste oznaka na mapi">
        {summary.clusters.length ? (
          <li className="inline-flex items-center gap-1.5" data-testid="cluster-key">
            <ClusterKey />
            grupa stanica – dodir otvara okrug
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="approx" color="var(--muted)" />
          približna lokacija (centar okruga)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="stale" />
          bez svežih podataka
          <span className="tnum font-mono text-[12px] text-faint sm:text-[11px]">{summary.stale}</span>
        </li>
        {summary.none > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <MarkerKey kind="none" />
            {lens === 'worst' ? 'nema podataka' : `ne meri ${lensLabel(lens)}`}
            <span className="tnum font-mono text-[12px] text-faint sm:text-[11px]">{summary.none}</span>
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <MarkerKey kind="exact" color={catVar(3)} halo />
          pulsira: Zagađen i lošije
          <span className="tnum font-mono text-[12px] text-faint sm:text-[11px]">{summary.alert}</span>
        </li>
        {okrug ? (
          <li className="inline-flex items-center gap-1.5">
            <MarkerKey kind="exact" color="var(--muted)" dim />
            van okruga (prigušeno)
            <span className="tnum font-mono text-[12px] text-faint sm:text-[11px]">{summary.dimmed}</span>
          </li>
        ) : null}
        {haze ? (
          <li className="inline-flex w-full items-start gap-1.5" data-testid="haze-caption">
            <span aria-hidden className="smap__haze-key mt-px" />
            <span>{HAZE_CAPTION}</span>
          </li>
        ) : null}
      </ul>

      <p className="text-xs leading-5 text-muted" data-testid="map-notes">
        Okruzi na Kosovu i Metohiji su prikazani bledo – državna mreža SEPA tamo nema stanica.
        {groups ? ` ${groups}` : ''}
        {spacing ? ` ${spacing}` : ''}
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

/** Oznaka grupe stanica za legendu: mali disk sa prstenom u bojama kategorija. */
function ClusterKey() {
  return (
    <span aria-hidden data-mark className="mk-key" data-kind="cluster">
      <span className="mk__disc" />
    </span>
  );
}

/**
 * Disk grupe stanica: broj stanica (tabelarne cifre, ≥ 11 px) i tanak prsten udela kategorija u
 * SEPA bojama (isti jezik kao segmentirani prsten heroja; članovi bez kategorije su sivi deo),
 * ispuna u boji najčešće kategorije (`--mk`) sa malim alfa. Prečnik `CLUSTER_DISC_PX`.
 */
function ClusterDisc({ cluster, compact }: { cluster: MapCluster; compact: boolean }) {
  const size = compact ? CLUSTER_DISC_PX.compact : CLUSTER_DISC_PX.full;
  const stroke = compact ? 2 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    ...RANKS.filter((rank) => cluster.byRank[rank] > 0).map((rank) => ({ key: String(rank), value: cluster.byRank[rank], color: catVar(rank) })),
    ...(cluster.unranked ? [{ key: 'bez', value: cluster.unranked, color: 'var(--faint)' }] : []),
  ];
  const gap = segments.length > 1 ? 1.5 : 0;
  let cursor = 0;
  return (
    <span aria-hidden data-mark className="mk__disc" style={{ '--ck-size': `${size}px` } as CSSProperties}>
      <svg className="mk__ring" viewBox={`0 0 ${size} ${size}`}>
        {segments.map((segment) => {
          const share = segment.value / cluster.count;
          const start = cursor;
          cursor += share * circumference;
          return (
            <circle
              key={segment.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={segment.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0.5, share * circumference - gap)} ${circumference}`}
              strokeDashoffset={-start}
            />
          );
        })}
      </svg>
      <span className="mk__count tnum">{formatInt(cluster.count)}</span>
    </span>
  );
}

function readingText(marker: MapMarker, lens: Lens): string | null {
  if (marker.kind === 'stale') return 'zastarelo';
  const { parameter, value } = marker.reading;
  if (!parameter || value === null) return marker.view.snapshot ? `ne meri ${lensLabel(lens)}` : null;
  return `${PARAMETER_LABELS[parameter]} ${formatConcentration(value)}`;
}

/**
 * Natpis izabrane stanice: ime + vrednost kroz sočivo, uz tačku ili uz grupu koja je sadrži (`anchor`,
 * `gapPx` od njenog centra). Strana i poravnanje se biraju tako da natpis prekrije što manje drugih
 * oznaka (`labelPlacement`); kad uz samu oznaku svaki položaj skriva tačke (gust uvećan okrug), natpis se
 * odmakne (≤ 48 px) i tanka spojnica ga veže za oznaku. Za ocenu se prvo izmeri prirodna širina natpisa –
 * do tada je nevidljiv (merenje je u layout efektu, pa se nijedan kadar ne vidi na pogrešnom mestu). Ime
 * se skraćuje tek kad ni najbolji položaj ne staje u okvir. Ne hvata pokazivač.
 */
function SelectedLabel({
  marker,
  anchor,
  marks,
  frame,
  lens,
  gapPx,
}: {
  marker: MapMarker;
  anchor: Pick<MapMark, 'id' | 'x' | 'y'>;
  marks: ReadonlyArray<MapMark>;
  frame: LabelFrame;
  lens: Lens;
  gapPx: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [natural, setNatural] = useState<LabelSize | null>(null);
  const name = marker.view.station.name;
  const reading = readingText(marker, lens);

  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      const pill = ref.current;
      const text = nameRef.current;
      if (!live || !pill || !text) return;
      const box = pill.getBoundingClientRect();
      // Skraćeno ime (text-overflow) ne menja scrollWidth: prirodna širina = okvir + odsečeni deo imena.
      const width = box.width + Math.max(0, text.scrollWidth - text.getBoundingClientRect().width);
      setNatural((previous) => (previous && Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - box.height) < 0.5 ? previous : { width, height: box.height }));
    };
    measure();
    // Veb-font koji stigne posle prvog crtanja menja širinu teksta.
    document.fonts?.ready.then(measure, () => {});
    return () => {
      live = false;
    };
  }, [name, reading]);

  const placement = natural ? labelPlacement(marks, anchor, frame, natural, gapPx) : null;
  const leader = placement?.leader ?? null;
  const dx = leader ? leader.to.x - leader.from.x : 0;
  const dy = leader ? leader.to.y - leader.from.y : 0;
  return (
    <>
      {leader ? (
        <span
          aria-hidden
          data-testid="selected-leader"
          className="smap__leader"
          style={{ left: `${leader.from.x}px`, top: `${leader.from.y}px`, width: `${Math.hypot(dx, dy)}px`, transform: `rotate(${Math.atan2(dy, dx)}rad)` }}
        />
      ) : null}
      <span
        ref={ref}
        aria-hidden
        data-testid="selected-label"
        data-side={placement?.side}
        data-align={placement?.align}
        data-distance={placement?.distance}
        className="pointer-events-none absolute z-[7] flex items-center gap-1.5 rounded-full border border-border-strong bg-[color-mix(in_oklab,var(--panel-solid)_90%,transparent)] py-0.5 pl-2 pr-2.5 text-[12px] font-medium text-ink shadow-float sm:text-[11px]"
        style={{
          left: placement ? `${placement.left}px` : undefined,
          top: placement ? `${placement.top}px` : undefined,
          maxWidth: `${placement ? placement.maxWidth : LABEL_MAX_PX}px`,
          visibility: placement ? undefined : 'hidden',
        }}
      >
        <span ref={nameRef} className="truncate">
          {name}
        </span>
        {reading ? <span className="tnum shrink-0 font-mono text-[12px] text-muted sm:text-[11px]">{reading}</span> : null}
      </span>
    </>
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

/** Napomena u tooltip-u tek kad je pomak primetan na mapi (≥ 0,5 km). */
const SHIFT_NOTE_KM = 0.5;

function MarkerTooltip({ marker, lens, shiftKm }: { marker: MapMarker; lens: Lens; shiftKm: number }) {
  const { view, reading } = marker;
  const okrug = okrugOf(view);
  const place = [view.station.municipality, okrug ? okrugLabel(okrug) : null].filter(Boolean).join(' · ');
  return (
    <>
      <p className="font-semibold text-ink">{view.station.name}</p>
      {place ? <p className="text-muted">{place}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {marker.kind === 'none' && view.snapshot && !view.stale ? (
          <span className="inline-flex h-5 items-center rounded-full border border-border px-1.5 text-[12px] text-muted sm:text-[11px]">Ne meri {lensLabel(lens)}</span>
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
      {shiftKm >= SHIFT_NOTE_KM ? (
        <p className="mt-1 text-faint">Tačka je pomerena ≈ {formatNumber(shiftKm, shiftKm < 10 ? 1 : 0)} km da se ne preklapa sa susednom</p>
      ) : null}
    </>
  );
}

/** Tooltip grupe: okrug, broj stanica, raspodela po kategoriji i šta dodir radi. */
function ClusterTooltip({ cluster }: { cluster: MapCluster }) {
  return (
    <>
      <p className="font-semibold text-ink">{okrugLabel(cluster.okrug)}</p>
      <p className="text-muted">
        {formatInt(cluster.count)} {pluralSr(cluster.count, 'stanica', 'stanice', 'stanica')}
        {cluster.dimmed ? ' · van izabranog okruga' : ''}
      </p>
      <div className="mt-1.5">
        {RANKS.filter((rank) => cluster.byRank[rank] > 0).map((rank) => (
          <TooltipRow key={rank} swatch={<CategoryDot rank={rank} size={8} />} label={CATEGORIES[rank].label} value={formatInt(cluster.byRank[rank])} />
        ))}
        {cluster.unranked ? <TooltipRow swatch={<CategoryDot rank={null} size={8} />} label="bez kategorije" value={formatInt(cluster.unranked)} muted /> : null}
      </div>
      <p className="mt-1 text-faint">Dodir otvara okrug uvećan na mapi</p>
    </>
  );
}
