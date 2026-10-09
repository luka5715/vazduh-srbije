# Pattern: resilient bulk writes inside a user data function

Adapted from `rayfin/functions/src/sync.ts` of a shipped Fabric App. The job: fetch from an upstream API
and upsert ~1,500 rows per run within the host limit, through `ctx.getDataClient()` (caller identity).

## Transient-error detection and one retry

```ts
const WRITE_CONCURRENCY = 8;
const WRITE_RETRY_DELAY_MS = 500;

/** Same shape as the frontend helper: status on the object or in a nested `cause` (≤ 3 levels). */
function httpStatusOf(error: unknown, depth = 0): number | undefined { /* see patterns/errors.md */ }

const TRANSIENT_MESSAGE =
  /\bHTTP(?: Error)? (?:429|5\d\d)\b|too many requests|service unavailable|bad gateway|gateway time-?out|internal server error|fetch failed|network error|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR/i;

/**
 * Worth one retry: HTTP 429 or 5xx (by status or text) and network failures (undici `TypeError: fetch
 * failed`, `NetworkError` without status). A known status that is not 429/5xx (400, 404, 409), a GraphQL
 * input rejection and a programming `TypeError` ("Cannot read properties of undefined") are NOT transient:
 * they must fail the job instead of being skipped as "a database hiccup".
 */
export function isTransientWriteError(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status !== undefined) return status === 429 || status >= 500;
  if (error instanceof TypeError) return TRANSIENT_MESSAGE.test(error.message);
  if (error instanceof Error && error.name === 'NetworkError') return true;
  return TRANSIENT_MESSAGE.test(error instanceof Error ? error.message : String(error));
}

/** Per-job bookkeeping: rows that failed even after the retry, and the (test-adjustable) pause. */
interface WriteTally { unwritten: number; retryDelayMs: number }

/** Run once; on a transient failure pause and run once more; a second failure (any kind) counts and skips. */
async function writeWithRetry(tally: WriteTally, id: string, attempt: () => Promise<unknown>): Promise<boolean> {
  try {
    await attempt();
    return true;
  } catch (error) {
    if (!isTransientWriteError(error)) throw error;          // non-transient → job error, as before
    log(`write ${id} failed transiently (${errorText(error)}), retrying in ${tally.retryDelayMs} ms`);
    await sleep(tally.retryDelayMs);
    try {
      await attempt();
      return true;
    } catch (retryError) {
      tally.unwritten++;
      log(`row ${id} not written after retry: ${errorText(retryError)}`);
      return false;
    }
  }
}
```

## One existence check per entity, then exactly one mutation per row

```ts
interface RowWriter<F, R extends { id: string } = { id: string }> {
  /** Existing rows for the batch – `eq` filters only (all rows of a small entity, or one `day eq` per day). */
  lookup(rows: ReadonlyArray<{ id: string; fields: F }>): Promise<R[]>;
  create(id: string, fields: F): Promise<unknown>;
  update(id: string, fields: F): Promise<unknown>;
  /** The stored row is better than the new one (e.g. a past day with more hours) – keep it. */
  keep?(existing: R, fields: F): boolean;
}

async function writeRows<F, R extends { id: string }>(rows: ReadonlyArray<{ id: string; fields: F }>, writer: RowWriter<F, R>, tally: WriteTally): Promise<number> {
  if (rows.length === 0) return 0;
  let existing: Map<string, R>;
  try {
    existing = new Map((await writer.lookup(rows)).map((row) => [row.id, row] as const));
  } catch (error) {
    // If the lookup fails (e.g. a rejected filter), fall back to create→update per row: costs like the
    // SDK upsert, but the job continues.
    log(`existence lookup failed, falling back to create/update per row: ${errorText(error)}`);
    existing = new Map();
  }
  let written = 0;
  await mapLimit(rows, WRITE_CONCURRENCY, async ({ id, fields }) => {
    const current = existing.get(id);
    if (current && writer.keep?.(current, fields)) return;      // keep rule
    const attempt = current
      ? () => writer.update(id, fields)
      : async () => {
          try {
            await writer.create(id, fields);
          } catch (error) {
            try { await writer.update(id, fields); } catch { throw error; }   // duplicate from a parallel job → update
          }
        };
    if (await writeWithRetry(tally, id, attempt)) written++;
  });
  return written;
}

// Example writer for a day-partitioned table (deterministic ids → idempotent):
const dailyWriter: RowWriter<DailyFields, { id: string; hours: number }> = {
  lookup: async (pending) => {
    const days = [...new Set(pending.map((r) => r.fields.day))].sort();
    const found: Array<{ id: string; hours: number }> = [];
    for (const day of days) {
      found.push(...(await data.DailyStat.select(['id', 'hours']).where({ day: { eq: day } }).first(5000).execute()));
    }
    return found;
  },
  create: (id, fields) => data.DailyStat.create({ id, ...fields }),
  update: (id, fields) => data.DailyStat.update({ id }, fields),
  keep: (existing, fields) => fields.day < today && Number(existing.hours) > fields.hours,
};
```

