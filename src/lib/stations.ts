/**
 * Model prikaza stanice: stanica + snimak + rasklopljene JSON kolone + pozicija na mapi
 * + pravilo svežine (stanica koja je prestala da javlja ne sme da zadrži staru kategoriju).
 */

import { PARAMETERS, type Parameter } from '@shared/aqi';
import { parseSnapshotRecord } from '@shared/aggregate';
import type { SnapshotSeries, SnapshotValues, StationRecord, StationSnapshotRecord } from '@shared/contracts';

import opstineOkrug from '@/data/opstine-okrug.json';
import { categoryOf, type Category } from '@/lib/category';
import { formatHourAt, formatRelative } from '@/lib/format';
import { median } from '@/lib/scale';

type MunicipalityIndex = Record<string, { okrug: string; lat: number; lon: number }>;

const municipalities = opstineOkrug as MunicipalityIndex;
const municipalityByLowerName = new Map<string, { okrug: string; lat: number; lon: number }>(
  Object.entries(municipalities).map(([name, entry]) => [name.toLowerCase(), entry]),
);

/**
 * Snimak stariji od ovoliko sati je zastareo: stanica se ne računa u stanje mreže,
 * na mapi i u tabeli nema kategoriju, a u detaljima se vide poslednje poznate vrednosti.
 * SEPA podaci redovno kasne 1–3 h, pa je 6 h jasna granica između kašnjenja i zastoja.
 */
export const STALE_HOURS = 6;

export interface StationPosition {
  lat: number;
  lon: number;
  /** true kad je pozicija centar okruga (stanica nema koordinate u API-ju). */
  approximate: boolean;
  okrug?: string;
}

export interface StationView {
  id: string;
  station: StationRecord;
  snapshot: StationSnapshotRecord | null;
  values: SnapshotValues;
  series: SnapshotSeries;
  /** Najgora SEPA kategorija ili null kad nema snimka ili je snimak zastareo. */
  category: Category | null;
  dominant: Parameter | null;
  /** Kategorija iz snimka bez obzira na svežinu (za napomenu „poslednja poznata“). */
  lastCategory: Category | null;
  observedAt: Date | null;
  /** true kad je snimak stariji od `STALE_HOURS` ili je stanica označena kao neaktivna. */
  stale: boolean;
  position: StationPosition | null;
}

/**
 * Pozicija za opštinu: tačan naziv, pa nazivi bez obzira na veličinu slova, pa deo pre
 * crte/zareza/zagrade. Gradovi podeljeni na gradske opštine (npr. „Kragujevac“) imaju i
 * sopstveni red u `opstine-okrug.json`. Posle prve prave sinhronizacije uporedite nazive
 * opština iz SEPA podataka sa indeksom i dopunite ga.
 */
