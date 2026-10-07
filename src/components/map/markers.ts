/**
 * Model markera mape: stanica kroz sočivo → vrsta oznake, kategorija, prigušenje po okrugu
 * i položaj u procentima okvira. Čiste funkcije (testirane u `markers.test.ts`).
 */

import { PARAMETER_LABELS, UNIT, type CategoryRank } from '@shared/aqi';

import { categoryOf } from '@/lib/category';
import { formatConcentration } from '@/lib/format';
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
}

/** Rang od kog marker pulsira (3 = Zagađen). */
export const ALERT_RANK = 3;

/**
 * Najmanji razmak centara tačaka (viewBox jedinice; 1 jedinica ≈ 0,55 px na telefonu i
 * ≈ 0,58 km): bliže stanice se razmiču da tačke od 12 px ne bi prekrivale jedna drugu.
 */
export const MIN_MARKER_DISTANCE = 30;
const RELAX_ITERATIONS = 60;

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

/**
 * Razmicanje preklopljenih tačaka (blago odbijanje parova bližih od `MIN_MARKER_DISTANCE`):
 * svaka tačka se pomera najmanje što može, a međusobni raspored ostaje (istok ostaje istok).
 * Iste tačke (npr. više stanica u centru istog okruga) prvo se raspoređuju u krug po imenu.
 * O(n² · iteracije) – zanemarljivo za mrežu od stotinak stanica.
 */
function separate(points: Array<{ view: StationView; x: number; y: number }>): void {
  const byName = [...points].sort((a, b) => a.view.station.name.localeCompare(b.view.station.name, 'sr-Latn'));
  for (let i = 0; i < byName.length; i++) {
    const same = byName.filter((other, j) => j < i && Math.hypot(other.x - byName[i].x, other.y - byName[i].y) < 0.01).length;
    if (same === 0) continue;
    // Mali deterministički pomak (zlatni ugao) – dalje ih razmiče odbijanje.
    const angle = -Math.PI / 2 + same * 2.39996;
    byName[i].x += Math.cos(angle) * 0.5;
    byName[i].y += Math.sin(angle) * 0.5;
  }
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    let moved = false;
    for (let i = 0; i < byName.length; i++) {
      for (let j = i + 1; j < byName.length; j++) {
        const a = byName[i];
        const b = byName[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= MIN_MARKER_DISTANCE - 0.01) continue;
        const push = (MIN_MARKER_DISTANCE - distance) / 2;
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
 * Markeri za stanice sa poznatim položajem, redom od severa ka jugu (redosled fokusa).
 * Preklopljene tačke se razmiču (`separate`).
 */
export function buildMarkers(views: StationView[], projection: Projection, { lens, okrug = null }: MarkerOptions): MapMarker[] {
  const placed = views
    .filter((view) => view.position !== null)
    .map((view) => {
      const [x, y] = projection.project(view.position!.lon, view.position!.lat);
      return { view, x, y };
    });

  separate(placed);

  return placed
    .map(({ view, x, y }) => {
      const reading = lensOf(view, lens);
      const kind = markerKind(view, reading);
      const rank = kind === 'stale' || !reading.category ? null : reading.category.rank;
      const dimmed = okrug ? okrugOf(view) !== okrug : false;
      return {
        id: view.id,
        view,
        x,
        y,
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
}

/** Brojevi za legendu mape (prigušene stanice se broje samo u `dimmed`). */
export function summarizeMarkers(markers: MapMarker[]): MarkerSummary {
  const summary: MarkerSummary = { byRank: [0, 0, 0, 0, 0, 0], approx: 0, stale: 0, none: 0, alert: 0, dimmed: 0 };
  for (const marker of markers) {
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