## Closing the job honestly

```ts
/** Summary warnings first so they survive the 5-warning / ~900-char truncation of the log message. */
function addUnwrittenWarning(warnings: string[], tally: WriteTally): void {
  if (tally.unwritten === 0) return;
  const afterDeadline = warnings.length && !warnings[0].startsWith('Stanica ') ? 1 : 0;
  warnings.splice(afterDeadline, 0, unwrittenRowsWarning(tally.unwritten));   // "3 reda nisu upisana u bazu"
}

/**
 * Nothing written, or more unwritten than written → the database did not accept the job. Make it an
 * error; otherwise the UI shows a fresh successful sync and blames the upstream source for empty data.
 */
function assertWritesAccepted(tally: WriteTally, rowsWritten: number): void {
  if (tally.unwritten === 0) return;
  if (rowsWritten === 0 || tally.unwritten > rowsWritten) {
    throw new Error(`Baza nije prihvatila upise: ${unwrittenRowsWarning(tally.unwritten)}`);
  }
}

// In runSync, after all writes:
addUnwrittenWarning(warnings, tally);
const rowsWritten = stationsWritten + snapshotsWritten + dailyStatsWritten;
assertWritesAccepted(tally, rowsWritten);           // throws → catch → status 'error', ok: false
await finishRun(data, runId, { status: 'ok', rowsWritten, message: warningsText(warnings) });
```

## Running-job guard (no locks, eq filters only)

```ts
const RUNNING_GRACE_MS = 5 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

async function runningSync(data: DataClient, now: Date): Promise<{ id: string; startedAt: Date } | null> {
  try {
    const rows = await data.SyncRun.select(['id', 'startedAt'])
      .where({ kind: { eq: 'sync' }, status: { eq: 'running' } })
      .orderBy({ startedAt: 'desc' })
      .first(20)
      .execute();
    for (const row of rows) {
      const startedAt = new Date(row.startedAt);
      const age = now.getTime() - startedAt.getTime();
      if (Number.isFinite(age) && age < RUNNING_GRACE_MS && age > -FUTURE_TOLERANCE_MS) return { id: row.id, startedAt };
    }
    return null;                 // older rows are abandoned, future rows are invalid – neither blocks
  } catch (error) {
    log(`running-job check failed, continuing: ${errorText(error)}`);
    return null;                 // parallel jobs are idempotent; they only cost capacity
  }
}

// In runSync: if (busy) return { ok: false, syncRunId: '', error: `${SYNC_ALREADY_RUNNING} (pokrenuta pre N min u drugoj sesiji).`, ... };
```

## Deadline budget for upstream fetches

```ts
const FETCH_START_CUTOFF_MS = 120_000;   // no new station starts after this
const FETCH_DEADLINE_MS = 180_000;       // in-flight requests abort here; ~70 s remain for writes before the 250 s host limit

function fetchBudget(started: number, options: SyncOptions) {
  const { fetchStartCutoffMs = FETCH_START_CUTOFF_MS, fetchDeadlineMs = FETCH_DEADLINE_MS, ...rest } = options;
  return { log, ...rest, startBy: started + fetchStartCutoffMs, deadline: started + fetchDeadlineMs };
}
// Skipped stations become one warning ("N stanica preskočeno – vremenski limit"); the job stays ok ("Delimično").
```

## A small `mapLimit`

```ts
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
```
