/**
 * Orkestracija sinhronizacije: SEPA/Kosava API → Fabric SQL baza aplikacije.
 *
 * `runSync`      — osvežava stanice, snimke trenutnog stanja i dnevnu statistiku
 *                  za poslednjih N sati (podrazumevano 36). Početak prozora se vraća
 *                  na lokalnu ponoć, pa se potpuni dani nikad ne prepisuju delimičnim.
 * `runBackfill`  — računa dnevnu statistiku za jedan lokalni dan iz prošlosti
 *                  (API čuva 30 dana), po jedan dan po pozivu zbog limita od 240 s.
 *
 * Vremenski budžet: Fabric host prekida funkciju na 250 s. Preuzimanje nove stanice ne
 * počinje posle `FETCH_START_CUTOFF_MS`, a zahtevi u toku se prekidaju na `FETCH_DEADLINE_MS`;
 * upisuje se ono što je preuzeto, a posao se zatvara kao `ok` sa upozorenjem
 * „N stanica preskočeno – vremenski limit“ (frontend ga prikazuje kao „Delimično“).
 * `runSync` odbija da počne dok druga sinhronizacija trenutnog stanja radi (`running` red
 * mlađi od 5 min) – vraća `ok: false` sa „Sinhronizacija je već u toku“.
 * Dnevna statistika prošlog dana se ne prepisuje redom sa manje sati (rub zadržavanja API-ja).
 *
 * Pristup bazi ide kroz `ctx.getDataClient()`, dakle sa identitetom korisnika
 * koji je pozvao funkciju; entiteti dozvoljavaju read/create/update prijavljenim
 * korisnicima. Ništa se ne briše: stanice koje nestanu iz API-ja se samo deaktiviraju.
 *
 * Trošak upisa: SDK-ov `upsert` je `findById` + `create`/`update`, tj. 2 zahteva po
 * redu (uz nekadašnji zaseban `Station.update` za `lastObservationAt` i 3). Ovde se
 * postojanje redova proverava jednim upitom po paketu od ≤100 id-ova
 * (`where({ id: { in } })`), pa sledi tačno jedna mutacija po redu, a
 * `lastObservationAt` ulazi u isti upis stanice. Za 36 h i ~60 stanica × 5 polutanata:
 * ~10 upita + ~60 + ~60 + ~600–900 mutacija ≈ 750–1050 zahteva (ranije ~2.100).
 */
import { randomUUID } from 'node:crypto';

import type { RayfinContext } from '@microsoft/fabric-user-data-functions';

import type { VazduhSchema } from '../../data/schema.js';
import { dailyStatId, snapshotId, stationId } from './ids.js';
import { fetchAllObservations, fetchStations, mapLimit, type FetchAllOptions } from './kosavaClient.js';
import { computeDailyStats, computeSnapshot, type SnapshotInput } from './shared/aggregate.js';
import type { BackfillResult, SyncResult } from './shared/contracts.js';
import type { KosavaObservation, KosavaStation } from './shared/kosava.js';
import { deadlineWarning, stationWarning, SYNC_ALREADY_RUNNING } from './shared/syncNotes.js';
import { addDays, dayUtcRange, isValidDay, localDay, todayLocal } from './shared/time.js';

type Ctx = RayfinContext<VazduhSchema>;
type DataClient = ReturnType<Ctx['getDataClient']>;

