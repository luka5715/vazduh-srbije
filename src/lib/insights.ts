/**
 * Uvidi nad modelom prikaza stanica – čiste funkcije bez React-a i bez I/O.
 *
 * „Sočivo“ (`Lens`) bira kroz koji polutant gledamo mrežu: `'worst'` je ukupna
 * (najgora) SEPA kategorija stanice i njen dominantni polutant, a `Parameter` je
 * kategorija tog polutanta iz snimka (`values[param].c`).
 *
 * Zastarele stanice (`view.stale`) se, kao u `computeNetworkKpis`, ne računaju u
 * stanje mreže: ne ulaze u medijane, matrice, rang-liste ni u boju izmaglice.
 */

import {
  CATEGORIES,
  PARAMETER_LABELS,
  PARAMETERS,
  THRESHOLDS_1H,
  classify,
  categoryOf,
  worstCategory,
  type Category,
  type CategoryRank,
  type Parameter,
} from '@shared/aqi';

import { median } from '@/lib/scale';
import { isInactive, municipalityPosition, type StationView } from '@/lib/stations';

const HOUR_MS = 3_600_000;

/** Sočivo polutanta: `'worst'` = ukupna kategorija, inače jedan polutant. */
export type Lens = 'worst' | Parameter;

/** Sva sočiva redom kojim se nude u interfejsu. */
export const LENSES: readonly Lens[] = ['worst', ...PARAMETERS];

/** Natpis sočiva: „Najlošiji“ ili oznaka polutanta (PM10, NO₂ …). */
export function lensLabel(lens: Lens): string {
  return lens === 'worst' ? 'Najlošiji' : PARAMETER_LABELS[lens];
}

/** Da li je vrednost dozvoljeno sočivo (npr. pri čitanju iz URL-a). */
export function isLens(value: unknown): value is Lens {
  return value === 'worst' || (typeof value === 'string' && (PARAMETERS as readonly string[]).includes(value));
}

/**
 * Polutant za prikaze kojima treba JEDAN polutant (medijane po okruzima, pragovi): za
 * `'worst'` je to PM10 – dogovoreni polutant poređenja (čestice mere skoro sve stanice), a NE
 * tvrdnja da je PM10 najčešći dominantni polutant; to se računa iz podataka (`dominantDrivers`).
 */
export function resolveLensParameter(lens: Lens): Parameter {
  return lens === 'worst' ? 'PM10' : lens;
}

