/**
 * Čiste pomoćne funkcije stranice Stanice: redovi kroz sočivo polutanta, grupe za raspodelu
 * i filter, pretraga bez obzira na dijakritike, sortiranje i položaj vrednosti na SEPA
 * skali. Bez React-a – testirano u `stationRows.test.ts`.
 */

import { CATEGORIES, PARAMETERS, type CategoryRank, type Parameter } from '@shared/aqi';

import { catVar } from '@/lib/category';
import { formatConcentration, formatDayMonth, formatDelta, formatHourInterval } from '@/lib/format';
import {
  deltaVs24h,
  isFresh,
  lensOf,
  okrugLabel,
  okrugOf,
  thresholdRatio,
  thresholdsFor,
  type Lens,
  type LensReading,
  type StationDelta,
} from '@/lib/insights';
import { bestScore, normalizeText } from '@/lib/search';
import { isInactive, type StationView } from '@/lib/stations';

const HOUR_MS = 3_600_000;

/** Od koliko sati zaostatka za najnovijim satom mreže stanica dobija oznaku „kasni“. */
export const LAG_NOTE_HOURS = 2;

/**
 * Grupa stanice za raspodelu i filter: SEPA kategorija sočiva (0–5), `none` = sveža stanica
 * bez vrednosti tog polutanta, `stale` = bez svežih podataka, `inactive` = stanica koju je
 * SEPA ugasila (nije deo mreže; na listi samo kad korisnik uključi „neaktivne“).
 */
export type StationGroup = CategoryRank | 'none' | 'stale' | 'inactive';

/** Stanica bez svežih podataka – zastarela ili neaktivna (siva, bez kategorije, na kraju liste). */
export function isStaleGroup(group: StationGroup): group is 'stale' | 'inactive' {
  return group === 'stale' || group === 'inactive';
}

export interface StationRow {
  id: string;
  view: StationView;
  /** Očitavanje kroz sočivo (za `'worst'` dominantni polutant i ukupna kategorija). */
  reading: LensReading;
  /** Okrug (izvorni naziv) ili null. */
  okrug: string | null;
  group: StationGroup;
  /** Trenutna vrednost prema sopstvenom proseku 24 h (samo sveže stanice sa vrednošću). */
  delta: StationDelta | null;
  /** Satne vrednosti polutanta sočiva za mini grafikon (najstarija prva) ili null. */
  series: Array<number | null> | null;
  /** Koliko sati poslednje merenje zaostaje za najnovijim satom mreže (0 = ažurno). */
  lagHours: number;
  /** Ključ za sortiranje „kroz sočivo“: rang × 10 + odnos prema pragu; null bez kategorije. */
  severity: number | null;
}

function finiteCount(values: ReadonlyArray<number | null | undefined>): number {
  return values.reduce<number>((count, value) => (typeof value === 'number' && Number.isFinite(value) ? count + 1 : count), 0);
}

/** Grupa iz očitavanja: neaktivna → `inactive`, zastarela → `stale`, kategorija → rang, inače `none`. */
export function groupOf(view: StationView, reading: LensReading): StationGroup {
  if (isInactive(view)) return 'inactive';
  if (view.stale || !view.snapshot) return 'stale';
  return reading.category ? reading.category.rank : 'none';
}

/**
 * Redovi stranice za stanice (već filtrirane po okrugu) kroz sočivo.
 * `latestObservedAt` je najnoviji sat mreže (za oznaku „kasni N h“).
 */
export function buildStationRows(views: StationView[], lens: Lens, latestObservedAt: Date | null): StationRow[] {
  return views.map((view) => {
    const reading = lensOf(view, lens);
    const fresh = isFresh(view);
    const parameter = reading.parameter;
    const rawSeries = parameter ? view.series.values[parameter] : undefined;
    const series = fresh && Array.isArray(rawSeries) && finiteCount(rawSeries) >= 2 ? rawSeries : null;
    const lagHours =
      fresh && latestObservedAt && view.observedAt
        ? Math.max(0, Math.round((latestObservedAt.getTime() - view.observedAt.getTime()) / HOUR_MS))
        : 0;
    const severity =
      fresh && reading.category && parameter && reading.value !== null ? reading.category.rank * 10 + thresholdRatio(parameter, reading.value) : null;
    return {
      id: view.id,
      view,
      reading,
      okrug: okrugOf(view),
      group: groupOf(view, reading),
      delta: fresh && parameter && reading.value !== null ? deltaVs24h(view, parameter) : null,
      series,
      lagHours,
      severity,
    };
  });
}