const WRITE_CONCURRENCY = 8;
const DEFAULT_HOURS_BACK = 36;
const MIN_HOURS_BACK = 3;
const MAX_HOURS_BACK = 168;
/** Kosava API čuva 30 dana unazad. */
const RETENTION_DAYS = 30;
/** Najviše id-ova u jednom `in` filteru: jedna strana GraphQL API-ja je 100 redova. */
const LOOKUP_CHUNK = 100;
/** Gornja granica za jednostrani upit nad stanicama (mreža ima ~60 stanica). */
const STATION_PAGE = 1000;
/** `SyncRun.message` je `@text({ max: 1000 })`; ostavljamo rezervu za višebajtne znakove. */
const MESSAGE_MAX = 900;
/** Posle ovoliko ms od početka posla ne počinje preuzimanje nijedne nove stanice. */
const FETCH_START_CUTOFF_MS = 120_000;
/** Zahtevi ka izvoru u toku se prekidaju na ovom roku: upisima ostaje ~70 s do limita od 250 s. */
const FETCH_DEADLINE_MS = 180_000;
/** `running` sinhronizacija mlađa od ovoga je posao u toku (isto kao RUNNING_GRACE_MINUTES u frontendu). */
const RUNNING_GRACE_MS = 5 * 60_000;
/** Red koji počinje toliko u budućnosti je neispravan (ručno upisan) i ne blokira sinhronizaciju. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Koliko najnovijih `running` redova se proverava pre početka sinhronizacije. */
const RUNNING_LOOKUP = 20;

/**
 * Opcije za testove i budžet: klijent Kosava API-ja + paralelnost i rokovi (ms od početka).
 * Fabric funkcije ih ne prosleđuju – važe podrazumevane vrednosti.
 */
export interface SyncOptions extends Omit<FetchAllOptions, 'deadline' | 'startBy'> {
  fetchStartCutoffMs?: number;
  fetchDeadlineMs?: number;
}

const log = (message: string) => console.log(`[vazduh] ${message}`);

function truncate(text: string): string {
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;
}

function errorText(error: unknown): string {
  return truncate(error instanceof Error ? error.message : String(error));
}

/** Prvih 5 upozorenja za `SyncRun.message` (svako nosi URL, pa se i spoj skraćuje). */
function warningsText(warnings: readonly string[]): string | undefined {
  return warnings.length ? truncate(warnings.slice(0, 5).join(' | ')) : undefined;
}

async function createRun(
  data: DataClient,
  kind: 'sync' | 'backfill',
  windowFrom: Date,
  windowTo: Date,
): Promise<string> {
  const run = await data.SyncRun.create({
    id: randomUUID(),
    kind,
    status: 'running',
    startedAt: new Date(),
    windowFrom,
    windowTo,
    stationsSeen: 0,
    observationsSeen: 0,
    rowsWritten: 0,
  });
  return run.id;
}

async function finishRun(
  data: DataClient,
  id: string,
  patch: {
    status: 'ok' | 'error';
    stationsSeen: number;
    observationsSeen: number;
    rowsWritten: number;
    message?: string;
  },
): Promise<void> {
  try {
    await data.SyncRun.update({ id }, { ...patch, finishedAt: new Date() });
  } catch (error) {
    log(`Nije uspelo zatvaranje SyncRun ${id}: ${errorText(error)}`);
  }
}

/** Upit koji za zadate id-ove vraća postojeće redove (`select(['id', …]).where({ id: { in } })`). */
type IdLookup<R extends { id: string }> = (ids: string[]) => Promise<R[]>;

/** Redovi koji već postoje u bazi: jedan upit po paketu od `LOOKUP_CHUNK` id-ova. */
async function existingRows<R extends { id: string }>(ids: readonly string[], lookup: IdLookup<R>): Promise<Map<string, R>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) chunks.push(ids.slice(i, i + LOOKUP_CHUNK));
  const found = new Map<string, R>();
  await mapLimit(chunks, WRITE_CONCURRENCY, async (chunk) => {
    for (const row of await lookup(chunk)) found.set(row.id, row);
  });
  return found;
}

interface RowWriter<F, R extends { id: string } = { id: string }> {
  lookup: IdLookup<R>;
  create(id: string, fields: F): Promise<unknown>;
  update(id: string, fields: F): Promise<unknown>;
  /** Postojeći red je bolji od novog – ne prepisuje se (npr. dan sa više sati merenja). */
  keep?(existing: R, fields: F): boolean;
}

/**
 * Upisuje redove sa determinističkim id-om: jedna provera postojanja po paketu, zatim
 * `create` za nove i `update` za postojeće (umesto SDK-ovog `upsert`-a sa 2 zahteva po redu).
 * Ako `create` padne — tipično duplikat id-a jer je paralelna sinhronizacija u međuvremenu
 * upisala isti red — pokušava se `update`; ako i on padne, prijavljuje se prvobitna greška.
 */
