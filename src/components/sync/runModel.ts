/**
 * Čist model dnevnika sinhronizacija: status reda (uključujući napušten `running` red),
 * trajanje prema limitu funkcije, grupisanje po danu, sažetak i stanje svežine podataka.
 * Bez React-a, da bi se lako testirao.
 */

import type { SyncRunRecord } from '@shared/contracts';
import { summarizeSyncWarnings, warningsFromMessage } from '@shared/syncNotes';
import { addDays, localDay, todayLocal } from '@shared/time';

import type { SyncOutcome } from '@/hooks/useSync';
import { formatDayLong, formatDayShort, formatTime } from '@/lib/format';
import { liveStatus } from '@/lib/stations';
import { isRunAbandoned, isRunInvalid, STALE_MINUTES, validRuns } from '@/lib/syncRules';

/**
 * Status reda u dnevniku: `abandoned` je `running` red bez završetka stariji od perioda
 * tolerancije; `partial` je `ok` posao bez merenja dela stanica (upozorenja `Stanica N:` ili
 * vremenski limit, vidi `@shared/syncNotes`); `invalid` je red koji aplikacija ne uzima u obzir
 * (vreme u budućnosti, nepoznata vrsta/status – `isRunInvalid`).
 */
export type RunStatus = SyncRunRecord['status'] | 'abandoned' | 'partial' | 'invalid';

/** Fabric host prekida funkciju posle 240 s (vidi `RUNNING_GRACE_MINUTES` u lib/syncRules). */
export const FUNCTION_LIMIT_MS = 240_000;

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  ok: 'Uspešno',
  partial: 'Delimično',
  error: 'Greška',
  running: 'U toku',
  abandoned: 'Prekinuto bez završetka',
  invalid: 'Neispravan zapis',
};

/** Boja statusa kao CSS token (uz nju uvek ide tekst statusa). */
export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  ok: 'var(--ok)',
  partial: 'var(--warn)',
  error: 'var(--danger)',
  running: 'var(--accent)',
  abandoned: 'var(--warn)',
  invalid: 'var(--faint)',
};

export const ABANDONED_NOTE = 'Funkcija nije upisala završetak – verovatno je prekinuta na limitu od 240 s.';

export const INVALID_NOTE =
  'Vreme ovog zapisa je u budućnosti ili mu vrsta/status nisu ispravni – aplikacija ga ne uzima u obzir (ni za „Osveženo pre …“, ni za automatsko osvežavanje).';

function time(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NaN;
  return (value instanceof Date ? value : new Date(value)).getTime();
}

export function runStatus(run: SyncRunRecord, now: Date): RunStatus {
  if (isRunInvalid(run, now)) return 'invalid';
  if (isRunAbandoned(run, now)) return 'abandoned';
  if (run.status === 'ok' && summarizeSyncWarnings(warningsFromMessage(run.message).warnings).partial) return 'partial';
  return run.status;
}

/** Uspešan posao (i delimičan – podaci su upisani, samo bez dela stanica). */
export function isSuccess(status: RunStatus): boolean {
  return status === 'ok' || status === 'partial';
}

/**
 * Koliko stanica delimičan posao nije preuzeo, iz `SyncRun.message` (najviše 5 upozorenja,
 * skraćeno): `atLeast` kaže da je broj donja granica.
 */
export function runMissingStations(run: SyncRunRecord): { count: number; atLeast: boolean } {
  const { warnings, complete } = warningsFromMessage(run.message);
  const summary = summarizeSyncWarnings(warnings);
  return { count: summary.failedStations + summary.skippedStations, atLeast: !complete };
}

export function runKindLabel(run: SyncRunRecord): string {
  return run.kind === 'sync' ? 'Sinhronizacija' : 'Istorija';
}

