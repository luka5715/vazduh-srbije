/**
 * Orkestracija sinhronizacije: SEPA/Kosava API → Fabric SQL baza aplikacije.
 *
 * `runSync`      — osvežava stanice, snimke trenutnog stanja i dnevnu statistiku
 *                  za poslednjih N sati (podrazumevano 72: rupa preko vikenda, petak 18:00 →
 *                  ponedeljak 08:00 = 62 h, zatvara se sama). Početak prozora se vraća
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
 * postojanje redova čita unapred (sve stanice i snimci jednim upitom, DailyStat jednim
 * upitom po danu, samo filter `eq`), pa sledi tačno jedna mutacija po redu, a
 * `lastObservationAt` ulazi u isti upis stanice. Za 72 h (3–4 lokalna dana) i ~87 stanica × do
 * 5 polutanata: ~12 upita + ~87 + ~87 + ~1.300–1.750 mutacija ≈ 1.500–1.950 zahteva
 * (izmereno 8. 10. 2026. sa prozorom od 36 h: 1.303 reda za ~12 s; 72 h ≈ 1,5× upisa).
 *
 * Upis koji padne na prolaznoj grešci (429, 5xx, mreža) ponavlja se jednom posle
 * `WRITE_RETRY_DELAY_MS`; ako padne i drugi put, red se preskače, a posao se zatvara kao `ok`
 * sa upozorenjem „N redova nije upisano u bazu“ (frontend: „Delimično“). Ako baza nije primila
 * nijedan red, ili je neupisanih više nego upisanih, posao je `error` („Baza nije prihvatila
 * upise: …“, `assertWritesAccepted`) – ispad baze se ne sme prikazati kao uspešna sinhronizacija.
 * Ostale greške upisa (npr. odbijen ulaz, programska `TypeError`) i dalje obaraju posao u `error`.
 */
import { randomUUID } from 'node:crypto';

import type { RayfinContext } from '@microsoft/fabric-user-data-functions';

import type { VazduhSchema } from '../../data/schema.js';
import { dailyStatId, snapshotId, stationId } from './ids.js';
import { fetchAllObservations, fetchStations, mapLimit, type FetchAllOptions } from './kosavaClient.js';
import { computeDailyStats, computeSnapshot, type SnapshotInput } from './shared/aggregate.js';
import type { BackfillResult, SyncResult } from './shared/contracts.js';
import type { KosavaObservation, KosavaStation } from './shared/kosava.js';
import { deadlineWarning, stationWarning, SYNC_ALREADY_RUNNING, unwrittenRowsWarning } from './shared/syncNotes.js';
import { addDays, dayUtcRange, isValidDay, localDay, todayLocal } from './shared/time.js';

type Ctx = RayfinContext<VazduhSchema>;
type DataClient = ReturnType<Ctx['getDataClient']>;

const WRITE_CONCURRENCY = 8;
/**
 * Podrazumevani prozor sinhronizacije. 72 h (a ne 36) da bi se rupa preko vikenda – niko ne
 * otvara aplikaciju od petka 18:00 do ponedeljka 08:00 (62 h) – sama zatvorila: početak se
 * vraća na lokalnu ponoć, pa petak postaje potpun dan umesto da ostane delimičan.
 * Isti broj je `SYNC_HOURS_BACK` u src/hooks/useSync.ts – menjaju se zajedno.
 */
const DEFAULT_HOURS_BACK = 72;
const MIN_HOURS_BACK = 3;
const MAX_HOURS_BACK = 168;
/** Kosava API čuva 30 dana unazad. */
const RETENTION_DAYS = 30;
/** Strana za čitanje postojećih DailyStat redova jednog dana (~5 polutanata × broj stanica). */
const DAY_PAGE = 5000;
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
 * Pauza pre jedinog ponovnog pokušaja upisa koji je pao na prolaznoj grešci (429, 5xx, mreža).
 * Jedna 429/5xx među ~1.300 mutacija inače obara ceo posao u `error` do sledeće sinhronizacije.
 */
const WRITE_RETRY_DELAY_MS = 500;

