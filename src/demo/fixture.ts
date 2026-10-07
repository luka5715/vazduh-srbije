/**
 * Demo podaci (VITE_SERVICE_MODE=demo): izmišljene stanice jasno označene kao demo,
 * sa determinističkim satnim vrednostima (hash umesto PRNG stanja, pa je svaki sat
 * isti bez obzira na dužinu prozora). Snimci i dnevna statistika se računaju ISTIM
 * kodom kao na serveru (`@shared/aggregate`), pa demo prolazi kroz iste putanje kao
 * pravi podaci. Nema slučajnosti pri renderu.
 *
 * Dnevna statistika za 31 dan je skupa (~100 000 merenja kroz computeDailyStats), zato
 * se računa po stanici (`dailyStatsForStation`) i lenjo – DemoDataService je gradi tek
 * kad zatreba i između stanica pušta event loop.
 *
 * Istorija namerno ima rupe (`demoHistoryGaps`): dva dana koja niko nije učitao i jedan dan
 * učitan samo za deo stanica, kao u pravoj bazi kad aplikaciju danima niko ne otvori. Demo
 * servis ih „učita“ kad korisnik pokrene „Dopuni nedostajuće dane“.
 */

import { computeDailyStats, computeSnapshot } from '@shared/aggregate';
import { PARAMETERS, type Parameter } from '@shared/aqi';
import type {
  DailyStatRecord,
  StationRecord,
  StationSnapshotRecord,
  SyncRunRecord,
} from '@shared/contracts';
import type { KosavaObservation } from '@shared/kosava';
import { addDays, dayUtcRange, localDay, localHour } from '@shared/time';

import okruzi from '@/data/okruzi.json';
import type { GeoCollection } from '@/lib/geo';
import { isKosovoDistrict } from '@/lib/geo';