export function municipalityPosition(municipality: string | null | undefined): StationPosition | null {
  if (!municipality) return null;
  const candidates = [municipality.trim()];
  const head = municipality.split(/\s[-–]\s|,|\(/)[0]?.trim();
  if (head && head !== candidates[0]) candidates.push(head);
  for (const candidate of candidates) {
    const entry = municipalities[candidate] ?? municipalityByLowerName.get(candidate.toLowerCase());
    if (entry) return { lat: entry.lat, lon: entry.lon, approximate: true, okrug: entry.okrug };
  }
  return null;
}

function isParameter(value: string): value is Parameter {
  return (PARAMETERS as readonly string[]).includes(value);
}

/**
 * Neaktivna stanica: SEPA ju je skinula sa liste aktivnih (`active = false`). Sinhronizacija je
 * nikad ne briše (istorija ostaje za Trendove), ali ona više nije deo mreže: ne broji se u
 * ukupan broj stanica, u „bez svežih podataka“, u prsten ni na mapi.
 */
export function isInactive(view: Pick<StationView, 'station'>): boolean {
  return view.station.active === false;
}

/** Stanice koje su deo mreže (bez neaktivnih) – podrazumevani skup za brojanje i mapu. */
export function activeViews<T extends Pick<StationView, 'station'>>(views: readonly T[]): T[] {
  return views.filter((view) => !isInactive(view));
}

/** Zastareo: snimak stariji od `STALE_HOURS` sati u odnosu na `now`, ili neaktivna stanica. */
export function isStale(station: StationRecord, observedAt: Date | null, now: Date): boolean {
  if (station.active === false) return true;
  if (!observedAt) return false;
  return now.getTime() - observedAt.getTime() > STALE_HOURS * 3_600_000;
}

export function buildStationViews(
  stations: StationRecord[],
  snapshots: StationSnapshotRecord[],
  now: Date = new Date(),
): StationView[] {
  const snapshotByStation = new Map<string, StationSnapshotRecord>();
  for (const snapshot of snapshots) snapshotByStation.set(snapshot.station_id, snapshot);

  const views: StationView[] = [];
  for (const station of stations) {
    const snapshot = snapshotByStation.get(station.id) ?? null;
    const parsed = snapshot ? parseSnapshotRecord(snapshot) : null;
    const hasCoordinates =
      typeof station.latitude === 'number' &&
      typeof station.longitude === 'number' &&
      Number.isFinite(station.latitude) &&
      Number.isFinite(station.longitude);
    const position: StationPosition | null = hasCoordinates
      ? { lat: station.latitude as number, lon: station.longitude as number, approximate: false }
      : municipalityPosition(station.municipality);
    const parsedObservedAt = snapshot ? new Date(snapshot.observedAt) : null;
    const observedAt = parsedObservedAt && !Number.isNaN(parsedObservedAt.getTime()) ? parsedObservedAt : null;
    const stale = isStale(station, observedAt, now);
    const lastCategory = snapshot ? categoryOf(snapshot.category) : null;
    views.push({
      id: station.id,
      station,
      snapshot,
      values: parsed?.values ?? {},
      series: parsed?.series ?? { start: new Date(0).toISOString(), values: {} },
      // Zastarela stanica nema kategoriju za KPI, mapu i tabelu – stara boja bi lagala.
      category: stale ? null : lastCategory,
      dominant: !stale && snapshot && isParameter(snapshot.dominant) ? snapshot.dominant : null,
      lastCategory,
      observedAt,
      stale,
      position,
    });
  }
  return views.sort((a, b) => a.station.name.localeCompare(b.station.name, 'sr-Latn'));
}

export interface NetworkKpis {
  /** Stanice sa svežim snimkom (ulaze u raspodelu i medijane). */
  reporting: number;
  /** Aktivne stanice mreže (neaktivne nisu uračunate, vidi `isInactive`). */
  total: number;
  /** Aktivne stanice sa zastarelim snimkom ili bez snimka – u `total`, ne u `reporting`. */
  stale: number;
  /** Neaktivne stanice (SEPA ih je ugasila) – nisu ni u `total` ni u `stale`. */
  inactive: number;
  /** Broj stanica po kategoriji 0–5. */
  countsByCategory: number[];
  worst: StationView | null;
  medianPm10: number | null;
  medianPm25: number | null;
  /** Najnoviji sat merenja u mreži (samo sveže stanice). */
  latestObservedAt: Date | null;
}

export function computeNetworkKpis(views: StationView[]): NetworkKpis {
  const counts = [0, 0, 0, 0, 0, 0];
  let worst: StationView | null = null;
  const pm10: number[] = [];
  const pm25: number[] = [];
  let latest: Date | null = null;
  let reporting = 0;
  let stale = 0;
  let inactive = 0;
  for (const view of views) {
    if (isInactive(view)) {
      inactive++;
      continue;
    }
    // Aktivna stanica bez snimka ili bez kategorije takođe nema sveže podatke: `total` je uvek
    // `reporting + stale`, pa „25 / 26“ i „1 bez svežih podataka“ uvek idu zajedno.
    if (view.stale || !view.snapshot || !view.category) {
      stale++;
      continue;
    }
    reporting++;
    counts[view.category.rank]++;
    if (!worst || view.category.rank > (worst.category?.rank ?? -1)) worst = view;
    const p10 = view.values.PM10?.v;
    const p25 = view.values['PM2.5']?.v;
    if (typeof p10 === 'number') pm10.push(p10);
    if (typeof p25 === 'number') pm25.push(p25);
    if (view.observedAt && (!latest || view.observedAt > latest)) latest = view.observedAt;
  }
  return {
    reporting,
    total: views.length - inactive,
    stale,
    inactive,
    countsByCategory: counts,
    worst,
    medianPm10: median(pm10),
    medianPm25: median(pm25),
    latestObservedAt: latest,
  };
}

// ---------------------------------------------------------------------------
// „Uživo“: koliko je star najnoviji sat mreže
// ---------------------------------------------------------------------------

/**
 * Najnoviji satni interval je „uživo“ dok se nije završio pre više od ovoliko sati. SEPA
 * objavljuje sa kašnjenjem od 1–3 h, pa je to normalno stanje; starije je „poslednji sat“.
 */
export const LIVE_HOURS = 3;

export interface LiveStatus {
  /** Najnoviji interval se završio pre najviše `LIVE_HOURS` sati (pulsirajuća tačka, „Uživo“). */
  live: boolean;
  /** Interval sa datumom kad nije današnji: „16–17 h“ ili „06. 10. 16–17 h“ („–“ bez merenja). */
  label: string;
  /**
   * Starost KRAJA intervala, kao „Izmereno … · pre 2 h“ kod stanice: „pre 2 h“ = interval se
   * završio pre 2 h (prazno bez merenja). Isti trenutak kao za `live`: sat 0–1 h koji se
   * zatvorio pre 28 min je „pre 28 min“, ne „pre 1 h“ (starost početka bi dodala ceo sat).
   */
  ageText: string;
}

/**
 * Status najnovijeg sata mreže (`latestObservedAt` = POČETAK satnog intervala, kao
 * `time_start_utc`). Uživo samo dok je interval završen pre najviše `LIVE_HOURS` sati; sat
 * uvek nosi starost (od kraja intervala) i datum kad nije današnji – stari podatak nikad ne
 * izgleda kao svež.
 */
export function liveStatus(latestObservedAt: Date | null, now: Date): LiveStatus {
  if (!latestObservedAt || Number.isNaN(latestObservedAt.getTime())) return { live: false, label: '–', ageText: '' };
  const endMs = latestObservedAt.getTime() + 3_600_000;
  const live = now.getTime() - endMs <= LIVE_HOURS * 3_600_000;
  return { live, label: formatHourAt(latestObservedAt, now), ageText: formatRelative(endMs, now) };
}
