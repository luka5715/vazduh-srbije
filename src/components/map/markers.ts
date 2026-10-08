/**
 * Model markera mape: stanica kroz sočivo → vrsta oznake, kategorija, prigušenje po okrugu
 * i položaj u procentima okvira. Čiste funkcije (testirane u `markers.test.ts`).
 */

import { PARAMETER_LABELS, UNIT, type CategoryRank } from '@shared/aqi';

import { categoryOf } from '@/lib/category';
import { formatConcentration, formatInt } from '@/lib/format';
import { lensOf, okrugOf, type Lens, type LensReading } from '@/lib/insights';
import type { Projection } from '@/lib/geo';
import { isInactive, type StationView } from '@/lib/stations';

/**
 * - `exact`: puna tačka u boji kategorije (prave koordinate);
 * - `approx`: šupalj prsten u boji kategorije (centar okruga – stanica nema koordinate);
 * - `stale`: isprekidan sivi prsten (stanica ne javlja duže od 6 h ili je neaktivna);
 * - `none`: mala siva tačka (nema snimka ili stanica ne meri polutant sočiva).
 */
export type MarkerKind = 'exact' | 'approx' | 'stale' | 'none';

export interface MapMarker {
  id: string;
  view: StationView;
  /** Položaj centra u viewBox jedinicama projekcije (posle razmicanja preklopljenih). */
  x: number;
  y: number;
  /** Pomak od pravog (projektovanog) položaja posle razmicanja, u viewBox jedinicama (0 = na mestu). */
  shift: number;
  /** Isti položaj u procentima osnovnog okvira (samo zemlja). */
  xPct: number;
  yPct: number;
  reading: LensReading;
  /** Kategorija kroz sočivo; null za zastarele stanice i bez vrednosti. */
  rank: CategoryRank | null;
  kind: MarkerKind;
  /** Stanica je van izabranog okruga (prigušena, i dalje se može izabrati). */
  dimmed: boolean;
  /** Kategorija „Zagađen“ ili lošija → pulsirajući oreol. */
  alert: boolean;
  /** Opis za čitače ekrana (ime, kategorija, vrednost, napomene). */
  label: string;
}

export interface MarkerOptions {
  lens: Lens;
  /** Izabrani okrug (stanice van njega su prigušene) ili null. */
  okrug?: string | null;
  /**
   * Najmanji razmak centara tačaka u viewBox jedinicama (vidi `markerSpacing`); bez njega
   * važi `MIN_MARKER_DISTANCE` (okvir još nije izmeren).
   */
  minDistance?: number;
}

/** Rang od kog marker pulsira (3 = Zagađen). */
export const ALERT_RANK = 3;

/**
 * Rezervni najmanji razmak centara tačaka (viewBox jedinice ≈ 0,58 km) dok okvir mape nije
 * izmeren – pravi razmak se izvodi iz piksela (`markerSpacing`), jer tačka ima stalnu veličinu
 * u pikselima, a ne u kilometrima.
 */
export const MIN_MARKER_DISTANCE = 30;

/** Prečnik tačke u pikselima (isto kao `--mk-size` u mapa.css) na punoj i kompaktnoj mapi. */
export const MARKER_DOT_PX = { full: 12, compact: 9 } as const;
/** Najmanji vidljiv razmak između dve tačke (px). */
export const MARKER_GAP_PX = 2;

/**
 * Najmanji razmak centara tačaka u viewBox jedinicama za okvir širine `vbWidth` jedinica
 * prikazan na `widthPx` piksela: tačke prečnika `dotPx` se ne preklapaju (između njih ostaje
 * `MARKER_GAP_PX`). Veća mapa → manji razmak u jedinicama → tačke se manje pomeraju sa pravog
 * mesta. Bez mere (0) vraća `MIN_MARKER_DISTANCE`.
 */
export function markerSpacing(vbWidth: number, widthPx: number, dotPx: number = MARKER_DOT_PX.full): number {
  if (!(widthPx > 0) || !(vbWidth > 0)) return MIN_MARKER_DISTANCE;
  return ((dotPx + MARKER_GAP_PX) * vbWidth) / widthPx;
}

/**
 * Natpis legende o razmicanju: najveći pomak tačke od pravog mesta, zaokružen NAGORE na ceo
 * kilometar („do 3 km“), jer je to gornja granica. Null kad nijedna tačka nije pomerena.
 */