export interface DemoFixture {
  stations: StationRecord[];
  snapshots: StationSnapshotRecord[];
  dailyStats: DailyStatRecord[];
  syncRuns: SyncRunRecord[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Koliko dana istorije fixture pokriva (API čuva 30 dana + današnji). */
export const HISTORY_DAYS = 31;
/** Prozor za snimak trenutnog stanja. */
const SNAPSHOT_HOURS = 48;

/** Glavni grad okruga → ime demo stanice i `municipality`. */
const DISTRICT_TOWN: Record<string, string> = {
  Zaječarski: 'Zaječar',
  'Kolubarski okrug': 'Valjevo',
  'Borski okrug': 'Bor',
  'Zlatiborski okrug': 'Užice',
  'Šumadijski okrug': 'Kragujevac',
  'Braničevski okrug': 'Požarevac',
  'Jablanički okrug': 'Leskovac',
  'Moravički okrug': 'Čačak',
  'Nišavski okrug': 'Niš',
  'Mačvanski okrug': 'Šabac',
  'Pčinjski okrug': 'Vranje',
  'Grad Beograd': 'Beograd',
  'Južnobački okrug': 'Novi Sad',
  'Južnobanatski okrug': 'Pančevo',
  'Srednjebanatski okrug': 'Zrenjanin',
  'Pirotski okrug': 'Pirot',
  'Zapadnobački okrug': 'Sombor',
  'Severnobački okrug': 'Subotica',
  'Severnobanatski okrug': 'Kikinda',
  Sremski: 'Sremska Mitrovica',
  'Pomoravski okrug': 'Jagodina',
  'Rasinski okrug': 'Kruševac',
  'Raški okrug': 'Kraljevo',
  'Podunavski okrug': 'Smederevo',
  'Toplički okrug': 'Prokuplje',
};

/** Profil zagađenja: množioci u odnosu na „prosečan grad“. */
interface Profile {
  pm: number;
  no2: number;
  so2: number;
  o3: number;
}

/** Karakteristični demo profili (grejanje u kotlinama, saobraćaj, industrija). */
const PROFILES: Record<string, Partial<Profile>> = {
  Valjevo: { pm: 2.6, no2: 0.8 },
  Užice: { pm: 2.2, no2: 0.7 },
  Niš: { pm: 1.5, no2: 1.3 },
  Beograd: { pm: 1.3, no2: 1.9, so2: 0.9 },
  Pančevo: { pm: 1.1, so2: 2.6 },
  Bor: { pm: 0.8, so2: 6.5, no2: 0.5 },
  Smederevo: { pm: 1.6, so2: 1.4 },
  Kragujevac: { pm: 1.25, no2: 1.1 },
  Kraljevo: { pm: 1.45 },
  Čačak: { pm: 1.35 },
  Zaječar: { pm: 1.1 },
  Leskovac: { pm: 1.2 },
  Kruševac: { pm: 1.0 },
  Jagodina: { pm: 0.9 },
  Požarevac: { pm: 0.95, so2: 1.6 },
  Šabac: { pm: 0.85 },
  'Novi Sad': { pm: 0.75, no2: 1.2 },
  'Sremska Mitrovica': { pm: 0.7 },
  Subotica: { pm: 0.45, no2: 0.7, o3: 1.1 },
  Pirot: { pm: 0.28, no2: 0.5, o3: 1.15 },
  Sombor: { pm: 0.45, o3: 1.05 },
  Zrenjanin: { pm: 0.65 },
  Kikinda: { pm: 0.55 },
  Vranje: { pm: 0.3, no2: 0.5, o3: 1.1 },
  Prokuplje: { pm: 1.0 },
};

/** Satni oblik dana po parametru (indeks = lokalni sat). */
const DIURNAL: Record<Parameter, number[]> = {
  PM10: [1.25, 1.15, 1.0, 0.9, 0.85, 0.9, 1.05, 1.2, 1.15, 0.95, 0.8, 0.7, 0.65, 0.65, 0.7, 0.8, 0.95, 1.15, 1.4, 1.6, 1.7, 1.65, 1.5, 1.35],
  'PM2.5': [1.3, 1.2, 1.05, 0.95, 0.9, 0.9, 1.05, 1.2, 1.1, 0.9, 0.75, 0.65, 0.6, 0.6, 0.65, 0.75, 0.95, 1.2, 1.5, 1.7, 1.8, 1.75, 1.6, 1.4],
  NO2: [0.7, 0.6, 0.55, 0.55, 0.6, 0.8, 1.2, 1.6, 1.5, 1.2, 1.0, 0.95, 0.95, 0.95, 1.0, 1.15, 1.4, 1.6, 1.5, 1.3, 1.1, 0.95, 0.85, 0.75],
  SO2: [0.9, 0.9, 0.9, 0.9, 0.95, 1.0, 1.1, 1.2, 1.2, 1.1, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1, 1.1, 1.05, 1.0, 0.95, 0.9, 0.9],
  O3: [0.6, 0.55, 0.5, 0.45, 0.45, 0.45, 0.5, 0.6, 0.8, 1.0, 1.2, 1.4, 1.55, 1.65, 1.7, 1.65, 1.5, 1.3, 1.1, 0.9, 0.8, 0.7, 0.65, 0.6],
};

/** Osnovne (prosečne) satne vrednosti za „prosečan grad“ u oktobru, µg/m³. */
const BASE: Record<Parameter, number> = {
  PM10: 22,
  'PM2.5': 9,
  NO2: 18,
  SO2: 7,
  O3: 46,
};

/** Jedan korak mulberry32 – deterministički broj u [0,1) za zadati seed. */
function hash01(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministički faktor „vremenskih prilika“ po danu, zajednički za celu mrežu. */
function weatherFactor(dayIndexFromToday: number): { pm: number; o3: number } {
  // Dve stagnacije (inverzije) u poslednjih 30 dana: traje i danas (dani 0–2) i pre 17–19 dana.
  const episode = dayIndexFromToday <= 2 || (dayIndexFromToday >= 17 && dayIndexFromToday <= 19);
  const wave = 1 + 0.25 * Math.sin((dayIndexFromToday / HISTORY_DAYS) * Math.PI * 2);
  const rain = dayIndexFromToday === 11 || dayIndexFromToday === 12 ? 0.5 : 1; // kiša pre 11–12 dana
  const pm = wave * (episode ? 1.5 : 1) * rain;
  const o3 = (2 - wave) * (episode ? 0.85 : 1);
  return { pm, o3 };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface DemoStationSpec {
  sepaId: number;
  id: string;
  name: string;
  code: string;
  municipality: string;
  lat: number | null;
  lon: number | null;
  profile: Profile;
  /** Koji parametri se mere (neke stanice nemaju O3/SO2). */
  parameters: Parameter[];
  /**
   * Koliko sati pre „sada“ je poslednje merenje: 1 = redovno, 3 = kasni („podaci kasne“),
   * `STALE_LAG_HOURS` = stanica je prestala da javlja pre ~3 dana (zastareo snimak).
   */
  lagHours: number;
}

/** Zastoj zastarele demo stanice: poslednje merenje pre ~3 dana (snimak postoji, ali je zastareo). */
export const STALE_LAG_HOURS = 73;

export function buildSpecs(): DemoStationSpec[] {
  const features = (okruzi as GeoCollection).features.filter((f) => !isKosovoDistrict(f.properties.name));
  const specs: DemoStationSpec[] = [];
  let index = 0;
  for (const feature of features) {
    const town = DISTRICT_TOWN[feature.properties.name];
    if (!town) continue;
    const [lon, lat] = feature.properties.centroid ?? [20.5, 44];
    const profile = { pm: 1, no2: 1, so2: 1, o3: 1, ...PROFILES[town] };
    index++;
    const sepaId = 9000 + index;
    const noCoordinates = town === 'Valjevo' || town === 'Čačak';
    specs.push({
      sepaId,
      id: `demo-station-${sepaId}`,
      name: `Demo stanica ${town} 1`,
      code: `DEMO-${String(index).padStart(3, '0')}`,
      municipality: town,
      // Dve stanice bez koordinata – prikaz „približna lokacija“ preko centra okruga.
      lat: noCoordinates ? null : lat,
      lon: noCoordinates ? null : lon,
      profile,
      parameters: town === 'Pirot' ? ['PM10', 'PM2.5', 'NO2'] : [...PARAMETERS],
      // Kikinda kasni 3 h (još je sveža), Prokuplje je stala pre ~3 dana (jedina zastarela).
      lagHours: town === 'Kikinda' ? 3 : town === 'Prokuplje' ? STALE_LAG_HOURS : 1,
    });
    if (town === 'Beograd') {
      index++;
      specs.push({
        sepaId: 9000 + index,
        id: `demo-station-${9000 + index}`,
        name: 'Demo stanica Beograd 2',
        code: `DEMO-${String(index).padStart(3, '0')}`,
        municipality: 'Novi Beograd',
        lat: lat - 0.07,
        lon: lon - 0.09,
        profile: { pm: 1.05, no2: 1.9, so2: 0.8, o3: 0.9 },
        parameters: [...PARAMETERS],
        lagHours: 1,
      });
    }
  }
  return specs;
}

function profileFactor(profile: Profile, parameter: Parameter): number {
  switch (parameter) {
    case 'PM10':
    case 'PM2.5':
      return profile.pm;
    case 'NO2':
      return profile.no2;
    case 'SO2':
      return profile.so2;
    case 'O3':
      return profile.o3;
  }
}

interface HourSlot {
  /** Apsolutni indeks sata (ms / 1 h) – ključ za hash. */
  hourIndex: number;
  iso: string;
  hour: number;
  weather: { pm: number; o3: number };
}

const slotCache = new Map<string, HourSlot[]>();

/** Lokalni sat i vremenski faktor za svaki sat prozora – jednom po prozoru, ne po merenju. */
function hourSlots(latestHourMs: number, todayDay: string, hours: number): HourSlot[] {
  const key = `${latestHourMs}|${todayDay}|${hours}`;
  const cached = slotCache.get(key);
  if (cached) return cached;
  const todayMs = Date.parse(`${todayDay}T12:00:00Z`);
  const slots: HourSlot[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const t = latestHourMs - i * HOUR_MS;
    const dayIndex = Math.max(0, Math.round((todayMs - Date.parse(`${localDay(t)}T12:00:00Z`)) / DAY_MS));
    slots.push({ hourIndex: t / HOUR_MS, iso: new Date(t).toISOString(), hour: localHour(t), weather: weatherFactor(dayIndex) });
  }
  slotCache.set(key, slots);
  return slots;
}

/** SO2 „oblak“ industrijskih stanica: kratki visoki skokovi koji se gase 40 % po satu. */
function so2Spike(sepaId: number, hourIndex: number): number {
  let spike = 0;
  for (let back = 0; back <= 6; back++) {
    const h = hourIndex - back;
    if (hash01(sepaId * 1_000_003 + h * 31 + 7) < 0.06) {
      spike += (3 + hash01(sepaId * 1_000_003 + h * 31 + 11) * 4) * 0.6 ** back;
    }
  }
  return spike;
}

/** Satna merenja jedne stanice za poslednjih `hours` sati do `latestHourMs`. */
export function generateObservations(spec: DemoStationSpec, latestHourMs: number, todayDay: string, hours: number): KosavaObservation[] {
  const observations: KosavaObservation[] = [];
  const slots = hourSlots(latestHourMs, todayDay, hours);
  for (const parameter of spec.parameters) {
    const parameterIndex = PARAMETERS.indexOf(parameter);
    const base = BASE[parameter] * profileFactor(spec.profile, parameter);
    const industrial = parameter === 'SO2' && spec.profile.so2 > 2;
    for (const { hourIndex, iso, hour, weather } of slots) {
      const weatherMultiplier =
        parameter === 'O3' ? weather.o3 : parameter === 'PM10' || parameter === 'PM2.5' ? weather.pm : 1 + (weather.pm - 1) * 0.3;
      const noise = 1 + (hash01(spec.sepaId * 1_000_003 + parameterIndex * 7919 + hourIndex) - 0.5) * 0.5;
      const spike = industrial ? so2Spike(spec.sepaId, hourIndex) : 0;
      const value = base * DIURNAL[parameter][hour] * weatherMultiplier * noise * (1 + spike);
      observations.push({
        sepaId: spec.sepaId,
        parameter,
        timeStartUtc: iso,
        value: round1(Math.max(0.5, value)),
        unit: 'ug.m-3',
        dataStatus: 'preliminary',
      });
    }
  }
  return observations;
}

/** Najnoviji sat merenja: početak prethodnog punog sata (SEPA podaci kasne oko sat vremena). */
export function latestHourFor(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - HOUR_MS;
}

export interface DemoCore {
  specs: DemoStationSpec[];
  stations: StationRecord[];
  snapshots: StationSnapshotRecord[];
}

/** Stanice i snimci (brzo: 48 h po stanici); zastarela stanica ima snimak star ~3 dana. */
export function buildDemoCore(now: Date = new Date()): DemoCore {
  const latestHourMs = latestHourFor(now);
  const today = localDay(now);
  const specs = buildSpecs();
  const updatedAt = new Date(now.getTime() - 12 * 60_000);
  const stations: StationRecord[] = [];
  const snapshots: StationSnapshotRecord[] = [];

  for (const spec of specs) {
    const latestForStation = latestHourMs - (spec.lagHours - 1) * HOUR_MS;
    const recent = generateObservations(spec, latestForStation, today, SNAPSHOT_HOURS);
    const snapshot = computeSnapshot(recent);
    stations.push({
      id: spec.id,
      sepaId: spec.sepaId,
      code: spec.code,
      name: spec.name,
      municipality: spec.municipality,
      latitude: spec.lat,
      longitude: spec.lon,
      active: true,
      lastObservationAt: snapshot ? snapshot.observedAt : new Date(latestForStation).toISOString(),
      updatedAt,
    });
    if (snapshot) {
      snapshots.push({
        id: `demo-snapshot-${spec.sepaId}`,
        station_id: spec.id,
        observedAt: snapshot.observedAt,
        category: snapshot.category,
        dominant: snapshot.dominant,
        valuesJson: JSON.stringify(snapshot.values),
        seriesJson: JSON.stringify(snapshot.series),
        updatedAt,
      });
    }
  }
  return { specs, stations, snapshots };
}

/** Dnevna statistika jedne stanice za HISTORY_DAYS dana (sporo: ~3 700 merenja kroz computeDailyStats). */
export function dailyStatsForStation(spec: DemoStationSpec, now: Date): DailyStatRecord[] {
  const latestHourMs = latestHourFor(now);
  const today = localDay(now);
  // Zastarela stanica: istorija se takođe završava pre ~3 dana (poslednji dani bez statistike).
  const latestForStation = latestHourMs - (spec.lagHours - 1) * HOUR_MS;
  const observations = generateObservations(spec, latestForStation, today, HISTORY_DAYS * 24);
  const updatedAt = new Date(now.getTime() - 12 * 60_000);
  return computeDailyStats(observations).map((stat) => ({
    id: `demo-daily-${spec.sepaId}-${stat.parameter}-${stat.day}`,
    station_id: spec.id,
    parameter: stat.parameter,
    day: stat.day,
    avgValue: stat.avgValue,
    maxValue: stat.maxValue,
    minValue: stat.minValue,
    maxHour: stat.maxHour,
    hours: stat.hours,
    categoryMax: stat.categoryMax,
    updatedAt,
  }));
}

export function buildDemoSyncRuns(now: Date): SyncRunRecord[] {
  const minute = 60_000;
  const t = now.getTime();
  /** Kao `runSync`: prozor od 36 h čiji se početak vraća na lokalnu ponoć svog dana. */
  const syncWindowFrom = (end: number) => dayUtcRange(localDay(new Date(end - 36 * HOUR_MS))).from;
  const run = (
    id: string,
    kind: 'sync' | 'backfill',
    status: 'ok' | 'error',
    startedMsAgo: number,
    durationMs: number,
    windowFrom: Date,
    windowTo: Date,
    rows: { stationsSeen: number; observationsSeen: number; rowsWritten: number },
    message?: string,
  ): SyncRunRecord => ({
    id,
    kind,
    status,
    startedAt: new Date(t - startedMsAgo),
    finishedAt: new Date(t - startedMsAgo + durationMs),
    windowFrom,
    windowTo,
    ...rows,
    message: message ?? null,
  });
  const yesterday = new Date(t - DAY_MS);
  const y0 = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate(), -2));
  const y1 = new Date(y0.getTime() + DAY_MS);
  return [
    run('demo-run-1', 'sync', 'ok', 12 * minute + 95_000, 95_000, syncWindowFrom(t - 12 * minute), new Date(t - 12 * minute), {
      stationsSeen: 26,
      observationsSeen: 4_518,
      rowsWritten: 26 + 25 + 236,
    }),
    run('demo-run-2', 'sync', 'ok', 73 * minute, 88_000, syncWindowFrom(t - 73 * minute), new Date(t - 73 * minute), {
      stationsSeen: 26,
      observationsSeen: 4_490,
      rowsWritten: 26 + 25 + 236,
    }),
    run(
      'demo-run-3',
      'sync',
      'error',
      130 * minute,
      31_000,
      syncWindowFrom(t - 130 * minute),
      new Date(t - 130 * minute),
      { stationsSeen: 26, observationsSeen: 0, rowsWritten: 26 },
      'Kosava API: HTTP 503 Service Unavailable (observations?station_id=9003)',
    ),
    run(
      'demo-run-4',
      'backfill',
      'ok',
      26 * 60 * minute,
      142_000,
      y0,
      y1,
      { stationsSeen: 26, observationsSeen: 3_000, rowsWritten: 125 },
      `Dan ${localDay(y0.getTime() + 12 * HOUR_MS)}`,
    ),
    run(
      'demo-run-5',
      'backfill',
      'ok',
      26 * 60 * minute + 150_000,
      139_000,
      new Date(y0.getTime() - DAY_MS),
      y0,
      { stationsSeen: 26, observationsSeen: 3_000, rowsWritten: 125 },
      `Dan ${localDay(y0.getTime() - 12 * HOUR_MS)}`,
    ),
  ];
}

/** Dani (pre danas) koji u demo istoriji nisu učitani – rupa od dva dana. */
export const DEMO_MISSING_DAYS_AGO = [23, 24] as const;
/** Dan (pre danas) učitan samo za svaku drugu stanicu – delimičan dan. */
export const DEMO_PARTIAL_DAY_AGO = 6;

export interface DemoHistoryGaps {
  /** Dani bez ijednog reda dnevne statistike (YYYY-MM-DD). */
  missing: string[];
  /** Delimičan dan i stanice koje ga NEMAJU. */
  partialDay: string;
  partialStationIds: ReadonlySet<string>;
}

/** Rupe u demo istoriji za zadato „sada“ (izmišljene, kao i sve vrednosti demoa). */
export function demoHistoryGaps(specs: readonly DemoStationSpec[], now: Date): DemoHistoryGaps {
  const today = localDay(now);
  return {
    missing: DEMO_MISSING_DAYS_AGO.map((daysAgo) => addDays(today, -daysAgo)),
    partialDay: addDays(today, -DEMO_PARTIAL_DAY_AGO),
    partialStationIds: new Set(specs.filter((_, index) => index % 2 === 1).map((spec) => spec.id)),
  };
}

/** Red dnevne statistike koji demo baza (još) nema; `filled` su dani koje je korisnik dopunio. */
export function isDemoGap(stat: Pick<DailyStatRecord, 'day' | 'station_id'>, gaps: DemoHistoryGaps, filled: ReadonlySet<string>): boolean {
  if (filled.has(stat.day)) return false;
  if (gaps.missing.includes(stat.day)) return true;
  return stat.day === gaps.partialDay && gaps.partialStationIds.has(stat.station_id);
}

/** Ceo demo skup odjednom (testovi, merenja); UI koristi lenju varijantu u DemoDataService. */
export function buildDemoFixture(now: Date = new Date()): DemoFixture {
  const core = buildDemoCore(now);
  const gaps = demoHistoryGaps(core.specs, now);
  const dailyStats = core.specs.flatMap((spec) => dailyStatsForStation(spec, now)).filter((stat) => !isDemoGap(stat, gaps, new Set()));
  return { stations: core.stations, snapshots: core.snapshots, dailyStats, syncRuns: buildDemoSyncRuns(now) };
}
