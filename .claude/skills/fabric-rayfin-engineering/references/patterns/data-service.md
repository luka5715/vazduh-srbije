# Pattern: a data service over the Rayfin fluent client

Adapted from a shipped Fabric App (`src/services/RayfinDataService.ts` and its vitest file). Entity and
field names are examples; the shapes are the point. Comments are in English here; keep the project's
language in the project.

## Page loop with early stop, and the text-date fix

```ts
import type { AppSchema } from '../../rayfin/data/schema';   // type-only import of the entity schema
type DailyStat = AppSchema['DailyStat'];

/** One page as returned by `.executePaginated()`. */
interface Page<T> { items: T[]; hasNextPage: boolean; endCursor?: string }

const MAX_PAGES = 500;          // guard against a cursor that never advances
const PAGE_SIZE = 1000;         // one station: ≤ 5 parameters × 30 days ≈ 150 rows → one page
const NETWORK_PAGE_SIZE = 5000; // whole network: ~87 × 5 × 30 ≈ 13,000 rows → 3 pages (verified in Fabric)
const SINGLE_PAGE = 1000;       // hard upper bound for lists that are bounded by design (stations)

/**
 * Walks pages with identical select/where/orderBy; only `after` changes.
 * `stopAfter(pageItems)` ends the walk early – used with `orderBy day desc` to stop once the page is
 * below the requested first day, because DAB rejects `gte` on text columns.
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
    cursor = next && next !== cursor ? next : undefined;   // advance only with a NEW cursor
    pages++;
  } while (cursor && pages < MAX_PAGES);
  return all;
}

/** A page sorted `day desc` is "done" once its last row falls below `fromDay`. */
const pastFromDay = (fromDay: string) => (page: DailyStat[]) =>
  page.length > 0 && page[page.length - 1].day < fromDay;

/** Keep days ≥ fromDay and return ascending, as callers expect. */
function fromDayAscending(rows: DailyStat[], fromDay: string): DailyStat[] {
  return rows.filter((r) => r.day >= fromDay).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * The SDK's legacy value-sniffing (flag `cli-minor-fixes` off – always in the browser) turns every
 * `YYYY-MM-DD` string into a `Date` (UTC midnight), even from a `@text` column. Normalize back to text
 * right after reading, before any comparison or Map key. `toISOString()` is exact because the Date was
 * built from a date-only string.
 */
function dayKey(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}

const withDayKey = (row: DailyStat): DailyStat => ({ ...row, day: dayKey(row.day) });

/** Executes one paginated query and normalizes the day column of that page. */
async function dailyPage(query: { executePaginated(): Promise<Page<DailyStat>> }): Promise<Page<DailyStat>> {
  const page = await query.executePaginated();
  return { ...page, items: page.items.map(withDayKey) };
}
```

## The service methods