export function spacingNote(maxShiftKm: number): string | null {
  if (!(maxShiftKm >= 0.05)) return null;
  return `Preklopljene stanice su razmaknute (do ${formatInt(Math.ceil(maxShiftKm))} km).`;
}

const RELAX_ITERATIONS = 60;
/** Koraci opruge ka pravom položaju (svaki prati kratko razrešavanje preklapanja). */
const SPRING_ROUNDS = 120;
const SPRING_PULL = 0.15;

function markerKind(view: StationView, reading: LensReading): MarkerKind {
  if (view.stale) return 'stale';
  if (!reading.category) return 'none';
  return view.position?.approximate ? 'approx' : 'exact';
}

function markerLabel(view: StationView, reading: LensReading, kind: MarkerKind, dimmed: boolean): string {
  const parts = [view.station.name];
  if (kind === 'stale') parts.push(isInactive(view) ? 'neaktivna stanica (SEPA ju je ugasila)' : 'bez svežih podataka');
  else if (reading.category) {
    parts.push(reading.category.label);
    if (reading.parameter && reading.value !== null) parts.push(`${PARAMETER_LABELS[reading.parameter]} ${formatConcentration(reading.value)} ${UNIT}`);
  } else parts.push(view.snapshot ? 'polutant se ne meri' : 'nema podataka');
  if (view.position?.approximate) parts.push('približna lokacija');
  if (dimmed) parts.push('van izabranog okruga');
  return parts.join(', ');
}

interface Placed {
  view: StationView;
  x: number;
  y: number;
  /** Pravi (projektovani) položaj. */
  ox: number;
  oy: number;
}

