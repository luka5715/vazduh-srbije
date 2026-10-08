/**
 * Pravila o starosti sinhronizacija, zajednička za stranicu, ljusku i panel dnevnika:
 * ispravnost redova dnevnika, posao druge sesije, automatsko i ručno osvežavanje i
 * pokrivenost istorije (dnevna statistika poslednjih 30 dana).
 */

import type { DailyStatRecord, SyncRunRecord } from '@shared/contracts';
import { addDays } from '@shared/time';

import { minCoveredHours } from '@/lib/coverage';
import { formatInt, pluralSr } from '@/lib/format';

/** Posle ovoliko minuta bez uspešne sinhronizacije aplikacija je pokreće sama pri otvaranju. */
export const STALE_MINUTES = 65;

/**
 * PRETPOSTAVKE o objavljivanju SEPA – ponovo ih izmeriti na živoj stavci iz redova `SyncRun`
 * (`windowTo` sinhronizacije prema najnovijem `observedAt` koji je donela); iz ovog okruženja
 * se izvor ne može meriti. Živi uzorak (8. 10. 2026.): interval 00–01 h bio je dostupan u 01:28.
 *
 * `EXPECTED_LAG_MINUTES` – koliko posle kraja satnog intervala SEPA po očekivanju objavi taj sat.
 * Konzervativno 20 min: manja vrednost bi pokretala sinhronizacije koje ne donose ništa novo.
 */
export const EXPECTED_LAG_MINUTES = 20;
/**
 * `MIN_GAP_MINUTES` – najmanji razmak između dve automatske sinhronizacije kad pravilo o
 * objavljenom satu kaže „sinhronizuj“ (poslednja uspešna mora biti starija od ovoga). Štiti
 * izvor i kapacitet kad SEPA kasni satima: tada aplikacija sinhronizuje najviše jednom u 20 min
 * po otvorenoj kartici (tiho čitanje je na 12 min), umesto na svakih 65 min bez ovog pravila.
 * Kad SEPA objavljuje redovno, pravilo o sledećem satu pokreće ~1 sinhronizaciju po satu
 * (kraj sledećeg sata + 20 min), pa je ovaj razmak samo sigurnosna granica.
 */
export const MIN_GAP_MINUTES = 20;

/**
 * `running` red mlađi od ovoga znači da neko drugi upravo sinhronizuje. Stariji red je
 * napušten: Fabric host seče funkciju na 240 s, pa red koji nije zatvoren posle 5 min
 * nikad neće dobiti završetak.
 */
export const RUNNING_GRACE_MINUTES = 5;

/**
 * Red dnevnika čije je vreme (početak ili završetak) više od ovoliko minuta u budućnosti je
 * neispravan – ručno upisan preko GraphQL-a ili sa pogrešnim satom. Takav red ne sme da
 * blokira automatsko osvežavanje niti da „osveži“ prikaz (vidi `isRunInvalid`).
 */
export const FUTURE_TOLERANCE_MINUTES = 5;

/** Dugme „Osveži“ ne pokreće novu sinhronizaciju ako je poslednja uspešna mlađa od ovoga. */
export const RECENT_SYNC_MINUTES = 15;

const KINDS: ReadonlySet<string> = new Set(['sync', 'backfill']);
const STATUSES: ReadonlySet<string> = new Set(['running', 'ok', 'error']);

