/**
 * Podaci iz Fabric SQL baze aplikacije preko Rayfin GraphQL fluent klijenta i
 * poziv Fabric funkcija. Pravila (Rayfin SDK docs, data/graphql.md):
 *  - `.execute()` vraća JEDNU stranu (podrazumevano 100 redova) → uvek `.first(n)`;
 *  - sve što može da pređe stranu ide kroz `.executePaginated()` + `.after(endCursor)`;
 *  - filtriranje po stranom ključu (`station_id`), ne po `station.id`;
 *  - nad tekstualnim poljima samo `eq`-filteri (opseg dana: sortiranje + rano zaustavljanje);
 *  - smer sortiranja malim slovima;
 *  - tekst oblika `YYYY-MM-DD` SDK u browseru vraća kao `Date` → `dayKey` ga vraća u tekst.
 */

import type {
  BackfillResult,
  DailyStatRecord,
  StationRecord,
  StationSnapshotRecord,
  SyncResult,
  SyncRunRecord,
} from '@shared/contracts';

import { isRunInvalid } from '@/lib/syncRules';

import type { VazduhSchema } from '../../rayfin/data/schema';
import type { DataService } from './dataService';
import type { VazduhClient } from './rayfinClient';

type Station = VazduhSchema['Station'];
type StationSnapshot = VazduhSchema['StationSnapshot'];
type DailyStat = VazduhSchema['DailyStat'];
type SyncRun = VazduhSchema['SyncRun'];

/** Strana za dnevnu statistiku JEDNE stanice (≤ 5 polutanata × dani: 30 dana ≈ 150 redova, 1 strana). */
const PAGE_SIZE = 1000;
/**
 * Strana za dnevnu statistiku CELE mreže: ~87 stanica × do 5 polutanata ≈ 370 redova dnevno, pa
 * 30 dana ≈ 11.000 redova – sa 1.000 po strani to je 12 uzastopnih zahteva, sa 5.000 tri.
 * Funkcije već čitaju DailyStat u stranama od 5.000 (`DAY_PAGE` u sync.ts) bez problema.
 */
const NETWORK_PAGE_SIZE = 5000;
/** Gornja granica za jednostrane liste (stanice, snimci: mreža ima ~60 stanica). */
const SINGLE_PAGE = 1000;
/**
 * Trajanje funkcija je izmereno u dnevniku (`SyncRun`; na tenantu sinhronizacija ~12 s za 87
 * stanica i 36 h – sa 72 h ≈ 1,5× upisa); Fabric UDF host seče na 240 s, pa klijent čeka 250 s.
 */

const FUNCTION_TIMEOUT_MS = 240_000;
/** Osigurač protiv beskonačne petlje kad kursor ne napreduje. */
const MAX_PAGES = 500;
/** Koliko najnovijih uspešnih sinhronizacija se čita da bi se preskočili neispravni redovi. */
const LATEST_OK_LOOKUP = 10;

const STATION_FIELDS = [
  'id',
  'sepaId',
  'code',
  'name',
  'municipality',
  'latitude',
  'longitude',
  'active',
  'lastObservationAt',
  'updatedAt',
] as const;

const SNAPSHOT_FIELDS = [
  'id',
  'station_id',
  'observedAt',
  'category',
  'dominant',
  'valuesJson',
  'seriesJson',
  'updatedAt',
] as const;

const DAILY_FIELDS = [
  'id',
  'station_id',
  'parameter',
  'day',
  'avgValue',
  'maxValue',
  'minValue',
  'maxHour',
  'hours',
  'categoryMax',
  'updatedAt',
] as const;

const SYNC_RUN_FIELDS = [
  'id',
  'kind',
  'status',
  'startedAt',
  'finishedAt',
  'windowFrom',
  'windowTo',
  'stationsSeen',
  'observationsSeen',
  'rowsWritten',
  'message',
] as const;

interface Page<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor?: string;
}