async function writeRows<F, R extends { id: string }>(
  rows: ReadonlyArray<{ id: string; fields: F }>,
  writer: RowWriter<F, R>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let existing: Map<string, R>;
  try {
    existing = await existingRows(rows.map((row) => row.id), writer.lookup);
  } catch (error) {
    // Ako provera postojanja padne (npr. backend ne podrži filter `in`), svaki red ide kroz
    // create → update, što košta koliko i SDK-ov upsert, ali sinhronizacija ne staje.
    log(`Provera postojanja nije uspela, prelazim na create/update po redu: ${errorText(error)}`);
    existing = new Map();
  }
  let written = 0;
  let kept = 0;
  await mapLimit(rows, WRITE_CONCURRENCY, async ({ id, fields }) => {
    const current = existing.get(id);
    if (current && writer.keep?.(current, fields)) {
      kept++;
      return;
    }
    if (current) {
      await writer.update(id, fields);
    } else {
      try {
        await writer.create(id, fields);
      } catch (error) {
        try {
          await writer.update(id, fields);
        } catch {
          throw error;
        }
      }
    }
    written++;
  });
  if (kept) log(`Zadržano postojećih redova sa više podataka: ${kept}`);
  return written;
}

/** Snimak trenutnog stanja po `sepaId` za stanice koje imaju merenja u prozoru. */
function computeSnapshots(
  stations: readonly KosavaStation[],
  observations: readonly KosavaObservation[],
): Map<number, SnapshotInput> {
  const byStation = new Map<number, KosavaObservation[]>();
  for (const obs of observations) {
    const list = byStation.get(obs.sepaId) ?? [];
    list.push(obs);
    byStation.set(obs.sepaId, list);
  }
  const snapshots = new Map<number, SnapshotInput>();
  for (const station of stations) {
    const snapshot = computeSnapshot(byStation.get(station.sepaId) ?? []);
    if (snapshot) snapshots.set(station.sepaId, snapshot);
  }
  return snapshots;
}

/**
 * Upis stanica; `lastObservationAt` dolazi iz snimka i ulazi u isti red (bez zasebnog
 * `update`-a). Stanica bez snimka u prozoru zadržava stari `lastObservationAt`.
 */
async function upsertStations(
  data: DataClient,
  stations: readonly KosavaStation[],
  now: Date,
  snapshots: ReadonlyMap<number, SnapshotInput> = new Map(),
): Promise<number> {
  const rows = stations.map((station) => {
    const snapshot = snapshots.get(station.sepaId);
    return {
      id: stationId(station.sepaId),
      fields: {
        sepaId: station.sepaId,
        code: station.code,
        name: station.name,
        municipality: station.municipality ?? undefined,
        latitude: station.latitude ?? undefined,
        longitude: station.longitude ?? undefined,
        active: station.active,
        ...(snapshot ? { lastObservationAt: new Date(snapshot.observedAt) } : {}),
        updatedAt: now,
      },
    };
  });
  return writeRows(rows, {
    lookup: (ids) => data.Station.select(['id']).where({ id: { in: ids } }).first(ids.length).execute(),
    create: (id, fields) => data.Station.create({ id, ...fields }),
    update: (id, fields) => data.Station.update({ id }, fields),
  });
}

/**
 * Stanice koje su u bazi aktivne, a `/stations?active=true` ih više ne vraća, dobijaju
 * `active = false` (snimak ostaje, frontend ga ne računa). Ako se stanica ponovo pojavi,
 * sledeći upis stanica je vraća na `active = true`.
 */
async function deactivateMissingStations(
  data: DataClient,
  stations: readonly KosavaStation[],
  now: Date,
): Promise<number> {
  const fetched = new Set(stations.map((station) => stationId(station.sepaId)));
  const active = await data.Station.select(['id']).where({ active: { eq: true } }).first(STATION_PAGE).execute();
  const missing = active.map((row) => row.id).filter((id) => !fetched.has(id));
  await mapLimit(missing, WRITE_CONCURRENCY, (id) => data.Station.update({ id }, { active: false, updatedAt: now }));
  if (missing.length) log(`Deaktivirano stanica kojih više nema u API-ju: ${missing.length}`);
  return missing.length;
}