// ---------------------------------------------------------------------------
// Raspodela po grupama
// ---------------------------------------------------------------------------

export interface GroupCount {
  group: StationGroup;
  count: number;
}

const GROUP_ORDER: StationGroup[] = [0, 1, 2, 3, 4, 5, 'none', 'stale', 'inactive'];

/** Broj stanica po grupi, redom Dobar → Izuzetno zagađen, bez vrednosti, bez svežih, neaktivne; samo neprazne. */
export function groupCounts(rows: StationRow[]): GroupCount[] {
  const counts = new Map<StationGroup, number>();
  for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
  return GROUP_ORDER.filter((group) => (counts.get(group) ?? 0) > 0).map((group) => ({ group, count: counts.get(group) ?? 0 }));
}

/** Natpis grupe: naziv SEPA kategorije, „Bez vrednosti“, „Bez svežih podataka“ ili „Neaktivne“. */
export function groupLabel(group: StationGroup): string {
  if (group === 'inactive') return 'Neaktivne';
  if (group === 'stale') return 'Bez svežih podataka';
  if (group === 'none') return 'Bez vrednosti';
  return CATEGORIES[group].label;
}

/** Vrednosti parametra `?grupa=` (čitljive u linku, bez dijakritika). */
const GROUP_SLUGS: ReadonlyArray<readonly [StationGroup, string]> = [
  [0, 'dobar'],
  [1, 'prihvatljiv'],
  [2, 'umeren'],
  [3, 'zagadjen'],
  [4, 'veoma-zagadjen'],
  [5, 'izuzetno-zagadjen'],
  ['none', 'bez-vrednosti'],
  ['stale', 'bez-svezih'],
  ['inactive', 'neaktivne'],
];

/** Grupa → vrednost za URL (`?grupa=umeren`). */
export function encodeGroup(group: StationGroup): string {
  return GROUP_SLUGS.find(([candidate]) => candidate === group)?.[1] ?? '';
}

/** Vrednost iz URL-a → grupa ili null (nepoznata vrednost se zanemaruje). */
export function parseGroup(value: string | null | undefined): StationGroup | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  return GROUP_SLUGS.find(([, candidate]) => candidate === slug)?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pretraga
// ---------------------------------------------------------------------------

/** Ocena od koje je poklapanje „pravo“ (početak teksta ili reči, podniz) – vidi `matchScore`. */
export const STRONG_MATCH = 40;

export interface SearchResult {
  rows: StationRow[];
  /** true kad nijedno pravo poklapanje ne postoji, pa su prikazana rasuta (slova redom). */
  loose: boolean;
}

/**
 * Pretraga po nazivu, šifri, opštini i okrugu, bez obzira na dijakritike i veličinu slova
 * („cacak“ nalazi „Čačak“, „djurdj“ nalazi „Đurđ…“). Rasuta poklapanja se vraćaju samo kad
 * nema nijednog pravog. Redosled ulaza se čuva (sortira pozivalac).
 */
export function searchRows(rows: StationRow[], query: string): SearchResult {
  const q = normalizeText(query);
  if (!q) return { rows, loose: false };
  const scored = rows.map((row) => ({
    row,
    score: bestScore(q, [row.view.station.name, row.view.station.code, row.view.station.municipality, row.okrug ? okrugLabel(row.okrug) : null]),
  }));
  const strong = scored.filter((entry) => entry.score >= STRONG_MATCH);
  if (strong.length > 0) return { rows: strong.map((entry) => entry.row), loose: false };
  const loose = scored.filter((entry) => entry.score > 0);
  return { rows: loose.map((entry) => entry.row), loose: loose.length > 0 };
}

// ---------------------------------------------------------------------------
// Sortiranje
// ---------------------------------------------------------------------------