/**
 * Petlja kroz strane: isti select/where/orderBy, menja se samo `after`. `stopAfter` (nad
 * stranom) prekida dalje čitanje – za upite sortirane opadajuće po danu, čim strana pređe
 * ispod traženog dana. Fabric GraphQL (Data API Builder) nad tekstualnim poljima prima samo
 * `eq`/`neq`/`contains`/…; `gte` na `day` backend odbija („input object field gte does not
 * exist“), pa se opseg dana dobija sortiranjem i ranim zaustavljanjem umesto filterom.
 */
async function fetchAllPages<T>(
  runPage: (cursor: string | undefined) => Promise<Page<T>>,
  stopAfter?: (page: T[]) => boolean,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await runPage(cursor);
    all.push(...page.items);
    if (stopAfter?.(page.items)) break;
    const next = page.hasNextPage ? page.endCursor : undefined;
    // Napreduje samo kad postoji sledeća strana I nov kursor; inače staje.
    cursor = next && next !== cursor ? next : undefined;
    pages++;
  } while (cursor && pages < MAX_PAGES);
  return all;
}

/** Strana sortirana po `day desc` je „gotova“ čim njen poslednji red padne ispod `fromDay`. */
function pastFromDay(fromDay: string) {
  return (page: DailyStat[]) => page.length > 0 && page[page.length - 1].day < fromDay;
}

/** Zadržava dane od `fromDay` (uključivo) i vraća ih rastuće, kako pozivaoci očekuju. */
function fromDayAscending(rows: DailyStat[], fromDay: string): DailyStat[] {
  return rows.filter((row) => row.day >= fromDay).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Rayfin SDK u browseru (nema `process.env`, pa je zastava `cli-minor-fixes` isključena) pri
 * čitanju „njuši“ vrednosti: svaki tekst oblika `YYYY-MM-DD` pretvara u `Date`
 * (`new Date('2026-10-07')`, UTC ponoć) – i `day` iz `DailyStat`, iako je kolona `@text`. Sa
 * `Date` umesto teksta poređenja dana daju `false`, a ključevi u mapama ne pogađaju nijedan dan
 * (Sinhronizacija „0/30 dana“, Trendovi „Još nema dnevne statistike“, bez ikakve greške –
 * potvrđeno u Fabric-u 8. 10. 2026). Zato se dan vraća u tekst odmah po čitanju strane, pre
 * ranog zaustavljanja i filtriranja. Rez po UTC je tačan jer je SDK `Date` napravio iz datuma
 * bez vremena (UTC ponoć); tekst se samo seče na 10 znakova.
 */
function dayKey(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}

function withDayKey(row: DailyStat): DailyStat {
  return { ...row, day: dayKey(row.day) };
}

/** Strana dnevne statistike sa danom vraćenim u tekst (vidi `dayKey`). */
async function dailyPage(query: { executePaginated(): Promise<Page<DailyStat>> }): Promise<Page<DailyStat>> {
  const page = await query.executePaginated();
  return { ...page, items: page.items.map(withDayKey) };
}

function toStationRecord(row: Station): StationRecord {
  return {
    id: row.id,
    sepaId: Number(row.sepaId),
    code: row.code,
    name: row.name,
    municipality: row.municipality ?? null,
    latitude: typeof row.latitude === 'number' ? row.latitude : row.latitude == null ? null : Number(row.latitude),
    longitude: typeof row.longitude === 'number' ? row.longitude : row.longitude == null ? null : Number(row.longitude),
    active: Boolean(row.active),
    lastObservationAt: row.lastObservationAt ?? null,
    updatedAt: row.updatedAt,
  };
}

function toSnapshotRecord(row: StationSnapshot): StationSnapshotRecord {
  return {
    id: row.id,
    station_id: row.station_id,
    observedAt: row.observedAt,
    category: Number(row.category),
    dominant: row.dominant,
    valuesJson: row.valuesJson,
    seriesJson: row.seriesJson,
    updatedAt: row.updatedAt,
  };
}

function toDailyStatRecord(row: DailyStat): DailyStatRecord {
  return {
    id: row.id,
    station_id: row.station_id,
    parameter: row.parameter,
    day: row.day,
    avgValue: Number(row.avgValue),
    maxValue: Number(row.maxValue),
    minValue: Number(row.minValue),
    maxHour: Number(row.maxHour),
    hours: Number(row.hours),
    categoryMax: Number(row.categoryMax),
    updatedAt: row.updatedAt,
  };
}

function toSyncRunRecord(row: SyncRun): SyncRunRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    windowFrom: row.windowFrom,
    windowTo: row.windowTo,
    stationsSeen: Number(row.stationsSeen ?? 0),
    observationsSeen: Number(row.observationsSeen ?? 0),
    rowsWritten: Number(row.rowsWritten ?? 0),
    message: row.message ?? null,
  };
}

