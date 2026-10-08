/**
 * Model oznaka mape: stanica kroz sočivo → vrsta oznake, kategorija, prigušenje po okrugu
 * i položaj u procentima okvira; gust okrug → jedna grupa stanica. Čiste funkcije (testirane
 * u `markers.test.ts`).
 *
 * Dva nivoa:
 *  - `buildMarkers` – svaka stanica je jedna tačka; preklopljene se razmiču (`separate`);
 *  - `buildMarks` – isto, a zatim se stanice okruga čije bi tačke morale da se pomere više od
 *    `CLUSTER_SHIFT_KM` (bar `CLUSTER_MIN` njih) zamene JEDNOM grupom u težištu pravih položaja
 *    (`MapCluster`), pa se preostale tačke razmaknu ponovo, sa grupama kao (teže pokretnim)
 *    preprekama. Prag je u kilometrima, a razmak tačaka u pikselima (`markerSpacing`), pa grupe
 *    nastaju na celoj mapi Srbije i nestaju kad se okrug uveća (razmak u km je tada mali).
 */

import { CATEGORIES, PARAMETER_LABELS, UNIT, type CategoryRank } from '@shared/aqi';

import { categoryOf, RANKS } from '@/lib/category';
import { formatConcentration, formatInt, pluralSr } from '@/lib/format';
import { lensOf, okrugLabel, okrugOf, type Lens, type LensReading } from '@/lib/insights';
import type { Projection } from '@/lib/geo';
import { isInactive, type StationView } from '@/lib/stations';

import { KM_PER_DEGREE, type ViewBox } from './geometry';

/**
 * - `exact`: puna tačka u boji kategorije (prave koordinate);
 * - `approx`: šupalj prsten u boji kategorije (centar okruga – stanica nema koordinate);
 * - `stale`: isprekidan sivi prsten (stanica ne javlja duže od 6 h ili je neaktivna);
 * - `none`: mala siva tačka (nema snimka ili stanica ne meri polutant sočiva).
 */
export type MarkerKind = 'exact' | 'approx' | 'stale' | 'none';