function isRank(value: unknown): value is CategoryRank {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Sveža stanica sa snimkom – jedina koja ulazi u stanje mreže. */
export function isFresh(view: StationView): boolean {
  return !view.stale && view.snapshot !== null;
}

// ---------------------------------------------------------------------------
// Jedna stanica kroz sočivo
// ---------------------------------------------------------------------------

export interface LensReading {
  /** Polutant čija se vrednost prikazuje (za `'worst'` dominantni) ili null. */
  parameter: Parameter | null;
  /** Poslednja satna vrednost, µg/m³ (i kod zastarele stanice – poslednja poznata). */
  value: number | null;
  /** SEPA kategorija; null kad nema vrednosti ili je stanica zastarela. */
  category: Category | null;
  /** Prenosi `view.stale` da prikaz može da posivi poslednju poznatu vrednost. */
  stale: boolean;
}

/**
 * Očitavanje stanice kroz sočivo. Za `'worst'` vraća dominantni polutant i ukupnu
 * kategoriju (`view.category`); za polutant vraća njegovu vrednost i kategoriju iz snimka.
 */
export function lensOf(view: StationView, lens: Lens): LensReading {
  if (lens === 'worst') {
    const parameter = view.dominant ?? (view.snapshot && isParameterKey(view.snapshot.dominant) ? view.snapshot.dominant : null);
    const entry = parameter ? view.values[parameter] : undefined;
    return {
      parameter,
      value: entry && isFiniteNumber(entry.v) ? entry.v : null,
      category: view.category,
      stale: view.stale,
    };
  }
  const entry = view.values[lens];
  if (!entry || !isFiniteNumber(entry.v)) return { parameter: lens, value: null, category: null, stale: view.stale };
  const rank = isRank(entry.c) ? entry.c : classify(lens, entry.v);
  return { parameter: lens, value: entry.v, category: view.stale ? null : categoryOf(rank), stale: view.stale };
}

function isParameterKey(value: string): value is Parameter {
  return (PARAMETERS as readonly string[]).includes(value);
}

/**
 * Odnos vrednosti i gornje granice njene kategorije (0–1 unutar kategorije, > 1 iznad
 * poslednjeg praga). Služi za poređenje stanica iste kategorije različitih polutanata.
 */
export function thresholdRatio(parameter: Parameter, value: number): number {
  const limits = THRESHOLDS_1H[parameter];
  const rank = classify(parameter, value);
  return value / (limits[Math.min(rank, 4)] || 1);
}

// ---------------------------------------------------------------------------
// Filteri po okrugu
// ---------------------------------------------------------------------------

/** Okrug stanice: iz pozicije (centar okruga) ili iz opštine; null kad je nepoznat. */
export function okrugOf(view: StationView): string | null {
  if (view.position?.okrug) return view.position.okrug;
  return municipalityPosition(view.station.municipality)?.okrug ?? null;
}

/**
 * Aktivne stanice kojima okrug nije poznat (ni iz pozicije ni iz opštine – naziv opštine nije u
 * `opstine-okrug.json`). Nisu ni u jednom okrugu, pa ih filter okruga i liste okruga ne prikazuju;
 * broj se navodi uz te prikaze kad je veći od nule.
 */
export function stationsWithoutOkrug(views: readonly StationView[]): number {
  let count = 0;
  for (const view of views) if (!isInactive(view) && okrugOf(view) === null) count++;
  return count;
}

/** Okruzi u kojima postoji bar jedna stanica, sortirani po srpskom abecednom redu. */
export function okrugList(views: StationView[]): string[] {
  const names = new Set<string>();
  for (const view of views) {
    const okrug = okrugOf(view);
    if (okrug) names.add(okrug);
  }
  return [...names].sort((a, b) => okrugLabel(a).localeCompare(okrugLabel(b), 'sr-Latn'));
}

/** Naziv okruga za prikaz: izvorni podaci ponekad izostavljaju reč „okrug“ („Sremski“). */
export function okrugLabel(okrug: string): string {
  return /okrug$/i.test(okrug) || /^grad\s/i.test(okrug) ? okrug : `${okrug} okrug`;
}

/** Opseg prikaza za natpise: naziv okruga („Nišavski okrug“) ili „cela mreža“. */
export function scopeLabel(okrug: string | null): string {
  return okrug ? okrugLabel(okrug) : 'cela mreža';
}

/** Stanice izabranog okruga; `null` = svi okruzi. */
export function filterByOkrug(views: StationView[], okrug: string | null): StationView[] {
  if (!okrug) return views;
  return views.filter((view) => okrugOf(view) === okrug);
}

// ---------------------------------------------------------------------------
// Satne serije (24 h)
// ---------------------------------------------------------------------------

function seriesStartMs(view: StationView): number | null {
  const ms = Date.parse(view.series.start);
  // Neispravan JSON daje početak 1970. – to nije stvarna serija.
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / HOUR_MS) * HOUR_MS : null;
}

/** Početak poslednjeg (najnovijeg) sata u serijama svežih stanica ili null. */
export function latestSeriesHour(views: StationView[]): number | null {
  let latest: number | null = null;
  for (const view of views) {
    if (!isFresh(view)) continue;
    const start = seriesStartMs(view);
    if (start === null) continue;
    const end = start + 23 * HOUR_MS;
    if (latest === null || end > latest) latest = end;
  }
  return latest;
}