```ts
export class RayfinDataService implements DataService {
  readonly mode = 'rayfin' as const;
  constructor(private readonly client: AppClient) {}

  /** Bounded list: one page with an explicit upper bound (never bare `.execute()`). */
  async listStations(): Promise<StationRecord[]> {
    const rows = await this.client.data.Station.select(STATION_FIELDS)
      .orderBy({ name: 'asc' })
      .first(SINGLE_PAGE)
      .execute();
    return rows.map(toStationRecord);   // mapper normalizes Number(...)/null/Date per field
  }

  /** One station: filter by the FK column, read newest-first, stop early, return ascending. */
  async listDailyStats(stationId: string, fromDay: string): Promise<DailyStatRecord[]> {
    const rows = await fetchAllPages<DailyStat>((cursor) => {
      let q = this.client.data.DailyStat.select(DAILY_FIELDS)
        .where({ station_id: { eq: stationId } })     // eq on the FK column, not station.id
        .orderBy({ day: 'desc' })
        .first(PAGE_SIZE);
      if (cursor) q = q.after(cursor);
      return dailyPage(q);
    }, pastFromDay(fromDay));
    return fromDayAscending(rows, fromDay).map(toDailyStatRecord);
  }

  /** Whole network: same walk, bigger page, no where (a text-range filter would be rejected). */
  async listNetworkDailyStats(fromDay: string): Promise<DailyStatRecord[]> {
    const rows = await fetchAllPages<DailyStat>((cursor) => {
      let q = this.client.data.DailyStat.select(DAILY_FIELDS).orderBy({ day: 'desc' }).first(NETWORK_PAGE_SIZE);
      if (cursor) q = q.after(cursor);
      return dailyPage(q);
    }, pastFromDay(fromDay));
    return fromDayAscending(rows, fromDay).map(toDailyStatRecord);
  }

  /** Newest valid success: read a few and skip rows the UI treats as invalid (future timestamps). */
  async latestSuccessfulSync(): Promise<SyncRunRecord | null> {
    const rows = await this.client.data.SyncRun.select(SYNC_RUN_FIELDS)
      .where({ kind: { eq: 'sync' }, status: { eq: 'ok' } })
      .orderBy({ startedAt: 'desc' })
      .first(10)
      .execute();
    const now = new Date();
    return rows.map(toSyncRunRecord).find((run) => !isRunInvalid(run, now)) ?? null;
  }

  /** Functions: options in the second slot; the client clamps timeoutMs to the 250 s host ceiling. */
  runSync(hoursBack: number) {
    return this.client.functions.syncAirQuality.invoke({ hoursBack }, { timeoutMs: 240_000 });
  }
}
```

## The unit test double (vitest, `@vitest-environment node`)

```ts
/**
 * Fake fluent client that behaves like Fabric's DAB: `where` honours only `eq`, `gte` throws the real
 * error text, pages follow `orderBy` + `first` + `after`. With `sniffDates` it returns `day` as a Date
 * (UTC midnight) exactly like the SDK in the browser.
 */
function fakeClient(rows: Row[], pageSize: number, options: { sniffDates?: boolean } = {}) {
  const requests: Array<{ where: unknown; after?: string; first?: number }> = [];
  const builder = (state: State) => ({
    select: () => builder(state),
    where: (where: State['where']) => builder({ ...state, where }),
    orderBy: (order: State['order']) => builder({ ...state, order }),
    first: (first: number) => builder({ ...state, first }),
    after: (after: string) => builder({ ...state, after }),
    async executePaginated() {
      requests.push({ where: state.where, after: state.after, first: state.first });
      for (const c of Object.values(state.where ?? {})) {
        if (c.gte !== undefined) throw new Error('GraphQL errors: The specified input object field `gte` does not exist.');
      }
      let items = rows.filter((r) => Object.entries(state.where ?? {}).every(([f, c]) => c.eq === undefined || r[f] === c.eq));
      const [field, dir] = Object.entries(state.order ?? { day: 'asc' })[0];
      items = [...items].sort((a, b) => (a[field] < b[field] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      const start = state.after ? Number(state.after) : 0;
      const size = Math.min(state.first ?? 100, pageSize);     // 100 = DAB default page
      const page = items.slice(start, start + size).map((r) => (options.sniffDates ? { ...r, day: new Date(r.day) } : r));
      return { items: page, hasNextPage: start + size < items.length, endCursor: String(start + size) };
    },
  });
  return { client: { data: { DailyStat: builder({}) } } as unknown as AppClient, requests };
}

// Assertions that matter:
// - rows come back ascending from fromDay, no `where` with gte was ever sent, and only 2 of 3 pages were read;
// - one station → `where` is exactly { station_id: { eq } } and first === 1000; the network → first === 5000, 3 pages for 13,050 rows;
// - with sniffDates every returned day is a string and early stop still works;
// - all rows older than fromDay → [].
```

## Record mappers

```ts
function toDailyStatRecord(row: DailyStat): DailyStatRecord {
  return {
    id: row.id,
    station_id: row.station_id,
    parameter: row.parameter,
    day: row.day,                          // already text thanks to dayKey
    avgValue: Number(row.avgValue),        // decimals may arrive as strings
    hours: Number(row.hours),
    updatedAt: row.updatedAt,              // callers normalize dates with new Date(x)
  };
}
```