/** Jedan prolaz odbijanja parova bližih od `minDistance` (simetričan, duž spojnice). */
function repel(points: Placed[], minDistance: number, iterations: number): void {
  for (let iteration = 0; iteration < iterations; iteration++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minDistance - 0.01) continue;
        const push = (minDistance - distance) / 2;
        const ux = distance > 1e-6 ? dx / distance : 0;
        const uy = distance > 1e-6 ? dy / distance : 1;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Razmicanje preklopljenih tačaka: parovi bliži od `minDistance` se odbijaju duž spojnice
 * (međusobni raspored ostaje – istok ostaje istok), a zatim se svaka tačka u koracima vraća
 * ka pravom položaju („opruga“) uz ponovno razrešavanje preklapanja – tako gust skup ostaje
 * zbijen oko pravih mesta umesto da se raširi u lanac (najveći pomak je ≈ 25 % manji nego sa
 * samim odbijanjem). Iste tačke (npr. više stanica u centru istog okruga) prvo se rasporede
 * u krug po imenu. Deterministički; O(n² · koraci) – nekoliko milisekundi za stotinak stanica.
 */
function separate(points: Placed[], minDistance: number): void {
  const byName = [...points].sort((a, b) => a.view.station.name.localeCompare(b.view.station.name, 'sr-Latn'));
  for (let i = 0; i < byName.length; i++) {
    const same = byName.filter((other, j) => j < i && Math.hypot(other.x - byName[i].x, other.y - byName[i].y) < 0.01).length;
    if (same === 0) continue;
    // Mali deterministički pomak (zlatni ugao) – dalje ih razmiče odbijanje.
    const angle = -Math.PI / 2 + same * 2.39996;
    byName[i].x += Math.cos(angle) * 0.5;
    byName[i].y += Math.sin(angle) * 0.5;
  }
  // Učestvuju samo tačke sa susedom bliže od 3 razmaka (gust skup se raširi najviše ≈ 1,5 razmaka
  // oko pravih mesta); usamljene stanice ostaju na mestu i ne troše korake.
  const reach = 3 * minDistance;
  const crowded = byName.filter((a) => byName.some((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < reach));
  if (crowded.length < 2) return;
  repel(crowded, minDistance, RELAX_ITERATIONS);
  for (let round = 0; round < SPRING_ROUNDS; round++) {
    for (const point of crowded) {
      point.x += (point.ox - point.x) * SPRING_PULL;
      point.y += (point.oy - point.y) * SPRING_PULL;
    }
    repel(crowded, minDistance, 4);
  }
  repel(crowded, minDistance, RELAX_ITERATIONS);
}

/**
 * Markeri za stanice sa poznatim položajem, redom od severa ka jugu (redosled fokusa).
 * Preklopljene tačke se razmiču (`separate`).
 */
export function buildMarkers(views: StationView[], projection: Projection, { lens, okrug = null, minDistance = MIN_MARKER_DISTANCE }: MarkerOptions): MapMarker[] {
  const placed: Placed[] = views
    .filter((view) => view.position !== null)
    .map((view) => {
      const [x, y] = projection.project(view.position!.lon, view.position!.lat);
      return { view, x, y, ox: x, oy: y };
    });

  separate(placed, minDistance);

  return placed
    .map(({ view, x, y, ox, oy }) => {
      const reading = lensOf(view, lens);
      const kind = markerKind(view, reading);
      const rank = kind === 'stale' || !reading.category ? null : reading.category.rank;
      const dimmed = okrug ? okrugOf(view) !== okrug : false;
      return {
        id: view.id,
        view,
        x,
        y,
        shift: Math.hypot(x - ox, y - oy),
        xPct: (x / projection.width) * 100,
        yPct: (y / projection.height) * 100,
        reading,
        rank,
        kind,
        dimmed,
        alert: rank !== null && rank >= ALERT_RANK,
        label: markerLabel(view, reading, kind, dimmed),
      };
    })
    .sort((a, b) => a.yPct - b.yPct || a.xPct - b.xPct);
}

export interface MarkerSummary {
  /** Broj markera po kategoriji 0–5 (samo neprigušeni). */
  byRank: number[];
  approx: number;
  stale: number;
  none: number;
  alert: number;
  dimmed: number;
  /** Najveći pomak tačke od pravog mesta (viewBox jedinice) – i prigušenih, jer su i one na mapi. */
  maxShift: number;
}

/** Brojevi za legendu mape (prigušene stanice se broje samo u `dimmed`). */
export function summarizeMarkers(markers: MapMarker[]): MarkerSummary {
  const summary: MarkerSummary = { byRank: [0, 0, 0, 0, 0, 0], approx: 0, stale: 0, none: 0, alert: 0, dimmed: 0, maxShift: 0 };
  for (const marker of markers) {
    summary.maxShift = Math.max(summary.maxShift, marker.shift);
    if (marker.dimmed) {
      summary.dimmed++;
      continue;
    }
    if (marker.rank !== null) summary.byRank[marker.rank]++;
    if (marker.kind === 'approx') summary.approx++;
    if (marker.kind === 'stale') summary.stale++;
    if (marker.kind === 'none') summary.none++;
    if (marker.alert) summary.alert++;
  }
  return summary;
}

/** `var(--cat-N)` ili neutralna boja za markere bez kategorije. */
export function markerColor(marker: Pick<MapMarker, 'rank'>): string {
  return marker.rank === null ? 'var(--faint)' : `var(--cat-${marker.rank})`;
}

/** Naziv kategorije markera za kratke natpise. */
export function markerCategoryLabel(marker: Pick<MapMarker, 'rank' | 'kind' | 'view'>): string {
  if (marker.kind === 'stale') return isInactive(marker.view) ? 'Neaktivna' : 'Bez svežih podataka';
  if (marker.rank === null) return marker.view.snapshot ? 'Ne meri se' : 'Nema podataka';
  return categoryOf(marker.rank).label;
}

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Prostorna navigacija strelicama: najbliži marker u datom smeru. Prvo se traži u kupi od
 * ±63° oko pravca (rastojanje + 2 × bočno odstupanje), pa u celoj poluravni; null kad u tom
 * smeru nema stanica.
 */
export function neighborInDirection(markers: ReadonlyArray<Pick<MapMarker, 'id' | 'x' | 'y'>>, fromId: string, direction: NavDirection): string | null {
  const from = markers.find((marker) => marker.id === fromId);
  if (!from) return markers[0]?.id ?? null;
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  for (const cone of [true, false]) {
    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const marker of markers) {
      if (marker.id === from.id) continue;
      const primary = sign * (horizontal ? marker.x - from.x : marker.y - from.y);
      const side = Math.abs(horizontal ? marker.y - from.y : marker.x - from.x);
      if (primary <= 0.5 || (cone && side > primary * 2)) continue;
      const score = primary + side * 2;
      if (score < bestScore) {
        bestScore = score;
        best = marker.id;
      }
    }
    if (best) return best;
  }
  return null;
}