/** 24 početka sati (najstariji prvi) koji se završavaju sa `lastHourMs`. */
export function hourSlots(lastHourMs: number): Date[] {
  return Array.from({ length: 24 }, (_, i) => new Date(lastHourMs - (23 - i) * HOUR_MS));
}

export interface NetworkHourSlot {
  /** Početak sata (UTC trenutak). */
  t: Date;
  /** Medijana satnih vrednosti stanica u tom satu ili null. */
  median: number | null;
  /** Broj stanica sa vrednošću u tom satu. */
  n: number;
}

/**
 * Medijana mreže po satu za poslednja 24 sata. Serije stanica se poravnavaju po
 * apsolutnom satu (početak serije + indeks), pa stanica koja kasni sat vremena
 * doprinosi pravim satima. Prazan niz kad nema nijedne sveže serije.
 */
export function networkHourly(views: StationView[], parameter: Parameter): NetworkHourSlot[] {
  const last = latestSeriesHour(views);
  if (last === null) return [];
  const first = last - 23 * HOUR_MS;
  const buckets: number[][] = Array.from({ length: 24 }, () => []);
  for (const view of views) {
    if (!isFresh(view)) continue;
    const start = seriesStartMs(view);
    const values = view.series.values[parameter];
    if (start === null || !Array.isArray(values)) continue;
    values.forEach((value, index) => {
      if (!isFiniteNumber(value)) return;
      const slot = Math.round((start + index * HOUR_MS - first) / HOUR_MS);
      if (slot >= 0 && slot < 24) buckets[slot].push(value);
    });
  }
  return buckets.map((bucket, i) => ({ t: new Date(first + i * HOUR_MS), median: median(bucket), n: bucket.length }));
}