async function upsertSnapshots(
  data: DataClient,
  snapshots: ReadonlyMap<number, SnapshotInput>,
  now: Date,
): Promise<number> {
  const rows = [...snapshots.values()].map((snapshot) => ({
    id: snapshotId(snapshot.sepaId),
    fields: {
      station_id: stationId(snapshot.sepaId),
      observedAt: new Date(snapshot.observedAt),
      category: snapshot.category,
      dominant: snapshot.dominant,
      valuesJson: JSON.stringify(snapshot.values),
      seriesJson: JSON.stringify(snapshot.series),
      updatedAt: now,
    },
  }));
  return writeRows(rows, {
    lookup: (ids) => data.StationSnapshot.select(['id']).where({ id: { in: ids } }).first(ids.length).execute(),
    create: (id, fields) => data.StationSnapshot.create({ id, ...fields }),
    update: (id, fields) => data.StationSnapshot.update({ id }, fields),
  });
}

/**
 * Dnevna statistika za zadate dane. Prošli dan koji u bazi ima VIŠE sati merenja nego nova
 * statistika se ne prepisuje: na rubu zadržavanja API-ja (30 dana) izvor vraća samo deo
 * dana, pa bi ponovno učitavanje zamenilo potpun dan delimičnim. Današnji dan se uvek piše.
 */
async function upsertDailyStats(
  data: DataClient,
  observations: KosavaObservation[],
  days: Iterable<string>,
  now: Date,
): Promise<number> {
  const today = todayLocal(now);
  const rows = computeDailyStats(observations, days).map((stat) => ({
    id: dailyStatId(stat.sepaId, stat.parameter, stat.day),
    fields: {
      station_id: stationId(stat.sepaId),
      parameter: stat.parameter,
      day: stat.day,
      avgValue: stat.avgValue,
      maxValue: stat.maxValue,
      minValue: stat.minValue,
      maxHour: stat.maxHour,
      hours: stat.hours,
      categoryMax: stat.categoryMax,
      updatedAt: now,
    },
  }));
  return writeRows(rows, {
    lookup: (ids) => data.DailyStat.select(['id', 'hours']).where({ id: { in: ids } }).first(ids.length).execute(),
    create: (id, fields) => data.DailyStat.create({ id, ...fields }),
    update: (id, fields) => data.DailyStat.update({ id }, fields),
    keep: (existing, fields) => fields.day < today && Number(existing.hours) > fields.hours,
  });
}

/**
 * Sinhronizacija trenutnog stanja koja upravo radi (`running`, mlađa od 5 min, ne iz
 * budućnosti) ili null. Ako provera ne uspe, sinhronizacija ipak ide (paralelni poslovi su
 * idempotentni – koštaju kapacitet, ali ne kvare podatke).
 */
async function runningSync(data: DataClient, now: Date): Promise<{ id: string; startedAt: Date } | null> {
  try {
    const rows = await data.SyncRun.select(['id', 'startedAt'])
      .where({ kind: { eq: 'sync' }, status: { eq: 'running' } })
      .orderBy({ startedAt: 'desc' })
      .first(RUNNING_LOOKUP)
      .execute();
    for (const row of rows) {
      const startedAt = new Date(row.startedAt);
      const age = now.getTime() - startedAt.getTime();
      if (Number.isFinite(age) && age < RUNNING_GRACE_MS && age > -FUTURE_TOLERANCE_MS) return { id: row.id, startedAt };
    }
    return null;
  } catch (error) {
    log(`Provera sinhronizacije u toku nije uspela, nastavljam: ${errorText(error)}`);
    return null;
  }
}

/** Upozorenja preuzimanja: prvo vremenski limit (preživi skraćivanje poruke), pa stanice. */
function batchWarnings(batch: { failures: Array<{ sepaId: number; error: string }>; skipped: number[] }): string[] {
  const warnings: string[] = [];
  if (batch.skipped.length) warnings.push(deadlineWarning(batch.skipped.length));
  for (const failure of batch.failures) warnings.push(stationWarning(failure.sepaId, failure.error));
  return warnings;
}