export interface MapMarker {
  type: 'station';
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

/** Grupa stanica jednog okruga (gust okrug na celoj mapi); dodir otvara okrug. */
export interface MapCluster {
  type: 'cluster';
  /** `cluster:<okrug>` – jedinstveno među oznakama. */
  id: string;
  okrug: string;
  count: number;
  /** Broj članova po kategoriji 0–5 (bez zastarelih i bez vrednosti). */
  byRank: number[];
  /** Članovi bez kategorije (zastareli ili bez vrednosti za sočivo). */
  unranked: number;
  /** Najčešća kategorija članova (pri jednakom broju lošija); null kad nijedan nema kategoriju. */
  rank: CategoryRank | null;
  /** Bar jedan član je „Zagađen“ ili lošiji. */
  alert: boolean;
  dimmed: boolean;
  /** Grupa sadrži izabranu stanicu (nosi prsten akcenta i natpis umesto nje). */
  selected: boolean;
  members: MapMarker[];
  /** Težište pravih položaja članova, posle razmicanja od ostalih tačaka. */
  x: number;
  y: number;
  shift: number;
  xPct: number;
  yPct: number;
  label: string;
}

export type MapMark = MapMarker | MapCluster;

export interface MarkerOptions {
  lens: Lens;
  /** Izabrani okrug (stanice van njega su prigušene; njegove stanice se nikad ne grupišu) ili null. */
  okrug?: string | null;
  /**
   * Najmanji razmak centara tačaka u viewBox jedinicama (vidi `markerSpacing`); bez njega
   * važi `MIN_MARKER_DISTANCE` (okvir još nije izmeren).
   */
  minDistance?: number;
  /** Izabrana stanica: grupa koja je sadrži to nosi (`MapCluster.selected`), broj grupe ostaje pošten. */
  selectedId?: string | null;
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
/** Prečnik diska grupe stanica u pikselima (isto kao `--ck-size` u mapa.css). */
export const CLUSTER_DISC_PX = { full: 28, compact: 20 } as const;
/** Najmanji vidljiv razmak između dve tačke (px). */
export const MARKER_GAP_PX = 2;
/** Najmanji broj stanica okruga koje mogu da čine grupu. */
export const CLUSTER_MIN = 3;
/** Grupa nastaje tek kad bi se neka tačka okruga morala pomeriti više od ovoliko km. */
export const CLUSTER_SHIFT_KM = 5;
/** Disk grupe prema tački (28/12 ≈ 20/9): poluprečnik grupe pri razmicanju. */
const CLUSTER_DOT_RATIO = CLUSTER_DISC_PX.full / MARKER_DOT_PX.full;
/** Grupa se pri odbijanju pomera 4× manje od tačke (teža prepreka). */
const CLUSTER_WEIGHT = 4;

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

/** Okrug i broj stanica jedne grupe (za legendu). */
export interface ClusterNote {
  okrug: string;
  count: number;
}

/** Natpis legende o grupama: „Gust okrug (Grad Beograd · 33) je prikazan kao grupa stanica; dodir otvara okrug.“ */
export function clusterNote(clusters: readonly ClusterNote[]): string | null {
  if (!clusters.length) return null;
  const list = clusters.map((cluster) => `${okrugLabel(cluster.okrug)} · ${formatInt(cluster.count)}`).join(', ');
  return clusters.length === 1
    ? `Gust okrug (${list}) je prikazan kao grupa stanica; dodir otvara okrug.`
    : `Gusti okruzi (${list}) su prikazani kao grupe stanica; dodir otvara okrug.`;
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

/** Tačka u razmicanju: stanica ili grupa. */
interface Placed {
  /** Ime za determinističan redosled (stanica ili okrug grupe). */
  name: string;
  x: number;
  y: number;
  /** Pravi (projektovani) položaj. */
  ox: number;
  oy: number;
  /** Poluprečnik za razmicanje (dve tačke se odbijaju dok je razmak centara manji od zbira). */
  radius: number;
  /** Udeo pomaka pri odbijanju: teža tačka (grupa) se pomera manje. */
  weight: number;
}

interface PlacedStation extends Placed {
  view: StationView;
}

interface PlacedCluster extends Placed {
  okrug: string;
  members: PlacedStation[];
}

/** Jedan prolaz odbijanja parova bližih od zbira poluprečnika (duž spojnice, srazmerno težini). */
function repel(points: Placed[], iterations: number): void {
  for (let iteration = 0; iteration < iterations; iteration++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const need = a.radius + b.radius;
        if (distance >= need - 0.01) continue;
        const push = need - distance;
        const ux = distance > 1e-6 ? dx / distance : 0;
        const uy = distance > 1e-6 ? dy / distance : 1;
        const shareA = b.weight / (a.weight + b.weight);
        a.x -= ux * push * shareA;
        a.y -= uy * push * shareA;
        b.x += ux * push * (1 - shareA);
        b.y += uy * push * (1 - shareA);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Razmicanje preklopljenih tačaka: parovi bliži od zbira poluprečnika se odbijaju duž spojnice
 * (međusobni raspored ostaje – istok ostaje istok), a zatim se svaka tačka u koracima vraća
 * ka pravom položaju („opruga“) uz ponovno razrešavanje preklapanja – tako gust skup ostaje
 * zbijen oko pravih mesta umesto da se raširi u lanac (najveći pomak je ≈ 25 % manji nego sa
 * samim odbijanjem). Iste tačke (npr. više stanica u centru istog okruga) prvo se rasporede
 * u krug po imenu. Deterministički; O(n² · koraci) – nekoliko milisekundi za stotinak stanica.
 */
function separate(points: Placed[]): void {
  const byName = [...points].sort((a, b) => a.name.localeCompare(b.name, 'sr-Latn'));
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
  const crowded = byName.filter((a) => byName.some((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < 3 * (a.radius + b.radius)));
  if (crowded.length < 2) return;
  repel(crowded, RELAX_ITERATIONS);
  for (let round = 0; round < SPRING_ROUNDS; round++) {
    for (const point of crowded) {
      point.x += (point.ox - point.x) * SPRING_PULL;
      point.y += (point.oy - point.y) * SPRING_PULL;
    }
    repel(crowded, 4);
  }
  repel(crowded, RELAX_ITERATIONS);
}

/** Stanice sa poznatim položajem, projektovane; poluprečnik je pola razmaka tačaka. */
function place(views: StationView[], projection: Projection, minDistance: number): PlacedStation[] {
  return views
    .filter((view) => view.position !== null)
    .map((view) => {
      const [x, y] = projection.project(view.position!.lon, view.position!.lat);
      return { name: view.station.name, view, x, y, ox: x, oy: y, radius: minDistance / 2, weight: 1 };
    });
}

function toMarker({ view, x, y, ox, oy }: PlacedStation, projection: Projection, lens: Lens, okrug: string | null): MapMarker {
  const reading = lensOf(view, lens);
  const kind = markerKind(view, reading);
  const rank = kind === 'stale' || !reading.category ? null : reading.category.rank;
  const dimmed = okrug ? okrugOf(view) !== okrug : false;
  return {
    type: 'station',
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
}

/** Redosled fokusa: od severa ka jugu, pa od zapada ka istoku. */
function byNorth(a: { yPct: number; xPct: number }, b: { yPct: number; xPct: number }): number {
  return a.yPct - b.yPct || a.xPct - b.xPct;
}

/** Km po viewBox jedinici iz projekcije (razmera je ista po obe ose). */
function kmPerUnit(projection: Projection): number {
  const [, y0] = projection.project(20, 44);
  const [, y1] = projection.project(20, 43);
  return KM_PER_DEGREE / (y1 - y0);
}

/**
 * Markeri za stanice sa poznatim položajem, redom od severa ka jugu (redosled fokusa).
 * Preklopljene tačke se razmiču (`separate`); bez grupisanja (vidi `buildMarks`).
 */
export function buildMarkers(views: StationView[], projection: Projection, { lens, okrug = null, minDistance = MIN_MARKER_DISTANCE }: MarkerOptions): MapMarker[] {
  const placed = place(views, projection, minDistance);
  separate(placed);
  return placed.map((point) => toMarker(point, projection, lens, okrug)).sort(byNorth);
}

function clusterLabel(okrug: string, count: number, byRank: number[], unranked: number, notes: string[]): string {
  const parts = RANKS.filter((rank) => byRank[rank] > 0).map((rank) => `${CATEGORIES[rank].label} ${formatInt(byRank[rank])}`);
  if (unranked > 0) parts.push(`bez kategorije ${formatInt(unranked)}`);
  const head = [`${okrugLabel(okrug)} · ${formatInt(count)} ${pluralSr(count, 'stanica', 'stanice', 'stanica')}`, parts.join(', '), ...notes];
  return `${head.join(' · ')} — dodir otvara okrug`;
}

function toCluster({ okrug, members, x, y, ox, oy }: PlacedCluster, projection: Projection, lens: Lens, selectedOkrug: string | null, selectedId: string | null): MapCluster {
  // Članovi nose pravi položaj (nisu pojedinačno na mapi, pa ni pomereni).
  const marks = members.map((member) => toMarker({ ...member, x: member.ox, y: member.oy }, projection, lens, selectedOkrug));
  const byRank = [0, 0, 0, 0, 0, 0];
  let unranked = 0;
  for (const mark of marks) {
    if (mark.rank === null) unranked++;
    else byRank[mark.rank]++;
  }
  let rank: CategoryRank | null = null;
  for (const candidate of RANKS) if (byRank[candidate] > 0 && (rank === null || byRank[candidate] >= byRank[rank])) rank = candidate;
  const dimmed = selectedOkrug ? okrug !== selectedOkrug : false;
  const selected = selectedId !== null && marks.some((mark) => mark.id === selectedId);
  const notes = [dimmed ? 'van izabranog okruga' : null, selected ? 'sadrži izabranu stanicu' : null].filter((note): note is string => note !== null);
  return {
    type: 'cluster',
    id: `cluster:${okrug}`,
    okrug,
    count: marks.length,
    byRank,
    unranked,
    rank,
    alert: marks.some((mark) => mark.alert),
    dimmed,
    selected,
    members: marks,
    x,
    y,
    shift: Math.hypot(x - ox, y - oy),
    xPct: (x / projection.width) * 100,
    yPct: (y / projection.height) * 100,
    label: clusterLabel(okrug, marks.length, byRank, unranked, notes),
  };
}

/**
 * Oznake mape sa grupama: stanice se razmaknu kao u `buildMarkers`, pa se po okrugu proveri da
 * li bi grupa od bar `CLUSTER_MIN` stanica morala da se pomeri više od `CLUSTER_SHIFT_KM` –
 * takva se zameni jednom grupom u težištu pravih položaja, a preostale tačke se razmaknu ponovo
 * (grupe su prepreke koje se pomeraju 4× manje). Izabrani okrug (uvećan) se nikad ne grupiše, ni
 * stanice bez poznatog okruga; izabrana stanica ostaje u grupi, a grupa nosi izbor (`selected`).
 * Redosled: od severa ka jugu.
 */
export function buildMarks(views: StationView[], projection: Projection, { lens, okrug = null, minDistance = MIN_MARKER_DISTANCE, selectedId = null }: MarkerOptions): MapMark[] {
  const placed = place(views, projection, minDistance);
  separate(placed);

  const groups = new Map<string, PlacedStation[]>();
  for (const point of placed) {
    const name = okrugOf(point.view);
    if (!name || name === okrug) continue;
    const group = groups.get(name);
    if (group) group.push(point);
    else groups.set(name, [point]);
  }
  const km = kmPerUnit(projection);
  const clusters: PlacedCluster[] = [];
  const grouped = new Set<PlacedStation>();
  for (const [name, members] of groups) {
    if (members.length < CLUSTER_MIN) continue;
    const maxShift = Math.max(...members.map((member) => Math.hypot(member.x - member.ox, member.y - member.oy)));
    if (maxShift * km <= CLUSTER_SHIFT_KM) continue;
    const x = members.reduce((sum, member) => sum + member.ox, 0) / members.length;
    const y = members.reduce((sum, member) => sum + member.oy, 0) / members.length;
    clusters.push({ name, okrug: name, members, x, y, ox: x, oy: y, radius: (minDistance / 2) * CLUSTER_DOT_RATIO, weight: CLUSTER_WEIGHT });
    for (const member of members) grouped.add(member);
  }

  const singles = placed.filter((point) => !grouped.has(point));
  if (clusters.length) {
    // Bez grupisanih tačaka raspored je drugačiji: od pravih položaja, sa grupama kao preprekama.
    for (const point of singles) {
      point.x = point.ox;
      point.y = point.oy;
    }
    separate([...singles, ...clusters]);
  }
  const marks: MapMark[] = [
    ...singles.map((point) => toMarker(point, projection, lens, okrug)),
    ...clusters.map((cluster) => toCluster(cluster, projection, lens, okrug, selectedId)),
  ];
  return marks.sort(byNorth);
}

/** Da li je centar oznake unutar okvira, umanjenog za `inset` jedinica sa svake strane. */
export function markInFrame(mark: Pick<MapMark, 'x' | 'y'>, vb: ViewBox, inset = 0): boolean {
  return mark.x >= vb.x + inset && mark.x <= vb.x + vb.w - inset && mark.y >= vb.y + inset && mark.y <= vb.y + vb.h - inset;
}

export interface MarkerSummary {
  /** Broj stanica po kategoriji 0–5 (samo neprigušene; i grupisane). */
  byRank: number[];
  approx: number;
  stale: number;
  none: number;
  alert: number;
  dimmed: number;
  /** Najveći pomak tačke od pravog mesta (viewBox jedinice) – i prigušenih, jer su i one na mapi. */
  maxShift: number;
  /** Grupe stanica na mapi (okrug i broj), redom kao oznake. */
  clusters: ClusterNote[];
  /** Broj stanica prikazanih u grupama. */
  clustered: number;
}

/** Brojevi za legendu mape (prigušene stanice se broje samo u `dimmed`; članovi grupa kao stanice). */
export function summarizeMarkers(marks: ReadonlyArray<MapMark>): MarkerSummary {
  const summary: MarkerSummary = { byRank: [0, 0, 0, 0, 0, 0], approx: 0, stale: 0, none: 0, alert: 0, dimmed: 0, maxShift: 0, clusters: [], clustered: 0 };
  const count = (marker: MapMarker) => {
    if (marker.dimmed) {
      summary.dimmed++;
      return;
    }
    if (marker.rank !== null) summary.byRank[marker.rank]++;
    if (marker.kind === 'approx') summary.approx++;
    if (marker.kind === 'stale') summary.stale++;
    if (marker.kind === 'none') summary.none++;
    if (marker.alert) summary.alert++;
  };
  for (const mark of marks) {
    summary.maxShift = Math.max(summary.maxShift, mark.shift);
    if (mark.type === 'cluster') {
      summary.clusters.push({ okrug: mark.okrug, count: mark.count });
      summary.clustered += mark.count;
      mark.members.forEach(count);
    } else count(mark);
  }
  return summary;
}

/** `var(--cat-N)` ili neutralna boja za oznake bez kategorije. */
export function markerColor(mark: Pick<MapMark, 'rank'>): string {
  return mark.rank === null ? 'var(--faint)' : `var(--cat-${mark.rank})`;
}

/** Naziv kategorije markera za kratke natpise. */
export function markerCategoryLabel(marker: Pick<MapMarker, 'rank' | 'kind' | 'view'>): string {
  if (marker.kind === 'stale') return isInactive(marker.view) ? 'Neaktivna' : 'Bez svežih podataka';
  if (marker.rank === null) return marker.view.snapshot ? 'Ne meri se' : 'Nema podataka';
  return categoryOf(marker.rank).label;
}

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Prostorna navigacija strelicama: najbliža oznaka (stanica ili grupa) u datom smeru. Prvo se
 * traži u kupi od ±63° oko pravca (rastojanje + 2 × bočno odstupanje), pa u celoj poluravni;
 * null kad u tom smeru nema oznaka.
 */
export function neighborInDirection(markers: ReadonlyArray<Pick<MapMark, 'id' | 'x' | 'y'>>, fromId: string, direction: NavDirection): string | null {
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

/** Strana natpisa izabrane stanice prema njenoj oznaci (tački ili grupi koja je sadrži). */
export type LabelSide = 'right' | 'left' | 'above' | 'below';
/** Poravnanje natpisa duž ivice oznake: centriran, počinje uz oznaku (`start`) ili se završava uz nju (`end`). */
export type LabelAlign = 'center' | 'start' | 'end';

/** Veličina natpisa u px (prirodna, bez skraćivanja imena). */
export interface LabelSize {
  width: number;
  height: number;
}

/** Okvir mape za natpis: viewBox i izmerena veličina okvira u px. */
export interface LabelFrame {
  vb: ViewBox;
  width: number;
  height: number;
}

/** Tačka u px od gornjeg levog ugla okvira. */
export interface PointPx {
  x: number;
  y: number;
}

export interface LabelPlacement {
  side: LabelSide;
  align: LabelAlign;
  /** Odmak natpisa od oznake preko osnovnog razmaka (px, iz `LABEL_STEPS_PX`); > 0 → spojnica. */
  distance: number;
  /** Gornji levi ugao natpisa, px od gornjeg levog ugla okvira. */
  left: number;
  top: number;
  /** Najveća širina natpisa (px): `LABEL_MAX_PX` kad ceo staje u okvir, inače prostor do ivice (ime se skraćuje). */
  maxWidth: number;
  /** Ceo natpis (širine najviše `LABEL_MAX_PX`) staje u okvir sa `LABEL_MARGIN_PX` od ivice. */
  fits: boolean;
  /** Druge oznake čiji je centar pod natpisom (skrivene) i one koje natpis samo dodiruje. */
  hidden: number;
  touched: number;
  /** Spojnica od centra oznake do ivice natpisa, samo kad je natpis odmaknut (`distance` > 0). */
  leader: { from: PointPx; to: PointPx } | null;
}

/** Razmak natpisa od ivice okvira (px). */
export const LABEL_MARGIN_PX = 2;
/** Najveća širina natpisa (px); duže ime se skraćuje. */
export const LABEL_MAX_PX = 260;
/**
 * Razmak natpisa od centra oznake (px): izabrana tačka 16 px + prsten akcenta 4 px → poluprečnik 12,
 * disk grupe 28 px → 14; plus 5 px vazduha.
 */
export const LABEL_GAP_PX = { station: 17, cluster: CLUSTER_DISC_PX.full / 2 + 5 } as const;
/**
 * Odmaci natpisa od oznake (px) kad uz samu oznaku svaki položaj skriva druge tačke (gust uvećan
 * okrug): natpis se odmiče najmanje koliko mora, a spojnica ga vezuje za oznaku.
 */
export const LABEL_STEPS_PX: readonly number[] = [0, 16, 32, 48];
/** Poravnan natpis (`start`/`end`) počinje odnosno završava se ovoliko px preko centra oznake. */
const LABEL_ALIGN_OVERLAP_PX = 10;
/** Najmanja širina skraćenog natpisa (px), da natpis uz samu ivicu ne nestane. */
const LABEL_MIN_PX = 48;
/** Spojnica se vezuje bar ovoliko px od ugla natpisa. */
const LEADER_INSET_PX = 6;

/** Vidljivi poluprečnik oznake u px (tačka ili disk + beli prsten od 2 px) – prepreka za natpis. */
export function markRadiusPx(mark: Pick<MapMark, 'type'>, compact = false): number {
  const size = mark.type === 'cluster' ? CLUSTER_DISC_PX : MARKER_DOT_PX;
  return (compact ? size.compact : size.full) / 2 + 2;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Položaji natpisa izabrane stanice oko oznake `selected`: strana (desno, levo, iznad, ispod) ×
 * poravnanje (centriran, počinje uz oznaku, završava se uz nju) × odmak (`LABEL_STEPS_PX`), ocenjeni po
 * tome koliko DRUGIH oznaka prekrivaju – najbolji je prvi. Redosled ocene: natpis koji ceo staje u
 * okvir pre onog koji bi izašao (ime bi se skraćivalo); manje skrivenih oznaka (centar pod natpisom);
 * manji odmak (natpis uz oznaku, bez spojnice); manje dodirnutih (krug oznake seče natpis); pri
 * jednakoj oceni dosadašnje pravilo – strana sa više mesta (desno u levoj polovini okvira, inače levo),
 * pa iznad, pa ispod, centriran pre poravnatog. Iznad/ispod se natpis pomera vodoravno koliko treba da
 * ostane u okviru (oznaka ostaje pod njim), desno/levo uspravno. Na uvećanom gustom okrugu tačke stoje
 * na 14 px, pa natpis uz oznaku skoro uvek pređe preko nekih – zato se bira ocenom, a po potrebi odmiče
 * (33 beogradske stanice: na svakom okviru postoji položaj koji ne skriva nijednu tačku, odmak ≤ 32 px).
 * Prepreke su i diskovi grupa (na celoj mapi natpis grupe ne sme preko susedne grupe). Čista funkcija u px.
 */
export function labelCandidates(
  marks: ReadonlyArray<Pick<MapMark, 'id' | 'type' | 'x' | 'y'>>,
  selected: Pick<MapMark, 'id' | 'x' | 'y'>,
  frame: LabelFrame,
  label: LabelSize,
  gapPx: number,
  compact = false,
): LabelPlacement[] {
  const toPx = (mark: Pick<MapMark, 'x' | 'y'>): PointPx => ({
    x: ((mark.x - frame.vb.x) / frame.vb.w) * frame.width,
    y: ((mark.y - frame.vb.y) / frame.vb.h) * frame.height,
  });
  const anchor = toPx(selected);
  const obstacles = marks.filter((mark) => mark.id !== selected.id).map((mark) => ({ ...toPx(mark), radius: markRadiusPx(mark, compact) }));
  const margin = LABEL_MARGIN_PX;
  const w = Math.min(label.width, LABEL_MAX_PX);
  const h = label.height;
  const leftHalf = anchor.x <= frame.width / 2;
  const sides: readonly LabelSide[] = leftHalf ? ['right', 'left', 'above', 'below'] : ['left', 'right', 'above', 'below'];
  const aligns: readonly LabelAlign[] = leftHalf ? ['center', 'start', 'end'] : ['center', 'end', 'start'];
  /** Položaj natpisa duž ivice oznake (`size` = njegova dužina na toj osi, `at` = centar oznake). */
  const along = (align: LabelAlign, size: number, at: number) =>
    align === 'center' ? at - size / 2 : align === 'start' ? at - LABEL_ALIGN_OVERLAP_PX : at + LABEL_ALIGN_OVERLAP_PX - size;

  const ranked: Array<{ placement: LabelPlacement; rank: number }> = [];
  for (const distance of LABEL_STEPS_PX) {
    const gap = gapPx + distance;
    sides.forEach((side, sideIndex) => {
      aligns.forEach((align, alignIndex) => {
        const horizontal = side === 'right' || side === 'left';
        let left: number;
        let top: number;
        /** Prostor za natpis na toj strani (px) – širina kad se skraćuje. */
        let room: number;
        if (horizontal) {
          left = side === 'right' ? anchor.x + gap : anchor.x - gap - w;
          top = clamp(along(align, h, anchor.y), margin, frame.height - margin - h);
          room = side === 'right' ? frame.width - margin - left : anchor.x - gap - margin;
        } else {
          left = clamp(along(align, w, anchor.x), margin, frame.width - margin - w);
          top = side === 'above' ? anchor.y - gap - h : anchor.y + gap;
          room = frame.width - 2 * margin;
        }
        const fits = left >= margin && left + w <= frame.width - margin && top >= margin && top + h <= frame.height - margin;
        let hidden = 0;
        let touched = 0;
        for (const obstacle of obstacles) {
          if (obstacle.x > left && obstacle.x < left + w && obstacle.y > top && obstacle.y < top + h) {
            hidden++;
            continue;
          }
          const dx = Math.max(left - obstacle.x, 0, obstacle.x - (left + w));
          const dy = Math.max(top - obstacle.y, 0, obstacle.y - (top + h));
          if (dx * dx + dy * dy < obstacle.radius * obstacle.radius) touched++;
        }
        const leader =
          distance > 0
            ? {
                from: anchor,
                to: horizontal
                  ? { x: side === 'right' ? left : left + w, y: clamp(anchor.y, top + LEADER_INSET_PX, top + h - LEADER_INSET_PX) }
                  : { x: clamp(anchor.x, left + LEADER_INSET_PX, left + w - LEADER_INSET_PX), y: side === 'above' ? top + h : top },
              }
            : null;
        ranked.push({
          // Natpis koji ne staje se skraćuje do ivice okvira (levo/iznad/ispod počinje od ivice).
          placement: { side, align, distance, left: fits || side === 'right' ? left : Math.max(left, margin), top, maxWidth: fits ? LABEL_MAX_PX : Math.max(room, LABEL_MIN_PX), fits, hidden, touched, leader },
          rank: sideIndex * aligns.length + alignIndex,
        });
      });
    });
  }
  return ranked
    .sort(
      (a, b) =>
        Number(!a.placement.fits) - Number(!b.placement.fits) ||
        a.placement.hidden - b.placement.hidden ||
        a.placement.distance - b.placement.distance ||
        a.placement.touched - b.placement.touched ||
        a.rank - b.rank,
    )
    .map((entry) => entry.placement);
}

/** Najbolji položaj natpisa izabrane stanice (prvi iz `labelCandidates`). */
export function labelPlacement(
  marks: ReadonlyArray<Pick<MapMark, 'id' | 'type' | 'x' | 'y'>>,
  selected: Pick<MapMark, 'id' | 'x' | 'y'>,
  frame: LabelFrame,
  label: LabelSize,
  gapPx: number,
  compact = false,
): LabelPlacement {
  return labelCandidates(marks, selected, frame, label, gapPx, compact)[0];
}