/**
 * Opcije za testove i budžet: klijent Kosava API-ja + paralelnost i rokovi (ms od početka).
 * Fabric funkcije ih ne prosleđuju – važe podrazumevane vrednosti.
 */
export interface SyncOptions extends Omit<FetchAllOptions, 'deadline' | 'startBy'> {
  fetchStartCutoffMs?: number;
  fetchDeadlineMs?: number;
  /** Pauza pre ponovnog pokušaja upisa (testovi je skraćuju); podrazumevano `WRITE_RETRY_DELAY_MS`. */
  writeRetryDelayMs?: number;
}

const log = (message: string) => console.log(`[vazduh] ${message}`);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** HTTP status sa greške upisa (`status`, `statusCode`, `response.status`, ugnežđeni `cause`). */
function httpStatusOf(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } | null; cause?: unknown };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return httpStatusOf(e.cause, depth + 1);
}

const TRANSIENT_MESSAGE =
  /\bHTTP(?: Error)? (?:429|5\d\d)\b|too many requests|service unavailable|bad gateway|gateway time-?out|internal server error|fetch failed|network error|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR/i;

/**
 * Prolazna greška upisa koju vredi ponoviti: HTTP 429 ili 5xx (po statusu na grešci – SDK ga
 * stavlja na `NetworkError.status` – ili po tekstu) i mrežne greške (undici `TypeError: fetch
 * failed`, `NetworkError` bez statusa, ECONNRESET …). Poznat status koji nije 429/5xx (400,
 * 404, 409 …) nije prolazan, kao ni GraphQL odbijanje ulaza. `TypeError` je prolazna samo sa
 * mrežnim tekstom („fetch failed“ …): programska `TypeError` („Cannot read properties of
 * undefined“) je greška u kodu i mora da obori posao, ne da se preskoči kao „prolazna greška baze“.
 */
export function isTransientWriteError(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status !== undefined) return status === 429 || status >= 500;
  if (error instanceof TypeError) return TRANSIENT_MESSAGE.test(error.message);
  if (error instanceof Error && error.name === 'NetworkError') return true;
  return TRANSIENT_MESSAGE.test(error instanceof Error ? error.message : String(error));
}

/**
 * Knjigovodstvo upisa jednog posla: koliko redova ni ponovni pokušaj nije upisao (postaju
 * upozorenje „N redova nije upisano u bazu“; posao ostaje `ok` dok je upisanih više nego
 * neupisanih – vidi `assertWritesAccepted`) i pauza pre ponovnog pokušaja.
 */
interface WriteTally {
  unwritten: number;
  retryDelayMs: number;
}

function newTally(options: SyncOptions): WriteTally {
  return { unwritten: 0, retryDelayMs: options.writeRetryDelayMs ?? WRITE_RETRY_DELAY_MS };
}

/**
 * Jedan upis sa najviše jednim ponovnim pokušajem: prolazna greška → pauza → isti upis ponovo;
 * drugi neuspeh (ma koji) se beleži u `tally.unwritten` i red se preskače. Greška koja nije
 * prolazna (odbijen ulaz, duplikat bez izlaza) se baca dalje i obara posao kao do sada.
 */
async function writeWithRetry(tally: WriteTally, id: string, attempt: () => Promise<unknown>): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch (error) {
    if (!isTransientWriteError(error)) throw error;
    log(`Upis ${id} pao na prolaznoj grešci (${errorText(error)}), ponovni pokušaj za ${tally.retryDelayMs} ms`);
    await sleep(tally.retryDelayMs);
    try {
      await attempt();
      return true;
    } catch (retryError) {
      tally.unwritten++;
      log(`Red ${id} nije upisan ni posle ponovnog pokušaja: ${errorText(retryError)}`);
      return false;
    }
  }
}

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

/**
 * Čita redove koji već postoje u bazi za zadate redove za upis. Namerno koristi samo filtere
 * `eq` i neograničen `first(n)`: Fabric GraphQL (Data API Builder) nad tekstualnim poljima ne
 * podržava `gte`/`lte`, a `in` nije proveren – oba bi srušila sinhronizaciju.
 */