/** Trajanje završenog posla u ms; null za posao bez završetka (u toku ili napušten). */
export function runDurationMs(run: SyncRunRecord, status: RunStatus = run.status): number | null {
  if (status === 'abandoned' || status === 'running' || status === 'invalid') return null;
  const ms = time(run.finishedAt) - time(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Dan istorije koji je posao učitao (sredina prozora, otporno na pomeranje zone). */
export function backfillDayOf(run: SyncRunRecord): string | null {
  if (run.kind !== 'backfill') return null;
  const from = time(run.windowFrom);
  const to = time(run.windowTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return localDay((from + to) / 2);
}

/** Prozor merenja: „ceo dan 06. 10. 2026.“ za istoriju, „05. 10. 00:00 – 07. 10. 10:10“ za sinhronizaciju. */
export function runWindowText(run: SyncRunRecord): string {
  const day = backfillDayOf(run);
  if (day) return `ceo dan ${formatDayLong(day)}`;
  const from = time(run.windowFrom);
  const to = time(run.windowTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '–';
  const fromDay = localDay(from);
  const toDay = localDay(to);
  const start = `${formatDayShort(fromDay)} ${formatTime(from)}`;
  const end = fromDay === toDay ? formatTime(to) : `${formatDayShort(toDay)} ${formatTime(to)}`;
  return `${start} – ${end}`;
}

/** Poruka koja nešto dodaje: „Dan 2026-10-06“ uz istoriju tog dana je suvišna. */
export function runMessage(run: SyncRunRecord, status: RunStatus): string | null {
  const message = run.message?.trim() || null;
  if (status === 'abandoned') return message;
  if (!message) return null;
  if (run.kind === 'backfill' && /^Dan \d{4}-\d{2}-\d{2}( \(demo\))?$/.test(message)) return null;
  return message;
}

export interface RunDayGroup {
  day: string;
  /** „Danas“, „Juče“ ili datum. */
  label: string;
  /** Kratak datum za oznake („07. 10.“). */
  short: string;
  runs: SyncRunRecord[];
}

/** Grupiše redove (najnoviji prvi) po lokalnom danu početka. */
export function groupRunsByDay(runs: SyncRunRecord[], now: Date): RunDayGroup[] {
  const today = todayLocal(now);
  const yesterday = addDays(today, -1);
  const groups: RunDayGroup[] = [];
  for (const run of runs) {
    const started = time(run.startedAt);
    const day = Number.isFinite(started) ? localDay(started) : '';
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      const label = day === today ? 'Danas' : day === yesterday ? 'Juče' : day ? formatDayLong(day) : 'Bez datuma';
      group = { day, label, short: day ? formatDayShort(day) : '', runs: [] };
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

export interface RunSummary {
  total: number;
  ok: number;
  partial: number;
  error: number;
  abandoned: number;
  running: number;
  invalid: number;
  /** Statusi od najstarijeg ka najnovijem (za traku istorije). */
  statuses: RunStatus[];
  /** Prosečno trajanje uspešnih sinhronizacija (ms) ili null. */
  avgSyncMs: number | null;
  /** Najnovija uspešna sinhronizacija u dnevniku. */
  lastOkSync: SyncRunRecord | null;
}

export function summarizeRuns(runs: SyncRunRecord[], now: Date): RunSummary {
  const statuses = runs.map((run) => runStatus(run, now));
  const count = (status: RunStatus) => statuses.filter((s) => s === status).length;
  const durations = runs
    .filter((run, i) => run.kind === 'sync' && isSuccess(statuses[i]))
    .map((run) => runDurationMs(run, 'ok'))
    .filter((ms): ms is number => ms !== null);
  return {
    total: runs.length,
    ok: count('ok'),
    partial: count('partial'),
    error: count('error'),
    abandoned: count('abandoned'),
    running: count('running'),
    invalid: count('invalid'),
    statuses: [...statuses].reverse(),
    avgSyncMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    lastOkSync: runs.find((run, i) => run.kind === 'sync' && isSuccess(statuses[i])) ?? null,
  };
}

/** Starost podataka u odnosu na pravilo automatskog osvežavanja (65 min). */
export interface Freshness {
  ageMs: number;
  /** 0–1: deo praga od 65 min koji je prošao (1 = treba osvežiti). */
  ratio: number;
  stale: boolean;
}

export function freshnessOf(lastSync: Date | null, now: Date): Freshness | null {
  if (!lastSync) return null;
  const ageMs = Math.max(0, now.getTime() - lastSync.getTime());
  const limit = STALE_MINUTES * 60_000;
  return { ageMs, ratio: Math.min(1, ageMs / limit), stale: ageMs > limit };
}

/**
 * Starost kao broj + jedinica za veliki prikaz: „12“ „min“, „3“ „h“, „2“ „dana“. Zaokružuje
 * kao `formatRelative`, da se prsten i rečenica „pre 12 min“ uvek slažu.
 */
export function ageParts(ageMs: number): { value: number; unit: string } {
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return { value: minutes, unit: 'min' };
  const hours = Math.round(ageMs / 3_600_000);
  if (hours < 48) return { value: hours, unit: 'h' };
  return { value: Math.round(ageMs / 86_400_000), unit: 'dana' };
}

/** Stanje stranice Sinhronizacija (naslov heroja). */
export type SyncState =
  | { kind: 'syncing' }
  | { kind: 'backfilling' }
  /** Neko drugi (druga sesija) upravo sinhronizuje. */
  | { kind: 'remote-running'; run: SyncRunRecord }
  /** Dnevnik je prazan – prvo pokretanje. */
  | { kind: 'empty' }
  /** Bilo je pokušaja, ali nijedna sinhronizacija nije uspela. */
  | { kind: 'never-ok'; run: SyncRunRecord }
  /** Najnoviji pokušaj sinhronizacije nije uspeo (posle poslednje uspešne). */
  | { kind: 'failed'; run: SyncRunRecord; status: 'error' | 'abandoned' }
  | { kind: 'stale' }
  /**
   * Sinhronizacija je skorašnja i uspešna, ali najnoviji sat u bazi se završio pre više od
   * `LIVE_HOURS` (3 h) – izvor kasni sa objavom (ili u bazi nema merenja: `latestObservedAt` null).
   */
  | { kind: 'sepa-late'; latestObservedAt: Date | null }
  | { kind: 'fresh' };

/**
 * Stanje heroja Sinhronizacije. `newestObservedAt` je najnoviji sat u bazi (vidi
 * `newestObservedAt` u useAtmosfera); bez njega (`undefined`) se kašnjenje izvora ne proverava.
 * Neispravni redovi dnevnika (`isRunInvalid`) ne utiču na stanje.
 */
export function syncStateOf(
  activity: 'sync' | 'backfill' | null,
  runs: SyncRunRecord[],
  lastSync: Date | null,
  now: Date,
  newestObservedAt?: Date | null,
): SyncState {
  if (activity === 'sync') return { kind: 'syncing' };
  if (activity === 'backfill') return { kind: 'backfilling' };
  const latestSync = validRuns(runs, now).find((run) => run.kind === 'sync');
  if (latestSync) {
    const status = runStatus(latestSync, now);
    if (status === 'running') return { kind: 'remote-running', run: latestSync };
    const newerThanLastOk = !lastSync || time(latestSync.startedAt) >= lastSync.getTime();
    if ((status === 'error' || status === 'abandoned') && newerThanLastOk) {
      return lastSync ? { kind: 'failed', run: latestSync, status } : { kind: 'never-ok', run: latestSync };
    }
  }
  if (!lastSync) return runs.length ? { kind: 'never-ok', run: latestSync ?? runs[0] } : { kind: 'empty' };
  const freshness = freshnessOf(lastSync, now);
  if (freshness?.stale) return { kind: 'stale' };
  if (newestObservedAt !== undefined && !liveStatus(newestObservedAt, now).live) return { kind: 'sepa-late', latestObservedAt: newestObservedAt };
  return { kind: 'fresh' };
}

/**
 * Istorija koju je korisnik zaustavio: `useSync` je beleži kao `ok: false` (nije potpuna),
 * ali to nije greška – prikazuje se neutralno, ne crveno.
 */
export function isStoppedOutcome(outcome: SyncOutcome): boolean {
  return outcome.tone === 'stopped';
}