export type SortKey = 'lens' | 'name' | 'delta' | Parameter;
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Podrazumevano: najlošije stanice kroz sočivo prve. */
export const DEFAULT_SORT: SortState = { key: 'lens', dir: 'desc' };

/** Prirodni smer kad se kolona izabere prvi put: naziv A–Ž, brojevi od najvećeg. */
export function defaultDirFor(key: SortKey): SortDir {
  return key === 'name' ? 'asc' : 'desc';
}

const SORT_KEYS: readonly SortKey[] = ['lens', 'name', 'delta', ...PARAMETERS];

/** Redosled → vrednost za URL (`?sort=name-asc`); podrazumevani redosled je `null` (bez parametra). */
export function encodeSort(sort: SortState): string | null {
  if (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir) return null;
  return `${sort.key}-${sort.dir}`;
}

/** Vrednost iz URL-a → redosled; neispravna vrednost daje podrazumevani (`DEFAULT_SORT`). */
export function parseSort(value: string | null | undefined): SortState {
  if (!value) return DEFAULT_SORT;
  const cut = value.lastIndexOf('-');
  const key = value.slice(0, cut) as SortKey;
  const dir = value.slice(cut + 1);
  if (cut <= 0 || !SORT_KEYS.includes(key) || (dir !== 'asc' && dir !== 'desc')) return DEFAULT_SORT;
  return { key, dir };
}

/** Klik na zaglavlje: ista kolona menja smer, nova kolona počinje prirodnim smerom. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: defaultDirFor(key) };
}

function metric(row: StationRow, key: Exclude<SortKey, 'name'>): number | null {
  if (key === 'lens') return row.severity;
  if (key === 'delta') return row.delta ? row.delta.delta : null;
  const value = row.view.values[key]?.v;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function byName(a: StationRow, b: StationRow): number {
  return a.view.station.name.localeCompare(b.view.station.name, 'sr-Latn');
}

/**
 * Sortira redove. Po nazivu: čisto abecedno (i zastarele stanice). Po broju: sveže stanice
 * sa vrednošću po izabranom smeru, zatim sveže bez vrednosti, pa zastarele i na kraju
 * neaktivne – bez obzira na smer (stara vrednost ne sme da „pobedi“ u rang-listi).
 * Izjednačene po nazivu.
 */