type ExistingLookup<F, R extends { id: string }> = (rows: ReadonlyArray<{ id: string; fields: F }>) => Promise<R[]>;

interface RowWriter<F, R extends { id: string } = { id: string }> {
  lookup: ExistingLookup<F, R>;
  create(id: string, fields: F): Promise<unknown>;
  update(id: string, fields: F): Promise<unknown>;
  /** Postojeći red je bolji od novog – ne prepisuje se (npr. dan sa više sati merenja). */
  keep?(existing: R, fields: F): boolean;
}

/**
 * Upisuje redove sa determinističkim id-om: jedna provera postojanja po entitetu, zatim
 * `create` za nove i `update` za postojeće (umesto SDK-ovog `upsert`-a sa 2 zahteva po redu).
 * Ako `create` padne — tipično duplikat id-a jer je paralelna sinhronizacija u međuvremenu
 * upisala isti red — pokušava se `update`; ako i on padne, prijavljuje se prvobitna greška.
 * Prolazna greška (429, 5xx, mreža) dobija jedan ponovni pokušaj (`writeWithRetry`).
 */
async function writeRows<F, R extends { id: string }>(
  rows: ReadonlyArray<{ id: string; fields: F }>,
  writer: RowWriter<F, R>,
  tally: WriteTally,
): Promise<number> {
  if (rows.length === 0) return 0;
  let existing: Map<string, R>;
  try {
    existing = new Map((await writer.lookup(rows)).map((row) => [row.id, row] as const));
  } catch (error) {
    // Ako provera postojanja padne (npr. backend odbije filter), svaki red ide kroz
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
    const attempt = current
      ? () => writer.update(id, fields)
      : async () => {
          try {
            await writer.create(id, fields);
          } catch (error) {
            try {
              await writer.update(id, fields);
            } catch {
              throw error;
            }
          }
        };
    if (await writeWithRetry(tally, id, attempt)) written++;
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
  tally: WriteTally,
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
  return writeRows(
    rows,
    {
      lookup: () => data.Station.select(['id']).first(STATION_PAGE).execute(),
      create: (id, fields) => data.Station.create({ id, ...fields }),
      update: (id, fields) => data.Station.update({ id }, fields),
    },
    tally,
  );
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
  tally: WriteTally,
): Promise<number> {
  const fetched = new Set(stations.map((station) => stationId(station.sepaId)));
  const active = await data.Station.select(['id']).where({ active: { eq: true } }).first(STATION_PAGE).execute();
  const missing = active.map((row) => row.id).filter((id) => !fetched.has(id));
  const written = await mapLimit(missing, WRITE_CONCURRENCY, (id) =>
    writeWithRetry(tally, id, () => data.Station.update({ id }, { active: false, updatedAt: now })),
  );
  if (missing.length) log(`Deaktivirano stanica kojih više nema u API-ju: ${missing.length}`);
  return written.filter(Boolean).length;
}

async function upsertSnapshots(
  data: DataClient,
  snapshots: ReadonlyMap<number, SnapshotInput>,
  now: Date,
  tally: WriteTally,
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
  return writeRows(
    rows,
    {
      lookup: () => data.StationSnapshot.select(['id']).first(STATION_PAGE).execute(),
      create: (id, fields) => data.StationSnapshot.create({ id, ...fields }),
      update: (id, fields) => data.StationSnapshot.update({ id }, fields),
    },
    tally,
  );
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
  tally: WriteTally,
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
  return writeRows(
    rows,
    {
      // Jedan upit po danu (`day eq`): dani iz prozora, rastuće, da redosled bude determinističan.
      lookup: async (pending) => {
        const days = [...new Set(pending.map((row) => row.fields.day))].sort();
        const found: Array<{ id: string; hours: number }> = [];
        for (const day of days) {
          found.push(...(await data.DailyStat.select(['id', 'hours']).where({ day: { eq: day } }).first(DAY_PAGE).execute()));
        }
        return found;
      },
      create: (id, fields) => data.DailyStat.create({ id, ...fields }),
      update: (id, fields) => data.DailyStat.update({ id }, fields),
      keep: (existing, fields) => fields.day < today && Number(existing.hours) > fields.hours,
    },
    tally,
  );
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

/**
 * Upozorenje o redovima koje ni ponovni pokušaj nije upisao ide odmah iza upozorenja o
 * vremenskom limitu (ako ga ima), a ispred upozorenja po stanicama – `SyncRun.message` nosi
 * samo prvih 5, pa zbirna upozorenja moraju da prežive skraćivanje.
 */
function addUnwrittenWarning(warnings: string[], tally: WriteTally): void {
  if (tally.unwritten === 0) return;
  const afterDeadline = warnings.length && !warnings[0].startsWith('Stanica ') ? 1 : 0;
  warnings.splice(afterDeadline, 0, unwrittenRowsWarning(tally.unwritten));
  log(`Redova koji nisu upisani ni posle ponovnog pokušaja: ${tally.unwritten}`);
}

/**
 * Posao u kome baza nije primila upise – nijedan red nije upisan, ili je neupisanih više nego
 * upisanih – nije `ok` sa upozorenjem nego greška. Inače bi frontend ispad baze prikazao kao
 * uspešnu sinhronizaciju („Osveženo pre 1 min“, pun merač svežine, automatsko osvežavanje čeka
 * 65 min), a prazninu u snimcima objasnio izvorom („SEPA kasni“) umesto bazom. Posao `error`
 * zadržava prethodnu uspešnu sinhronizaciju kao „poslednju“ i dnevnik ga prikazuje kao grešku.
 * Poziva se posle `addUnwrittenWarning`, pa upozorenje ostaje i u rezultatu (`warnings`).
 */
function assertWritesAccepted(tally: WriteTally, rowsWritten: number): void {
  if (tally.unwritten === 0) return;
  if (rowsWritten === 0 || tally.unwritten > rowsWritten) {
    throw new Error(`Baza nije prihvatila upise: ${unwrittenRowsWarning(tally.unwritten)}`);
  }
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
  const tally = newTally(clientOptions);

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
    base.stationsWritten = await upsertStations(data, stations, now, tally, snapshots);
    // Deaktivirane stanice su takođe upisani redovi tabele Station.
    base.stationsWritten += await deactivateMissingStations(data, stations, now, tally);

    if (batch.observations.length === 0) {
      throw new Error('Nema satnih merenja u zadatom prozoru (API možda kasni ili je nedostupan).');
    }

    base.snapshotsWritten = await upsertSnapshots(data, snapshots, now, tally);

    // Dnevna statistika za sve lokalne dane koje merenja dodiruju; pošto prozor počinje u
    // lokalnu ponoć, svaki od njih osim današnjeg je pokriven u celosti.
    const touchedDays = new Set(batch.observations.map((o) => localDay(o.timeStartUtc)));
    base.dailyStatsWritten = await upsertDailyStats(data, batch.observations, touchedDays, now, tally);

    // Redovi koje ni ponovni pokušaj nije upisao: posao je `ok` sa upozorenjem (frontend „Delimično“)
    // – osim kad baza nije primila (skoro) ništa: onda je posao greška (`assertWritesAccepted`).
    addUnwrittenWarning(warnings, tally);
    const rowsWritten = base.stationsWritten + base.snapshotsWritten + base.dailyStatsWritten;
    assertWritesAccepted(tally, rowsWritten);
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
  const tally = newTally(clientOptions);
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
    const stationsWritten = await upsertStations(data, stations, now, tally);

    const batch = await fetchAllObservations(stations, from, to, options);
    observationsSeen = batch.observations.length;
    warnings.push(...batchWarnings(batch));
    dailyStatsWritten = await upsertDailyStats(data, batch.observations, [day], now, tally);
    addUnwrittenWarning(warnings, tally);
    // `rowsWritten` posla ostaje broj dnevnih statistika; za pravilo o ispadu baze broje se i stanice.
    assertWritesAccepted(tally, stationsWritten + dailyStatsWritten);

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