/** Rokovi preuzimanja za posao koji je počeo u `started` (epoch ms). */
function fetchBudget(started: number, options: SyncOptions): FetchAllOptions {
  const { fetchStartCutoffMs = FETCH_START_CUTOFF_MS, fetchDeadlineMs = FETCH_DEADLINE_MS, ...rest } = options;
  return { log, ...rest, startBy: started + fetchStartCutoffMs, deadline: started + fetchDeadlineMs };
}

export async function runSync(
  ctx: Ctx,
  hoursBackInput: number,
  clientOptions: SyncOptions = {},
): Promise<SyncResult> {
  const started = Date.now();
  const hoursBack = Number.isFinite(hoursBackInput)
    ? Math.min(MAX_HOURS_BACK, Math.max(MIN_HOURS_BACK, Math.round(hoursBackInput)))
    : DEFAULT_HOURS_BACK;
  const now = new Date();
  const to = now;
  // Početak prozora se vraća na lokalnu ponoć (Europe/Belgrade) svog dana, pa je svaki
  // dodirnuti dan osim današnjeg pokriven od 00:00 i dnevna statistika potpunih dana se
  // nikad ne prepisuje delimičnom. Stvarni prozor je zato najviše hoursBack + 24 h.
  const rawFrom = new Date(now.getTime() - hoursBack * 3_600_000);
  const from = dayUtcRange(localDay(rawFrom)).from; // prozor uvek počinje u lokalnu ponoć
  const data = ctx.getDataClient();
  const warnings: string[] = [];
  const options = fetchBudget(started, clientOptions);

  // Jedna sinhronizacija u isto vreme: druga sesija koja upravo radi isti posao ima prednost.
  const busy = await runningSync(data, now);
  if (busy) {
    const minutes = Math.max(0, Math.round((now.getTime() - busy.startedAt.getTime()) / 60_000));
    const error = `${SYNC_ALREADY_RUNNING} (pokrenuta ${minutes < 1 ? 'upravo' : `pre ${minutes} min`} u drugoj sesiji).`;
    log(error);
    return {
      ok: false,
      syncRunId: '',
      from: from.toISOString(),
      to: to.toISOString(),
      stationsSeen: 0,
      stationsWritten: 0,
      observationsSeen: 0,
      snapshotsWritten: 0,
      dailyStatsWritten: 0,
      durationMs: Date.now() - started,
      warnings,
      error,
    };
  }

  const syncRunId = await createRun(data, 'sync', from, to);
  const base: Omit<SyncResult, 'ok' | 'durationMs' | 'error'> = {
    syncRunId,
    from: from.toISOString(),
    to: to.toISOString(),
    stationsSeen: 0,
    stationsWritten: 0,
    observationsSeen: 0,
    snapshotsWritten: 0,
    dailyStatsWritten: 0,
    warnings,
  };

  try {
    log(`Sinhronizacija ${hoursBack} h od lokalne ponoći: ${from.toISOString()} → ${to.toISOString()}`);
    const stations = (await fetchStations(options)).filter((s) => s.active);
    base.stationsSeen = stations.length;
    if (stations.length === 0) throw new Error('Kosava API nije vratio nijednu aktivnu stanicu.');

    const batch = await fetchAllObservations(stations, from, to, options);
    base.observationsSeen = batch.observations.length;
    warnings.push(...batchWarnings(batch));
    if (batch.skipped.length) log(`Vremenski limit: preskočeno stanica ${batch.skipped.length}, upisujem preuzeto.`);

    // Snimci se računaju pre upisa stanica da bi `lastObservationAt` ušao u isti red.
    const snapshots = computeSnapshots(stations, batch.observations);
    base.stationsWritten = await upsertStations(data, stations, now, snapshots);
    // Deaktivirane stanice su takođe upisani redovi tabele Station.
    base.stationsWritten += await deactivateMissingStations(data, stations, now);

    if (batch.observations.length === 0) {
      throw new Error('Nema satnih merenja u zadatom prozoru (API možda kasni ili je nedostupan).');
    }

    base.snapshotsWritten = await upsertSnapshots(data, snapshots, now);

    // Dnevna statistika za sve lokalne dane koje merenja dodiruju; pošto prozor počinje u
    // lokalnu ponoć, svaki od njih osim današnjeg je pokriven u celosti.
    const touchedDays = new Set(batch.observations.map((o) => localDay(o.timeStartUtc)));
    base.dailyStatsWritten = await upsertDailyStats(data, batch.observations, touchedDays, now);

    const rowsWritten = base.stationsWritten + base.snapshotsWritten + base.dailyStatsWritten;
    await finishRun(data, syncRunId, {
      status: 'ok',
      stationsSeen: base.stationsSeen,
      observationsSeen: base.observationsSeen,
      rowsWritten,
      message: warningsText(warnings),
    });
    log(`Gotovo za ${Date.now() - started} ms: ${rowsWritten} redova.`);
    return { ok: true, ...base, durationMs: Date.now() - started };
  } catch (error) {
    const message = errorText(error);
    log(`Greška: ${message}`);
    await finishRun(data, syncRunId, {
      status: 'error',
      stationsSeen: base.stationsSeen,
      observationsSeen: base.observationsSeen,
      rowsWritten: base.stationsWritten + base.snapshotsWritten + base.dailyStatsWritten,
      message,
    });
    return { ok: false, ...base, durationMs: Date.now() - started, error: message };
  }
}