export interface TrendDelta {
  /** Poslednja vrednost (najnoviji sat sa podatkom). */
  now: number;
  /** Vrednost pre ~24 h (najstariji sat sa podatkom u prozoru). */
  then: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

function directionOf(delta: number, reference: number): 'up' | 'down' | 'flat' {
  const tolerance = Math.max(1, Math.abs(reference) * 0.05);
  if (Math.abs(delta) < tolerance) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * Najmanji broj stanica da bi sat bio „pokriven“: bar 2 i bar polovina najboljeg sata
 * u prozoru (max n). Kad u celom prozoru javlja najviše jedna stanica (npr. okrug sa jednom
 * stanicom), prag je 1 – medijana jedne stanice je i tada njena vrednost.
 */
export function minSlotCoverage(slots: NetworkHourSlot[]): number {
  let maxN = 0;
  for (const slot of slots) if (slot.n > maxN) maxN = slot.n;
  return Math.min(Math.max(1, maxN), Math.max(2, Math.ceil(0.5 * maxN)));
}

/**
 * Uklanja medijanu (null) sa POČETNIH i ZAVRŠNIH sati sa premalo stanica (vidi
 * `minSlotCoverage`). SEPA stanice kasne različito: najnoviji sat često ima samo jednu ili
 * dve „brze“ stanice, pa bi njegova medijana opisivala njih, a ne mrežu. Unutrašnje rupe
 * ostaju kakve jesu; `n` se ne menja (tooltip ga i dalje prikazuje). Idempotentno.
 */
export function trimLowCoverage(slots: NetworkHourSlot[]): NetworkHourSlot[] {
  const min = minSlotCoverage(slots);
  const covered = (slot: NetworkHourSlot) => slot.median !== null && slot.n >= min;
  let first = 0;
  while (first < slots.length && !covered(slots[first])) first++;
  let last = slots.length - 1;
  while (last >= first && !covered(slots[last])) last--;
  return slots.map((slot, i) => (i < first || i > last ? (slot.median === null ? slot : { ...slot, median: null }) : slot));
}

/**
 * Promena medijane mreže: poslednji POKRIVENI sat prema prvom pokrivenom satu (≈ pre 24 h).
 * Sati sa premalo stanica na krajevima prozora se ne računaju (`trimLowCoverage`).
 */
export function networkDelta24h(slots: NetworkHourSlot[]): TrendDelta | null {
  const withValue = trimLowCoverage(slots).filter((slot): slot is NetworkHourSlot & { median: number } => slot.median !== null);
  if (withValue.length < 2) return null;
  const then = withValue[0].median;
  const now = withValue[withValue.length - 1].median;
  const delta = now - then;
  return { now, then, delta, direction: directionOf(delta, then) };
}

export interface HourCell {
  /** Početak sata. */
  t: Date;
  /** Vrednost polutanta sočiva (za `'worst'`: vrednost polutanta koji određuje kategoriju). */
  value: number | null;
  /** SEPA kategorija u tom satu ili null kad nema merenja. */
  category: Category | null;
  /** Polutant koji daje vrednost (za `'worst'` dominantni u tom satu). */
  parameter: Parameter | null;
}

export interface HourMatrixRow {
  id: string;
  view: StationView;
  /** Trenutno očitavanje kroz sočivo (za sortiranje i oznaku reda). */
  current: LensReading;
  /** Tačno 24 ćelije, poravnate sa `HourMatrix.hours`. */
  cells: HourCell[];
}

export interface HourMatrix {
  /** 24 početka sati (najstariji prvi), zajednička za sve redove. */
  hours: Date[];
  /** Sveže stanice, najlošije prve. */
  rows: HourMatrixRow[];
  /**
   * Sveže stanice izostavljene jer u 24 sata nemaju nijednu vrednost polutanta sočiva
   * (stanica ga ne meri). Za `'worst'` je uvek 0.
   */
  missing: number;
}

/**
 * Matrica stanica × 24 sata za toplotnu mapu „Ritam mreže“. Ćelija nosi kategoriju
 * polutanta sočiva; za `'worst'` je to najgora kategorija svih polutanata u tom satu.
 * Redovi: sveže stanice, sortirane po trenutnoj kategoriji, pa po odnosu prema pragu, pa po imenu.
 * Za jedan polutant stanice bez ijedne vrednosti u 24 sata (ne mere ga) se ne prikazuju
 * kao prazni redovi, već se broje u `missing`.
 */
export function stationHourMatrix(views: StationView[], lens: Lens): HourMatrix {
  const last = latestSeriesHour(views);
  if (last === null) return { hours: [], rows: [], missing: 0 };
  const hours = hourSlots(last);
  const first = hours[0].getTime();
  const rows: HourMatrixRow[] = [];
  let missing = 0;
  for (const view of views) {
    if (!isFresh(view)) continue;
    const start = seriesStartMs(view);
    if (start === null) continue;
    const cells: HourCell[] = hours.map((t) => ({ t, value: null, category: null, parameter: null }));
    const perHour: Array<Partial<Record<Parameter, number>>> = hours.map(() => ({}));
    const parameters = lens === 'worst' ? PARAMETERS : [lens];
    for (const parameter of parameters) {
      const values = view.series.values[parameter];
      if (!Array.isArray(values)) continue;
      values.forEach((value, index) => {
        if (!isFiniteNumber(value)) return;
        const slot = Math.round((start + index * HOUR_MS - first) / HOUR_MS);
        if (slot >= 0 && slot < 24) perHour[slot][parameter] = value;
      });
    }
    perHour.forEach((values, slot) => {
      if (lens === 'worst') {
        const worst = worstCategory(values);
        if (!worst) return;
        cells[slot] = { t: hours[slot], value: values[worst.dominant] ?? null, category: categoryOf(worst.rank), parameter: worst.dominant };
      } else {
        const value = values[lens];
        if (value === undefined) return;
        cells[slot] = { t: hours[slot], value, category: categoryOf(classify(lens, value)), parameter: lens };
      }
    });
    if (lens !== 'worst' && cells.every((cell) => cell.value === null)) {
      missing++;
      continue;
    }
    rows.push({ id: view.id, view, current: lensOf(view, lens), cells });
  }
  rows.sort(compareReadings);
  return { hours, rows, missing };
}

function compareReadings(a: { current: LensReading; view: StationView }, b: { current: LensReading; view: StationView }): number {
  const rankA = a.current.category?.rank ?? -1;
  const rankB = b.current.category?.rank ?? -1;
  if (rankA !== rankB) return rankB - rankA;
  const ratioA = a.current.parameter && a.current.value !== null ? thresholdRatio(a.current.parameter, a.current.value) : -1;
  const ratioB = b.current.parameter && b.current.value !== null ? thresholdRatio(b.current.parameter, b.current.value) : -1;
  if (ratioA !== ratioB) return ratioB - ratioA;
  return a.view.station.name.localeCompare(b.view.station.name, 'sr-Latn');
}

export interface RankedStation {
  view: StationView;
  reading: LensReading;
  /** Odnos vrednosti i praga njene kategorije (veće = lošije). */
  ratio: number;
}

/**
 * Sveže stanice sa vrednošću za sočivo, najlošije prve (kategorija, pa odnos prema pragu).
 * `limit` skraćuje listu (npr. 8 za „Najzagađenije stanice“).
 */
export function rankByLens(views: StationView[], lens: Lens, limit?: number): RankedStation[] {
  const ranked: RankedStation[] = [];
  for (const view of views) {
    if (!isFresh(view)) continue;
    const reading = lensOf(view, lens);
    if (reading.value === null || reading.parameter === null || reading.category === null) continue;
    ranked.push({ view, reading, ratio: thresholdRatio(reading.parameter, reading.value) });
  }
  ranked.sort((a, b) => compareReadings({ current: a.reading, view: a.view }, { current: b.reading, view: b.view }));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Poređenje sa 24-časovnim prosekom
// ---------------------------------------------------------------------------

/** Najmanje satnih vrednosti da bi 24-časovni prosek bio smislen. */
export const MIN_HOURS_FOR_AVERAGE = 6;

/** Prosek satnih vrednosti stanice u seriji poslednja 24 sata ili null. */
export function average24h(view: StationView, parameter: Parameter): number | null {
  const values = view.series.values[parameter];
  if (!Array.isArray(values)) return null;
  const finite = values.filter(isFiniteNumber);
  if (finite.length < MIN_HOURS_FOR_AVERAGE) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export interface StationDelta {
  current: number;
  avg24: number;
  /** current − avg24, µg/m³. */
  delta: number;
  /** current / avg24 (1 = jednako proseku); null kad je prosek 0. */
  ratio: number | null;
  direction: 'up' | 'down' | 'flat';
}

/** Trenutna vrednost polutanta prema sopstvenom proseku poslednja 24 sata. */
export function deltaVs24h(view: StationView, parameter: Parameter): StationDelta | null {
  const current = view.values[parameter]?.v;
  if (!isFiniteNumber(current)) return null;
  const avg24 = average24h(view, parameter);
  if (avg24 === null) return null;
  const delta = current - avg24;
  return { current, avg24, delta, ratio: avg24 === 0 ? null : current / avg24, direction: directionOf(delta, avg24) };
}

// ---------------------------------------------------------------------------
// Okruzi
// ---------------------------------------------------------------------------

export interface OkrugAggregate {
  okrug: string;
  /** Naziv za prikaz (sa „okrug“). */
  label: string;
  /** Polutant agregata (za `'worst'` → PM10, vidi `resolveLensParameter`). */
  parameter: Parameter;
  /** Sveže stanice sa vrednošću polutanta. */
  stations: number;
  /** Aktivne stanice okruga (i zastarele; neaktivne nisu uračunate). */
  total: number;
  /** Medijana trenutnih vrednosti. */
  nowMedian: number | null;
  /** Medijana 24-časovnih proseka stanica. */
  avg24Median: number | null;
  /** Najgora trenutna kategorija u okrugu (kroz sočivo) ili null. */
  worstCategory: Category | null;
}

/**
 * Agregati po okrugu za „dumbbell“ prikaz: medijana SADA prema medijani 24-časovnih
 * proseka stanica. Sortirano po `nowMedian` opadajuće (okruzi bez vrednosti na kraju).
 */
export function okrugAggregates(views: StationView[], lens: Lens): OkrugAggregate[] {
  const parameter = resolveLensParameter(lens);
  const groups = new Map<string, StationView[]>();
  for (const view of views) {
    const okrug = okrugOf(view);
    if (!okrug || isInactive(view)) continue;
    const list = groups.get(okrug) ?? [];
    list.push(view);
    groups.set(okrug, list);
  }
  const result: OkrugAggregate[] = [];
  for (const [okrug, members] of groups) {
    const now: number[] = [];
    const averages: number[] = [];
    let worst: Category | null = null;
    for (const view of members) {
      if (!isFresh(view)) continue;
      const value = view.values[parameter]?.v;
      if (isFiniteNumber(value)) now.push(value);
      const avg = average24h(view, parameter);
      if (avg !== null) averages.push(avg);
      const category = lensOf(view, lens).category;
      if (category && (!worst || category.rank > worst.rank)) worst = category;
    }
    result.push({
      okrug,
      label: okrugLabel(okrug),
      parameter,
      stations: now.length,
      total: members.length,
      nowMedian: median(now),
      avg24Median: median(averages),
      worstCategory: worst,
    });
  }
  return result.sort((a, b) => {
    if (a.nowMedian === null || b.nowMedian === null) {
      if (a.nowMedian === b.nowMedian) return a.label.localeCompare(b.label, 'sr-Latn');
      return a.nowMedian === null ? 1 : -1;
    }
    return b.nowMedian - a.nowMedian || a.label.localeCompare(b.label, 'sr-Latn');
  });
}

// ---------------------------------------------------------------------------
// Raspodela kroz sočivo i polutanti koji određuju kategoriju
// ---------------------------------------------------------------------------

export interface LensDistribution {
  /** Broj svežih stanica po kategoriji 0–5 polutanta sočiva (za `'worst'` ukupna kategorija). */
  counts: number[];
  /** Sveže stanice sa kategorijom kroz sočivo (zbir `counts`). */
  reporting: number;
  /** Sveže stanice bez vrednosti polutanta sočiva (ne mere ga ili nemaju svežu vrednost). */
  missing: number;
}

/** Koliko svežih stanica je u kojoj kategoriji kroz sočivo (npr. „Po SO₂: 22 dobar …“). */
export function lensDistribution(views: readonly StationView[], lens: Lens): LensDistribution {
  const counts = [0, 0, 0, 0, 0, 0];
  let missing = 0;
  for (const view of views) {
    if (!isFresh(view)) continue;
    const rank = lensOf(view, lens).category?.rank;
    if (rank === undefined) missing++;
    else counts[rank]++;
  }
  return { counts, reporting: counts.reduce((sum, count) => sum + count, 0), missing };
}

export interface DriverCount {
  parameter: Parameter;
  /** Broj stanica kojima ovaj polutant određuje kategoriju. */
  count: number;
}

export interface DominantDrivers {
  /** Sveže stanice u kategoriji `rank`. */
  stations: number;
  /** Dominantni polutanti tih stanica, najčešći prvi (pri jednakom broju redosled `PARAMETERS`). */
  drivers: DriverCount[];
}

/**
 * Koji polutanti određuju kategoriju `rank` (npr. kategoriju naslova heroja): `view.dominant`
 * svežih stanica čija je ukupna kategorija `rank`. Računa se iz podataka – nikad unapred zadato.
 */
export function dominantDrivers(views: readonly StationView[], rank: CategoryRank): DominantDrivers {
  const byParameter = new Map<Parameter, number>();
  let stations = 0;
  for (const view of views) {
    if (!isFresh(view) || view.category?.rank !== rank) continue;
    stations++;
    if (view.dominant) byParameter.set(view.dominant, (byParameter.get(view.dominant) ?? 0) + 1);
  }
  const drivers = PARAMETERS.filter((parameter) => byParameter.has(parameter))
    .map((parameter) => ({ parameter, count: byParameter.get(parameter) as number }))
    .sort((a, b) => b.count - a.count);
  return { stations, drivers };
}

// ---------------------------------------------------------------------------
// Izmaglica, pragovi, čestice
// ---------------------------------------------------------------------------

/**
 * Dominantna kategorija mreže za `--haze`: najčešća kategorija među svežim stanicama;
 * pri jednakom broju pobeđuje lošija. Null kad nema svežih stanica.
 */
export function dominantCategory(views: StationView[]): CategoryRank | null {
  const counts = [0, 0, 0, 0, 0, 0];
  let any = false;
  for (const view of views) {
    if (view.stale || !view.category) continue;
    counts[view.category.rank]++;
    any = true;
  }
  if (!any) return null;
  let best = 0;
  for (let rank = 1; rank < counts.length; rank++) {
    if (counts[rank] >= counts[best]) best = rank;
  }
  return best as CategoryRank;
}

export interface ThresholdBand {
  rank: CategoryRank;
  label: string;
  /** Donja granica (isključivo, osim za kategoriju 0 koja počinje od 0). */
  from: number;
  /** Gornja granica (uključivo); za kategoriju 5 je `displayMax`. */
  to: number;
}

export interface ParameterThresholds {
  parameter: Parameter;
  /** Gornje granice kategorija 0–4 (SEPA satni pragovi), µg/m³. */
  limits: readonly [number, number, number, number, number];
  bands: ThresholdBand[];
  /**
   * Predlog kraja skale za trake sa pragovima: granica „Zagađen“ (limits[3]).
   * Veće vrednosti se crtaju do kraja trake i označavaju kao prekoračenje.
   */
  displayMax: number;
}

/** SEPA satni pragovi polutanta (iz `@shared/aqi` THRESHOLDS_1H) u obliku za crtanje. */
export function thresholdsFor(parameter: Parameter): ParameterThresholds {
  const limits = THRESHOLDS_1H[parameter];
  const displayMax = limits[3];
  const bands: ThresholdBand[] = CATEGORIES.map((category, index) => ({
    rank: category.rank,
    label: category.label,
    from: index === 0 ? 0 : limits[index - 1],
    to: index < limits.length ? limits[index] : Math.max(displayMax, limits[4] * 1.2),
  }));
  return { parameter, limits, bands, displayMax };
}

/**
 * Gustina čestica Košave (0–1) iz medijane PM10 mreže, normalizovano na SEPA pragove
 * PM10 (15 / 45 / 120 / 195 / 270 µg/m³), deo po deo linearno. Rezultat je ograničen
 * na [0,12; 1] da pozadina nikad ne izgleda prazno; bez podatka vraća 0,2.
 */
export function pmIntensity(medianPm10: number | null | undefined): number {
  if (!isFiniteNumber(medianPm10)) return 0.2;
  const [l0, l1, l2, l3, l4] = THRESHOLDS_1H.PM10;
  const stops: Array<[number, number]> = [
    [0, 0.12],
    [l0, 0.25],
    [l1, 0.45],
    [l2, 0.68],
    [l3, 0.85],
    [l4, 1],
  ];
  const value = Math.max(0, medianPm10);
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (value <= x1) {
      const [x0, y0] = stops[i - 1];
      return y0 + ((value - x0) / (x1 - x0 || 1)) * (y1 - y0);
    }
  }
  return 1;
}

/** `var(--glow-N)` (boja sjaja kategorije N) za izmaglicu ili boja akcenta kad nema podataka. */
export function hazeColor(rank: CategoryRank | null): string {
  return rank === null ? 'var(--accent)' : `var(--glow-${rank})`;
}