export class RayfinDataService implements DataService {
  readonly mode = 'rayfin' as const;

  constructor(private readonly client: VazduhClient) {}

  async listStations(): Promise<StationRecord[]> {
    const rows = await this.client.data.Station.select(STATION_FIELDS)
      .orderBy({ name: 'asc' })
      .first(SINGLE_PAGE)
      .execute();
    return rows.map(toStationRecord);
  }

  async listSnapshots(): Promise<StationSnapshotRecord[]> {
    const rows = await this.client.data.StationSnapshot.select(SNAPSHOT_FIELDS)
      .orderBy({ observedAt: 'desc' })
      .first(SINGLE_PAGE)
      .execute();
    return rows.map(toSnapshotRecord);
  }

  async listDailyStats(stationId: string, fromDay: string): Promise<DailyStatRecord[]> {
    const rows = await fetchAllPages<DailyStat>((cursor) => {
      let query = this.client.data.DailyStat.select(DAILY_FIELDS)
        .where({ station_id: { eq: stationId } })
        .orderBy({ day: 'desc' })
        .first(PAGE_SIZE);
      if (cursor) query = query.after(cursor);
      return dailyPage(query);
    }, pastFromDay(fromDay));
    return fromDayAscending(rows, fromDay).map(toDailyStatRecord);
  }

  async listNetworkDailyStats(fromDay: string): Promise<DailyStatRecord[]> {
    const rows = await fetchAllPages<DailyStat>((cursor) => {
      let query = this.client.data.DailyStat.select(DAILY_FIELDS)
        .orderBy({ day: 'desc' })
        .first(NETWORK_PAGE_SIZE);
      if (cursor) query = query.after(cursor);
      return dailyPage(query);
    }, pastFromDay(fromDay));
    return fromDayAscending(rows, fromDay).map(toDailyStatRecord);
  }

  async listSyncRuns(limit: number): Promise<SyncRunRecord[]> {
    const rows = await this.client.data.SyncRun.select(SYNC_RUN_FIELDS)
      .orderBy({ startedAt: 'desc' })
      .first(Math.max(1, Math.min(limit, SINGLE_PAGE)))
      .execute();
    return rows.map(toSyncRunRecord);
  }

  async latestSuccessfulSync(): Promise<SyncRunRecord | null> {
    // Nekoliko najnovijih, pa prvi ispravan: red sa početkom u budućnosti (ručno upisan)
    // je uvek prvi po `startedAt desc` i ne sme zauvek da „osveži“ prikaz (vidi `isRunInvalid`).
    const rows = await this.client.data.SyncRun.select(SYNC_RUN_FIELDS)
      .where({ kind: { eq: 'sync' }, status: { eq: 'ok' } })
      .orderBy({ startedAt: 'desc' })
      .first(LATEST_OK_LOOKUP)
      .execute();
    const now = new Date();
    return rows.map(toSyncRunRecord).find((run) => !isRunInvalid(run, now)) ?? null;
  }

  async runSync(hoursBack: number): Promise<SyncResult> {
    return this.client.functions.syncAirQuality.invoke({ hoursBack }, { timeoutMs: FUNCTION_TIMEOUT_MS });
  }

  async runBackfill(day: string): Promise<BackfillResult> {
    return this.client.functions.backfillDay.invoke({ day }, { timeoutMs: FUNCTION_TIMEOUT_MS });
  }
}