export async function runBackfill(
  ctx: Ctx,
  dayInput: string,
  clientOptions: SyncOptions = {},
): Promise<BackfillResult> {
  const started = Date.now();
  const day = String(dayInput ?? '').trim();
  const warnings: string[] = [];
  const data = ctx.getDataClient();
  const options = fetchBudget(started, clientOptions);
  const today = todayLocal();

  const invalid =
    !isValidDay(day)
      ? `Neispravan dan „${day}“ (očekuje se YYYY-MM-DD).`
      : day > today
        ? 'Dan je u budućnosti.'
        : day < addDays(today, -RETENTION_DAYS)
          ? `Kosava API čuva samo poslednjih ${RETENTION_DAYS} dana.`
          : null;
  if (invalid) {
    return {
      ok: false,
      syncRunId: '',
      day,
      stationsSeen: 0,
      observationsSeen: 0,
      dailyStatsWritten: 0,
      durationMs: Date.now() - started,
      warnings,
      error: invalid,
    };
  }

  const { from, to } = dayUtcRange(day);
  const syncRunId = await createRun(data, 'backfill', from, to);
  let stationsSeen = 0;
  let observationsSeen = 0;
  let dailyStatsWritten = 0;
  try {
    const now = new Date();
    const stations = (await fetchStations(options)).filter((s) => s.active);
    stationsSeen = stations.length;
    if (stations.length === 0) throw new Error('Kosava API nije vratio nijednu aktivnu stanicu.');
    await upsertStations(data, stations, now);

    const batch = await fetchAllObservations(stations, from, to, options);
    observationsSeen = batch.observations.length;
    warnings.push(...batchWarnings(batch));
    dailyStatsWritten = await upsertDailyStats(data, batch.observations, [day], now);

    await finishRun(data, syncRunId, {
      status: 'ok',
      stationsSeen,
      observationsSeen,
      rowsWritten: dailyStatsWritten,
      message: warningsText(warnings) ?? `Dan ${day}`,
    });
    return { ok: true, syncRunId, day, stationsSeen, observationsSeen, dailyStatsWritten, durationMs: Date.now() - started, warnings };
  } catch (error) {
    const message = errorText(error);
    log(`Greška (backfill ${day}): ${message}`);
    await finishRun(data, syncRunId, { status: 'error', stationsSeen, observationsSeen, rowsWritten: dailyStatsWritten, message });
    return { ok: false, syncRunId, day, stationsSeen, observationsSeen, dailyStatsWritten, durationMs: Date.now() - started, warnings, error: message };
  }
}