export function sortRows(rows: StationRow[], sort: SortState): StationRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') return [...rows].sort((a, b) => byName(a, b) * sign || a.id.localeCompare(b.id));
  const key = sort.key;
  const tier = (row: StationRow): number => (row.group === 'inactive' ? 3 : row.group === 'stale' ? 2 : metric(row, key) === null ? 1 : 0);
  return [...rows].sort((a, b) => {
    const tierA = tier(a);
    const tierB = tier(b);
    if (tierA !== tierB) return tierA - tierB;
    if (tierA === 0) {
      const diff = ((metric(a, key) as number) - (metric(b, key) as number)) * sign;
      if (diff !== 0) return diff;
    }
    return byName(a, b) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// SEPA skala (traka u koloni sočiva)
// ---------------------------------------------------------------------------

export interface ScalePosition {
  /** Položaj 0–1 na skali sa jednakim pojasevima kategorija. */
  position: number;
  /** Vrednost je iznad poslednjeg prikazanog pojasa (traka je puna). */
  overflow: boolean;
}

/**
 * Položaj vrednosti na ordinalnoj SEPA skali polutanta: `bands` pojaseva iste širine
 * (Dobar, Prihvatljiv …), unutar pojasa linearno. Tako su uporedive stanice sa različitim
 * dominantnim polutantima, a granice kategorija su ravnomerne crtice na traci.
 */
export function scalePosition(parameter: Parameter, value: number, bands = 6): ScalePosition {
  const count = Math.min(6, Math.max(1, Math.round(bands)));
  const scale = thresholdsFor(parameter).bands;
  const safe = Math.max(0, value);
  for (let index = 0; index < count; index++) {
    const band = scale[index];
    const last = index === count - 1;
    if (safe <= band.to || (last && index === scale.length - 1)) {
      const span = band.to - band.from || 1;
      const fraction = Math.min(1, Math.max(0, (safe - band.from) / span));
      return { position: (index + fraction) / count, overflow: last && safe > band.to };
    }
  }
  return { position: 1, overflow: true };
}

/**
 * Broj pojaseva skale za prikazane stanice: do kategorije iznad najgore prisutne, najmanje 4
 * (Dobar … Zagađen), najviše 6. Računa se iz svih stanica okruga, ne iz rezultata pretrage,
 * da trake ne „skaču“ dok korisnik kuca.
 */
export function bandsFor(rows: StationRow[]): number {
  let maxRank = 0;
  for (const row of rows) if (typeof row.group === 'number' && row.group > maxRank) maxRank = row.group;
  return Math.min(6, Math.max(4, maxRank + 2));
}

/** Granice kategorija (µg/m³) koje traka sa `bands` pojaseva prikazuje kao crtice. */
export function bandLimits(parameter: Parameter, bands: number): number[] {
  return thresholdsFor(parameter).limits.slice(0, Math.max(0, Math.min(5, bands - 1)));
}

// ---------------------------------------------------------------------------
// Tekstovi
// ---------------------------------------------------------------------------

export interface DeltaText {
  arrow: '↑' | '↓' | '→';
  /** Iznos promene (bez znaka) ili null kad je promena zanemarljiva. */
  amount: string | null;
  /** „iznad proseka“, „ispod proseka“, „kao prosek“. */
  words: string;
  direction: StationDelta['direction'];
}

/** Promena prema sopstvenom proseku 24 h rečima (rast je lošiji – boju bira prikaz). */
export function deltaText(delta: StationDelta): DeltaText {
  const abs = Math.abs(delta.delta);
  if (delta.direction === 'flat') return { arrow: '→', amount: null, words: 'kao prosek', direction: 'flat' };
  return {
    arrow: delta.direction === 'up' ? '↑' : '↓',
    amount: formatDelta(abs),
    words: delta.direction === 'up' ? 'iznad proseka' : 'ispod proseka',
    direction: delta.direction,
  };
}

/**
 * Vrednost za tabelu i kartice: isto pravilo kao ostatak aplikacije (`formatConcentration`),
 * ali sa zadržanom decimalom ispod 100 („8,0“), da se decimalni zarezi poravnaju u koloni.
 */
export function formatValue(value: number | null | undefined): string {
  return formatConcentration(value, { fixed: true });
}

/** „04. 10. 12–13 h“ – dan i satni interval poslednjeg merenja zastarele stanice (kao čip mreže). */
export function formatLastSeen(date: Date): string {
  return `${formatDayMonth(date)} ${formatHourInterval(date)}`;
}

/** Kratak naziv okruga za čip: bez reči „okrug“ („Južnobački“, „Grad Beograd“). */
export function okrugShort(okrug: string): string {
  return okrugLabel(okrug).replace(/\s+okrug$/i, '');
}

/** Opšti status mreže za zaglavlje: sveže, kasne, bez svežih, neaktivne, približne lokacije. */
export interface StatusSummary {
  /** Svi redovi (neaktivni samo kad su uključeni u listu). */
  total: number;
  fresh: number;
  lagging: number;
  /** Aktivne stanice bez svežih podataka. */
  stale: number;
  /** Neaktivne stanice među redovima. */
  inactive: number;
  approximate: number;
}

export function statusSummary(rows: StationRow[]): StatusSummary {
  let fresh = 0;
  let lagging = 0;
  let stale = 0;
  let inactive = 0;
  let approximate = 0;
  for (const row of rows) {
    if (row.group === 'inactive') inactive++;
    else if (row.group === 'stale') stale++;
    else {
      fresh++;
      if (row.lagHours >= LAG_NOTE_HOURS) lagging++;
    }
    if (row.view.position?.approximate) approximate++;
  }
  return { total: rows.length, fresh, lagging, stale, inactive, approximate };
}

/**
 * Boja reda/kartice kao CSS promenljive: kategorija sočiva, a bez nje prigušena (zastarela
 * ili bez vrednosti). `--haze` daje kartici (`haze-local`) ivicu i sjaj u toj boji.
 */
export function rowTint(row: StationRow): Record<string, string> {
  const color = typeof row.group === 'number' ? catVar(row.group) : 'var(--faint)';
  return { '--st-tint': color, '--haze': color };
}