function timeOf(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NaN;
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * Neispravan red dnevnika: nepoznata vrsta ili status, nečitljivo vreme, ili početak/završetak
 * više od `FUTURE_TOLERANCE_MINUTES` u budućnosti. Aplikacija ga ne uzima u obzir (posao u
 * toku, „Osveženo pre …“, automatsko osvežavanje), a dnevnik ga prikazuje kao „Neispravan zapis“.
 */
export function isRunInvalid(run: SyncRunRecord, now: Date): boolean {
  if (!KINDS.has(run.kind) || !STATUSES.has(run.status)) return true;
  const limit = now.getTime() + FUTURE_TOLERANCE_MINUTES * 60_000;
  const started = timeOf(run.startedAt);
  if (!Number.isFinite(started) || started > limit) return true;
  if (run.finishedAt !== null && run.finishedAt !== undefined) {
    const finished = timeOf(run.finishedAt);
    if (!Number.isFinite(finished) || finished > limit) return true;
  }
  return false;
}

/** Redovi dnevnika bez neispravnih (redosled ostaje: najnoviji prvi). */
export function validRuns(runs: readonly SyncRunRecord[], now: Date): SyncRunRecord[] {
  return runs.filter((run) => !isRunInvalid(run, now));
}

/** `running` red stariji od perioda tolerancije – posao je prekinut bez upisa završetka. */
export function isRunAbandoned(run: SyncRunRecord, now: Date): boolean {
  if (run.status !== 'running') return false;
  const startedAt = timeOf(run.startedAt);
  if (Number.isNaN(startedAt)) return true;
  return now.getTime() - startedAt > RUNNING_GRACE_MINUTES * 60_000;
}

/**
 * Neko drugi (druga sesija, drugi korisnik) upravo sinhronizuje: ova sesija nema svoj posao,
 * a najnoviji red dnevnika (ili najnovija sinhronizacija trenutnog stanja) je `running` i još
 * nije napušten. Tada ljuska periodično ponovo učitava podatke, da završetak tog posla stigne
 * na ekran pre nego što red pređe u „napušten“ (`RUNNING_GRACE_MINUTES`).
 */
export function isRemoteRunActive(runs: readonly SyncRunRecord[], activity: unknown, now: Date): boolean {
  if (activity) return false;
  return remoteRunOf(runs, now) !== null;
}

/** Red posla koji je u toku u drugoj sesiji (vidi `isRemoteRunActive`) ili null; neispravni redovi se preskaču. */
export function remoteRunOf(runs: readonly SyncRunRecord[], now: Date): SyncRunRecord | null {
  const valid = validRuns(runs, now);
  const candidates = [valid[0], valid.find((run) => run.kind === 'sync')];
  for (const run of candidates) {
    if (run && run.status === 'running' && !isRunAbandoned(run, now)) return run;
  }
  return null;
}

/** Bilo koji ispravan `running` red u dnevniku koji još nije napušten. */
export function hasActiveRun(runs: readonly SyncRunRecord[], now: Date): boolean {
  return runs.some((run) => run.status === 'running' && !isRunInvalid(run, now) && !isRunAbandoned(run, now));
}

/**
 * Da li je SEPA po očekivanju već objavila sat posle najnovijeg u bazi: SLEDEĆI interval (onaj
 * koji počinje kad se najnoviji u bazi završi; `newestObservedAt` = početak najnovijeg) završio
 * se pre više od `EXPECTED_LAG_MINUTES`, pa bi sinhronizacija verovatno donela nov sat. Bez
 * merenja u bazi (null) – ne zna se, false.
 *
 * Primer: u bazi je 23–00 h; sat 00–01 h se završava u 01:00 i očekuje se u 01:20, pa je od
 * 01:20 „očekivan“. Dok je u bazi 00–01 h, sledeći (01–02 h) se očekuje tek u 02:20 – ranija
 * verzija je računala kraj najnovijeg intervala u bazi (01:20), što je sat koji VEĆ imamo, pa je
 * uslov važio odmah posle svake sinhronizacije i pravilo se svodilo na „svakih MIN_GAP“.
 */
export function nextHourExpected(newestObservedAt: Date | null | undefined, now: Date): boolean {
  if (!newestObservedAt) return false;
  const start = newestObservedAt.getTime();
  if (!Number.isFinite(start)) return false;
  // Kraj sledećeg intervala (početak najnovijeg + 2 h) + očekivano kašnjenje objave.
  const published = start + 2 * 3_600_000 + EXPECTED_LAG_MINUTES * 60_000;
  return published < now.getTime();
}

/**
 * Pravilo automatskog osvežavanja (samo `rayfin`), uz uslov da niko drugi upravo ne sinhronizuje:
 *  - poslednja uspešna sinhronizacija je starija od `STALE_MINUTES` (ili je nema), ILI
 *  - SEPA je po očekivanju već objavila sledeći sat (`nextHourExpected`) i poslednja
 *    sinhronizacija je starija od `MIN_GAP_MINUTES`.
 * Bez `newestObservedAt` (prazna baza, nepoznato) važi samo pravilo od 65 min. Drugi uslov
 * zatvara rupu u kojoj je aplikacija deo svakog sata zaostajala za SEPA za ceo interval, a
 * `MIN_GAP_MINUTES` sprečava da jedna kartica sinhronizuje češće od jednom u 20 min.
 */
export function shouldAutoSync(
  lastSync: Date | null,
  runs: readonly SyncRunRecord[],
  now: Date,
  newestObservedAt: Date | null | undefined = null,
): boolean {
  const ageMs = lastSync ? now.getTime() - lastSync.getTime() : Number.POSITIVE_INFINITY;
  if (hasActiveRun(runs, now)) return false;
  if (ageMs > STALE_MINUTES * 60_000) return true;
  return ageMs > MIN_GAP_MINUTES * 60_000 && nextHourExpected(newestObservedAt, now);
}

/** Šta radi dugme „Osveži“ u gornjoj traci (stranica Sinhronizacija uvek pokreće posao). */
export type RefreshDecision =
  | { kind: 'sync' }
  /** Druga sesija upravo sinhronizuje – ne pokreće se drugi posao, praćenje je već uključeno. */
  | { kind: 'remote'; run: SyncRunRecord }
  /** Poslednja uspešna sinhronizacija je skorija od `RECENT_SYNC_MINUTES` – samo ponovno čitanje baze. */
  | { kind: 'recent'; lastSync: Date };

export function refreshDecision(lastSync: Date | null, runs: readonly SyncRunRecord[], now: Date): RefreshDecision {
  const remote = remoteRunOf(runs, now);
  if (remote) return { kind: 'remote', run: remote };
  if (lastSync && now.getTime() - lastSync.getTime() < RECENT_SYNC_MINUTES * 60_000) return { kind: 'recent', lastSync };
  return { kind: 'sync' };
}

/**
 * Poslednja uspešna sinhronizacija trenutnog stanja koja je ispravna: red iz posebnog upita
 * (`latestSuccessfulSync`) ako je ispravan, inače najnoviji ispravan `ok` red iz dnevnika.
 */
export function pickLastSuccessfulSync(
  fetched: SyncRunRecord | null,
  runs: readonly SyncRunRecord[],
  now: Date,
): SyncRunRecord | null {
  if (fetched && fetched.kind === 'sync' && fetched.status === 'ok' && !isRunInvalid(fetched, now)) return fetched;
  return runs.find((run) => run.kind === 'sync' && run.status === 'ok' && !isRunInvalid(run, now)) ?? null;
}

// ---------------------------------------------------------------------------
// Pokrivenost istorije
// ---------------------------------------------------------------------------

/** Koliko prošlih dana izvor čuva i koliko ih „Dopuni nedostajuće dane“ proverava (juče … pre 30 dana). */
export const HISTORY_DAYS = 30;
/**
 * Dan je potpun kad potpun dan ima bar ovaj deo stanica koje uopšte javljaju u prozoru. Potpun
 * dan stanice: bar jedan polutant sa `minCoveredHours(day)` satnih merenja (18 h; 19 h na dan od
 * 25 h) – isto pravilo kao „pokriven dan“ na Trendovima (`@/lib/coverage`).
 */
export const COMPLETE_DAY_SHARE = 0.8;

/**
 * `expired` – prvi dan prozora (danas − 30) koji već ima redove, ali nije potpun: izvor ga već
 * briše (zadržavanje klizi po satu), pa se ne može dopuniti i ne broji se ni kao nepotpun ni
 * kao potpun. Prikaz: šrafiran, „istekao (izvor ga već briše)“. Dan bez ijednog reda ostaje
 * `missing` i danas – ono što izvor još čuva može da se učita.
 */
export type DayCoverageStatus = 'complete' | 'partial' | 'missing' | 'expired';

export interface DayCoverage {
  day: string;
  status: DayCoverageStatus;
  /** Stanice sa potpunim danom (≥ `minCoveredHours(day)` sati, vidi `@/lib/coverage`). */
  complete: number;
  /** Stanice sa bar jednim redom dnevne statistike tog dana. */
  reported: number;
}

export interface HistoryCoverage {
  /** Dani od najstarijeg (danas − 30) do juče. */
  days: DayCoverage[];
  /** Stanice koje u prozoru imaju bar jedan dan (imenilac za „potpun dan“). */
  stations: number;
  /** Dani sa statusom `complete` (istekao rubni dan se ne broji). */
  completeDays: number;
  /** Dani koji nisu potpuni i mogu da se dopune, od najstarijeg – redosled dopunjavanja (bez `expired`). */
  incomplete: string[];
  /** Dani bez ijednog reda (nije učitano). */
  missing: string[];
  /** Istekao rubni dan (najviše jedan, prvi dan prozora) – vidi `DayCoverageStatus`. */
  expired: string[];
  /** Za koliko dana izvor briše najstariji nepotpun dan (0 = danas je poslednji dan), ili null. */
  oldestIncompleteExpiresInDays: number | null;
}

/** Prvi dan prozora istorije (uključivo): danas − `HISTORY_DAYS`. */
export function historyWindowStart(today: string, days = HISTORY_DAYS): string {
  return addDays(today, -days);
}

/**
 * Pokrivenost istorije iz dnevne statistike mreže (`listNetworkDailyStats`): za svaki od
 * poslednjih `days` prošlih dana da li je potpun, delimičan ili nije učitan. Današnji dan se
 * ne računa (dopunjava ga svaka sinhronizacija). Računa se u klijentu – bez promene šeme.
 */
export function historyCoverage(
  stats: ReadonlyArray<Pick<DailyStatRecord, 'station_id' | 'day' | 'hours'>>,
  today: string,
  days = HISTORY_DAYS,
): HistoryCoverage {
  const first = historyWindowStart(today, days);
  const yesterday = addDays(today, -1);
  const hoursByDay = new Map<string, Map<string, number>>();
  const stations = new Set<string>();
  for (const stat of stats) {
    if (stat.day < first || stat.day > yesterday) continue;
    stations.add(stat.station_id);
    let byStation = hoursByDay.get(stat.day);
    if (!byStation) hoursByDay.set(stat.day, (byStation = new Map()));
    const hours = Number(stat.hours) || 0;
    byStation.set(stat.station_id, Math.max(byStation.get(stat.station_id) ?? 0, hours));
  }
  const needed = Math.max(1, Math.ceil(stations.size * COMPLETE_DAY_SHARE));
  const list: DayCoverage[] = [];
  for (let i = days; i >= 1; i--) {
    const day = addDays(today, -i);
    const byStation = hoursByDay.get(day);
    const reported = byStation?.size ?? 0;
    const minHours = minCoveredHours(day);
    let complete = 0;
    for (const hours of byStation?.values() ?? []) if (hours >= minHours) complete++;
    // Delimičan prvi dan prozora je istekao: izvor ga već briše, dopuna ga ne može upotpuniti.
    const status: DayCoverageStatus =
      reported === 0 ? 'missing' : complete >= needed ? 'complete' : day === first ? 'expired' : 'partial';
    list.push({ day, status, complete, reported });
  }
  const incomplete = list.filter((d) => d.status === 'partial' || d.status === 'missing').map((d) => d.day);
  return {
    days: list,
    stations: stations.size,
    completeDays: list.filter((d) => d.status === 'complete').length,
    incomplete,
    missing: list.filter((d) => d.status === 'missing').map((d) => d.day),
    expired: list.filter((d) => d.status === 'expired').map((d) => d.day),
    oldestIncompleteExpiresInDays: incomplete.length ? dayDiff(first, incomplete[0]) : null,
  };
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function dayMonth(day: string): { d: string; m: string } {
  return { d: day.slice(8, 10), m: day.slice(5, 7) };
}

/**
 * Niz dana kao kratki rasponi: `13.–14. 09., 29. 09.`, preko granice meseca `30. 09.–01. 10.`.
 * Najviše `max` raspona, ostatak kao „ i još N dana“.
 */
export function formatDayRanges(days: readonly string[], max = 3): string {
  const sorted = [...new Set(days)].sort();
  const ranges: Array<[string, string]> = [];
  for (const day of sorted) {
    const last = ranges.at(-1);
    if (last && addDays(last[1], 1) === day) last[1] = day;
    else ranges.push([day, day]);
  }
  const text = ranges.slice(0, max).map(([a, b]) => {
    const from = dayMonth(a);
    const to = dayMonth(b);
    if (a === b) return `${from.d}. ${from.m}.`;
    return from.m === to.m ? `${from.d}.–${to.d}. ${to.m}.` : `${from.d}. ${from.m}.–${to.d}. ${to.m}.`;
  });
  const rest = ranges.slice(max).reduce((sum, [a, b]) => sum + dayDiff(a, b) + 1, 0);
  return rest > 0 ? `${text.join(', ')} i još ${rest} ${pluralSr(rest, 'dan', 'dana', 'dana')}` : text.join(', ');
}

/**
 * Rečenica o rupama: „Nedostaju 13.–14. 09.; delimičan 01. 10.“; istekao rubni dan se navodi
 * posebno („istekao 07. 09. – izvor ga već briše“) jer se ne može dopuniti.
 */
export function coverageGapsText(coverage: HistoryCoverage): string {
  const expired = coverage.expired.length ? `istekao ${formatDayRanges(coverage.expired)} – izvor ga već briše` : '';
  if (coverage.incomplete.length === 0) {
    if (!expired) return `Svih ${HISTORY_DAYS} prošlih dana je u bazi.`;
    return `Svih ${formatInt(coverage.completeDays)} dana koje izvor još čuva je u bazi; ${expired}.`;
  }
  const partial = coverage.days.filter((d) => d.status === 'partial').map((d) => d.day);
  const parts: string[] = [];
  if (coverage.missing.length) parts.push(`${coverage.missing.length === 1 ? 'Nedostaje' : 'Nedostaju'} ${formatDayRanges(coverage.missing)}`);
  if (partial.length) {
    const word = partial.length === 1 ? 'delimičan' : 'delimični';
    parts.push(`${parts.length ? word : word[0].toUpperCase() + word.slice(1)} ${formatDayRanges(partial)}`);
  }
  if (expired) parts.push(expired);
  const text = parts.join('; ');
  return text.endsWith('.') ? text : `${text}.`;
}
