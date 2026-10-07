// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dailyStatId, snapshotId, stationId } from '../../rayfin/functions/src/ids';
import { addDays, dayUtcRange, localDay, localHour, todayLocal } from '../../rayfin/functions/src/shared/time';
import { SYNC_ALREADY_RUNNING } from '../../rayfin/functions/src/shared/syncNotes';
import { runBackfill, runSync } from '../../rayfin/functions/src/sync';

import { FakeDataClient, fakeContext, type DailyStatRow, type SyncRunRow } from '../support/fakeDataClient';
import { createFakeFetch, type RouteHandler } from '../support/fakeFetch';
import {
  DAY_2026_10_05_UTC_START,
  networkWindow,
  observationRow,
  observationsPayload,
  station38Day,
  STATION38_DAY_EXPECTED,
  stationsPayload,
  type ObservationRow,
} from '../support/fixtures';

type Ctx = Parameters<typeof runSync>[0];

const HOUR = 3_600_000;
/** "Now" for every test: 2026-10-06 15:30 UTC = 17:30 in Belgrade (CEST). */
const NOW = new Date('2026-10-06T15:30:00.000Z');
/** Hourly rows for the last week for all four Niš stations (the API filters by window). */
const ALL_ROWS = networkWindow(NOW, 168);
/** Local midnight of 2026-10-06 (today) and of 2026-10-05 (yesterday), UTC+2. */
const TODAY_MIDNIGHT = '2026-10-05T22:00:00.000Z';
const YESTERDAY_MIDNIGHT = DAY_2026_10_05_UTC_START; // 2026-10-04T22:00:00.000Z

function observationsRoute(rows: ObservationRow[] = ALL_ROWS, failing: number[] = []): RouteHandler {
  return (url) => {
    const id = Number(url.searchParams.get('station_id'));
    if (failing.includes(id)) return { status: 500, text: 'upstream error' };
    const from = Date.parse(url.searchParams.get('from') ?? '');
    const to = Date.parse(url.searchParams.get('to') ?? '');
    return {
      body: observationsPayload(
        rows.filter((r) => r.station_id === id && Date.parse(r.time_start_utc) >= from && Date.parse(r.time_start_utc) <= to),
      ),
    };
  };
}

/**
 * Start of the sync window for `hoursBack`: `NOW − hoursBack` snapped back to the local
 * (Europe/Belgrade) midnight of the day it falls on, so every touched day but today is whole.
 */
function windowFrom(hoursBack: number): Date {
  return dayUtcRange(localDay(new Date(NOW.getTime() - hoursBack * HOUR))).from;
}

function rowsInWindow(hoursBack: number): ObservationRow[] {
  const from = windowFrom(hoursBack).getTime();
  return ALL_ROWS.filter((r) => Date.parse(r.time_start_utc) >= from && Date.parse(r.time_start_utc) <= NOW.getTime());
}

function setup(routes: Record<string, RouteHandler> = {}) {
  const data = new FakeDataClient();
  const ctx = fakeContext<Ctx>(data);
  const fake = createFakeFetch({
    '/api/v1/stations': () => ({ body: stationsPayload() }),
    '/api/v1/observations': observationsRoute(),
    ...routes,
  });
  // retries: 0 keeps error-path tests free of back-off sleeps.
  const options = { fetchImpl: fake.fetchImpl, retries: 0 };
  return { data, ctx, fake, options };
}

/** A long API base URL, so that every per-station warning (which quotes the URL) is ~500 chars. */
const LONG_BASE_PATH = `/${'k'.repeat(420)}/api/v1`;
const LONG_BASE_URL = `https://kosava.example${LONG_BASE_PATH}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runSync', () => {
  it('writes stations, snapshots, daily stats and an ok SyncRun for a 36 h window', async () => {
    const { data, ctx, fake, options } = setup();
    const result = await runSync(ctx, 36, options);

    const expectedRows = rowsInWindow(36);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual([]);
    // NOW − 36 h is 05:30 local on 2026-10-05; the window starts at that day's local midnight.
    expect(result.from).toBe(YESTERDAY_MIDNIGHT);
    expect(result.from).toBe(windowFrom(36).toISOString());
    expect(result.to).toBe(NOW.toISOString());
    expect(result.stationsSeen).toBe(4);
    expect(result.stationsWritten).toBe(4);
    // 2026-10-04T22:00Z … 2026-10-06T14:00Z = 41 hours × 4 stations × 2 parameters.
    expect(expectedRows).toHaveLength(41 * 4 * 2);
    expect(result.observationsSeen).toBe(expectedRows.length);
    expect(result.snapshotsWritten).toBe(4);
    // The window covers all of 2026-10-05 and today until 16:00 local: 2 days × 4 stations × 2 parameters.
    expect(new Set(expectedRows.map((r) => localDay(r.time_start_utc)))).toEqual(new Set(['2026-10-05', '2026-10-06']));
    expect(result.dailyStatsWritten).toBe(16);

    // Fetch traffic: 1 stations call + 1 observations call per station, with the result window.
    expect(fake.calls).toHaveLength(5);
    const obsUrl = new URL(fake.calls.find((c) => c.includes('/observations?station_id=38'))!);
    expect(obsUrl.searchParams.get('from')).toBe(result.from);
    expect(obsUrl.searchParams.get('to')).toBe(result.to);
    expect(fake.maxInFlight).toBeLessThanOrEqual(6);

    // Rows in the fake database.
    expect(data.Station.rows.size).toBe(4);
    expect(data.StationSnapshot.rows.size).toBe(4);
    expect(data.DailyStat.rows.size).toBe(16);
    expect(data.SyncRun.rows.size).toBe(1);

    // Database traffic: the in-progress check, one batched existence lookup per entity (+ the
    // active-station scan), then exactly one mutation per row — no per-row findById, no upsert,
    // and lastObservationAt rides along in the Station row instead of a separate update.
    expect(data.reads.map((r) => `${r.entity}:${r.op}`)).toEqual([
      'SyncRun:query',
      'Station:query',
      'Station:query',
      'StationSnapshot:query',
      'DailyStat:query',
    ]);
    expect(data.reads[0]).toMatchObject({ where: { kind: { eq: 'sync' }, status: { eq: 'running' } } });
    expect(data.reads[1]).toMatchObject({ limit: 4, where: { id: { in: expect.arrayContaining([stationId(38)]) } } });
    expect(data.reads[2].where).toEqual({ active: { eq: true } });
    expect(data.reads[4].limit).toBe(16);
    expect(data.countCalls('Station', 'create')).toBe(4);
    expect(data.countCalls('Station', 'update')).toBe(0);
    expect(data.countCalls('StationSnapshot', 'create')).toBe(4);
    expect(data.countCalls('DailyStat', 'create')).toBe(16);
    expect(data.calls.filter((c) => c.op === 'upsert')).toEqual([]);
    expect(data.calls.filter((c) => c.entity !== 'SyncRun')).toHaveLength(24);

    const station38 = data.Station.rows.get(stationId(38))!;
    expect(station38).toMatchObject({ sepaId: 38, code: 'RS1057A', name: 'Niš IZJZ Niš', municipality: 'Niš', active: true });
    expect(station38.latitude).toBeUndefined(); // fixture has no coordinates for 38
    expect(station38.lastObservationAt?.toISOString()).toBe('2026-10-06T14:00:00.000Z');
    expect(station38.updatedAt.getTime()).toBe(NOW.getTime());
    const station37 = data.Station.rows.get(stationId(37))!;
    expect([station37.latitude, station37.longitude]).toEqual([43.3209, 21.8958]);

    const snapshot38 = data.StationSnapshot.rows.get(snapshotId(38))!;
    expect(snapshot38.station_id).toBe(stationId(38));
    expect(snapshot38.observedAt.toISOString()).toBe('2026-10-06T14:00:00.000Z');
    // networkWindow(): station 38 → 20 + 8 + (168 - 1) * 0.5 = 111.5 µg/m³ PM10 at the latest hour,
    // PM2.5 = 0.6 × that = 66.9 (category 3), so PM2.5 drives the station category.
    const values = JSON.parse(snapshot38.valuesJson);
    expect(values.PM10).toEqual({ v: 111.5, t: '2026-10-06T14:00:00.000Z', c: 2 });
    expect(values['PM2.5']).toEqual({ v: 66.9, t: '2026-10-06T14:00:00.000Z', c: 3 });
    expect(snapshot38.category).toBe(3);
    expect(snapshot38.dominant).toBe('PM2.5');
    const series = JSON.parse(snapshot38.seriesJson);
    expect(series.start).toBe('2026-10-05T15:00:00.000Z');
    expect(series.values.PM10).toHaveLength(24);
    expect(series.values.PM10.every((v: unknown) => typeof v === 'number')).toBe(true);
    expect(series.values.PM10[23]).toBe(111.5);

    // Local day 2026-10-06 = 2026-10-05T22:00Z … 2026-10-06T14:00Z within the window → 17 hours,
    // values rise by 0.5 per hour so the max is the latest hour (16:00 local) and the min the first (103.5).
    const today = data.DailyStat.rows.get(dailyStatId(38, 'PM10', '2026-10-06'))!;
    expect(today).toMatchObject({
      station_id: stationId(38),
      parameter: 'PM10',
      day: '2026-10-06',
      maxValue: 111.5,
      minValue: 103.5,
      maxHour: 16,
      hours: 17,
      categoryMax: 2,
    });
    expect(today.updatedAt.getTime()).toBe(NOW.getTime());
    // Yesterday is covered from its local midnight, so its statistics are complete (24 hours):
    // 23:00 local is 17 hours before the latest value (103.0), 00:00 local is 40 hours before (91.5).
    expect(data.DailyStat.rows.get(dailyStatId(38, 'PM10', '2026-10-05'))).toMatchObject({
      hours: 24,
      maxValue: 103,
      minValue: 91.5,
      maxHour: 23,
    });

    const run = data.onlySyncRun();
    expect(run.id).toBe(result.syncRunId);
    expect(run).toMatchObject({ kind: 'sync', status: 'ok', stationsSeen: 4, observationsSeen: expectedRows.length, rowsWritten: 24 });
    expect(run.message).toBeUndefined();
    expect(run.windowFrom.toISOString()).toBe(YESTERDAY_MIDNIGHT);
    expect(run.windowFrom.toISOString()).toBe(result.from);
    expect(run.windowTo.toISOString()).toBe(result.to);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.startedAt.getTime()).toBe(NOW.getTime());
  });

  it('is idempotent: a second run updates the same rows instead of adding new ones', async () => {
    const { data, ctx, options } = setup();
    await runSync(ctx, 36, options);
    const before = data.calls.length;
    const readsBefore = data.reads.length;
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(true);
    expect(data.Station.rows.size).toBe(4);
    expect(data.StationSnapshot.rows.size).toBe(4);
    expect(data.DailyStat.rows.size).toBe(16);
    expect(data.SyncRun.rows.size).toBe(2);
    // Every data row already exists, so the second run is 24 updates after the in-progress
    // check and 4 batched lookups.
    const secondRunWrites = data.calls.slice(before).filter((c) => c.entity !== 'SyncRun');
    expect(secondRunWrites).toHaveLength(24);
    expect(secondRunWrites.every((c) => c.op === 'update')).toBe(true);
    expect(data.reads.slice(readsBefore)).toHaveLength(5);
    expect(data.reads.slice(readsBefore).every((r) => r.op === 'query')).toBe(true);
  });

  it('never overwrites a complete day with partial statistics: the window starts at local midnight', async () => {
    // Station 38, PM10: a full 2026-10-05 with a night peak at 02:00 local, then today up to 16:00 local.
    const yesterday = dayUtcRange('2026-10-05');
    const rows: ObservationRow[] = [];
    for (let h = 0; h < 24; h++) {
      rows.push(observationRow(38, 'PM10', new Date(yesterday.from.getTime() + h * HOUR).toISOString(), h === 2 ? 180 : 40 + h));
    }
    for (let t = yesterday.to.getTime(); t <= NOW.getTime() - HOUR; t += HOUR) {
      rows.push(observationRow(38, 'PM10', new Date(t).toISOString(), 30));
    }
    const { data, ctx, options } = setup({ '/api/v1/observations': observationsRoute(rows) });
    const complete = { hours: 24, maxValue: 180, maxHour: 2, minValue: 40, avgValue: 57.3, categoryMax: 3 };

    const backfill = await runBackfill(ctx, '2026-10-05', options);
    expect(backfill.ok).toBe(true);
    const id = dailyStatId(38, 'PM10', '2026-10-05');
    expect(data.DailyStat.rows.get(id)).toMatchObject(complete);

    // NOW − 36 h = 05:30 local on 2026-10-05: a raw window would see only 18 of yesterday's hours
    // and miss the 02:00 peak. The sync snaps back to 00:00 local instead.
    const sync = await runSync(ctx, 36, options);
    expect(sync.ok).toBe(true);
    expect(sync.from).toBe(yesterday.from.toISOString());
    expect(data.SyncRun.rows.get(sync.syncRunId)!.windowFrom.toISOString()).toBe(yesterday.from.toISOString());
    expect(sync.observationsSeen).toBe(24 + 17);
    expect(sync.dailyStatsWritten).toBe(2);
    expect(data.DailyStat.rows.get(id)).toMatchObject(complete);
    expect(data.DailyStat.rows.get(id)!.updatedAt.getTime()).toBe(NOW.getTime()); // rewritten, with the same values
    // Today is the only partial day.
    expect(data.DailyStat.rows.get(dailyStatId(38, 'PM10', '2026-10-06'))).toMatchObject({ hours: 17, maxValue: 30, minValue: 30 });
  });

  it('clamps hoursBack to [3, 168], rounds it, falls back to 36 for non-numbers and starts at local midnight', async () => {
    // [input, effective hoursBack, window start = local midnight of the day NOW − hoursBack falls on]
    const cases: Array<[number, number, string]> = [
      [1, 3, TODAY_MIDNIGHT],
      [-20, 3, TODAY_MIDNIGHT],
      [36.4, 36, YESTERDAY_MIDNIGHT],
      [48, 48, '2026-10-03T22:00:00.000Z'],
      [1000, 168, '2026-09-28T22:00:00.000Z'],
      [Number.NaN, 36, YESTERDAY_MIDNIGHT],
      [Number.POSITIVE_INFINITY, 36, YESTERDAY_MIDNIGHT],
    ];
    for (const [input, expectedHours, expectedFrom] of cases) {
      const { ctx, fake, options } = setup();
      const result = await runSync(ctx, input, options);
      expect(result.ok, `hoursBack=${input}`).toBe(true);
      expect(result.from, `hoursBack=${input}`).toBe(expectedFrom);
      expect(result.from, `hoursBack=${input}`).toBe(windowFrom(expectedHours).toISOString());
      expect(localHour(result.from), `hoursBack=${input}`).toBe(0);
      // Snapping back to midnight extends the window by less than one day.
      const span = (Date.parse(result.to) - Date.parse(result.from)) / HOUR;
      expect(span, `hoursBack=${input}`).toBeGreaterThanOrEqual(expectedHours);
      expect(span, `hoursBack=${input}`).toBeLessThan(expectedHours + 24);
      const obsUrl = new URL(fake.calls[1]);
      expect(obsUrl.searchParams.get('from')).toBe(result.from);
      expect(result.observationsSeen).toBe(rowsInWindow(expectedHours).length);
    }
  });

  it('ignores inactive stations', async () => {
    const payload = stationsPayload().map((s, i) => (i === 0 ? { ...(s as object), active: false } : s));
    const { data, ctx, fake, options } = setup({ '/api/v1/stations': () => ({ body: payload }) });
    const result = await runSync(ctx, 36, options);
    expect(result.stationsSeen).toBe(3);
    expect(result.stationsWritten).toBe(3);
    expect(data.Station.rows.has(stationId(36))).toBe(false);
    expect(fake.calls).toHaveLength(4);
  });

  it('deactivates stations the API no longer returns and reactivates them when they come back', async () => {
    const { data, ctx, options } = setup();
    await runSync(ctx, 36, options);
    expect([...data.Station.rows.values()].every((s) => s.active)).toBe(true);

    // Station 36 has been retired: /stations?active=true no longer lists it.
    const without36 = createFakeFetch({
      '/api/v1/stations': () => ({ body: stationsPayload().slice(1) }),
      '/api/v1/observations': observationsRoute(),
    });
    const second = await runSync(ctx, 36, { ...options, fetchImpl: without36.fetchImpl });
    expect(second.ok).toBe(true);
    expect(second.stationsSeen).toBe(3);
    expect(second.stationsWritten).toBe(4); // 3 refreshed + 1 deactivated
    expect(second.snapshotsWritten).toBe(3);
    expect(second.dailyStatsWritten).toBe(12);
    const retired = data.Station.rows.get(stationId(36))!;
    expect(retired.active).toBe(false);
    expect(retired.updatedAt.getTime()).toBe(NOW.getTime());
    expect(retired.lastObservationAt?.toISOString()).toBe('2026-10-06T14:00:00.000Z'); // left as it was
    expect(data.StationSnapshot.rows.has(snapshotId(36))).toBe(true); // nothing is ever deleted
    expect([37, 38, 106].every((sepaId) => data.Station.rows.get(stationId(sepaId))!.active)).toBe(true);
    expect(data.SyncRun.rows.get(second.syncRunId)!.rowsWritten).toBe(4 + 3 + 12);
    // The active-station scan is one single-page query per sync.
    const scans = data.reads.filter((r) => r.entity === 'Station' && r.where?.active?.eq === true);
    expect(scans).toHaveLength(2);
    expect(scans[0].limit).toBe(1000);

    // Station 36 is back: the ordinary station write turns it active again.
    const third = await runSync(ctx, 36, options);
    expect(third.ok).toBe(true);
    expect(third.stationsWritten).toBe(4);
    expect(data.Station.rows.get(stationId(36))!.active).toBe(true);
    expect(data.Station.rows.size).toBe(4);
  });

  it('batches existence lookups in chunks of 100 ids', async () => {
    // 13 synthetic stations × PM10 × 8 local days (168 h window from 2026-09-29) = 104 DailyStat rows.
    const stations = Array.from({ length: 13 }, (_, i) => ({
      station_id: 1000 + i,
      station_name: `Stanica ${i}`,
      station_code: `RS9${String(i).padStart(3, '0')}A`,
      municipality: 'Test',
      active: true,
    }));
    const { data, ctx, options } = setup({
      '/api/v1/stations': () => ({ body: stations }),
      '/api/v1/observations': (url) => {
        const id = Number(url.searchParams.get('station_id'));
        const from = Date.parse(url.searchParams.get('from')!);
        const to = Date.parse(url.searchParams.get('to')!);
        const rows: ObservationRow[] = [];
        for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) {
          rows.push(observationRow(id, 'PM10', new Date(t).toISOString(), 10));
        }
        return { body: observationsPayload(rows) };
      },
    });

    const result = await runSync(ctx, 168, options);
    expect(result.ok).toBe(true);
    expect(result.from).toBe('2026-09-28T22:00:00.000Z');
    expect(result.dailyStatsWritten).toBe(13 * 8);
    expect(data.DailyStat.rows.size).toBe(104);
    const lookups = data.reads.filter((r) => r.entity === 'DailyStat');
    expect(lookups.map((r) => (r.where?.id?.in ?? []).length).sort((a, b) => b - a)).toEqual([100, 4]);
    expect(lookups.map((r) => r.limit).sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([100, 4]);
    expect(data.countCalls('DailyStat', 'create')).toBe(104);

    const before = data.calls.length;
    await runSync(ctx, 168, options);
    const again = data.calls.slice(before).filter((c) => c.entity === 'DailyStat');
    expect(again).toHaveLength(104);
    expect(again.every((c) => c.op === 'update')).toBe(true);
  });

  it('falls back to create/update per row when the batched existence lookup fails', async () => {
    const { data, ctx, options } = setup();
    await runSync(ctx, 36, options);
    const before = data.calls.length;
    // e.g. a backend that rejects the `in` filter: the lookup throws, the rows must still be written.
    data.DailyStat.failNextRead = new Error('Unsupported filter operator: in');
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(true);
    expect(data.DailyStat.rows.size).toBe(16);
    const dailyWrites = data.calls.slice(before).filter((c) => c.entity === 'DailyStat');
    // Every existing row: one failed create (duplicate id) followed by the update that wins.
    expect(dailyWrites).toHaveLength(16);
    expect(dailyWrites.every((c) => c.op === 'update')).toBe(true);
    const stationWrites = data.calls.slice(before).filter((c) => c.entity === 'Station' && c.op === 'update');
    expect(stationWrites).toHaveLength(4);
  });

  it('falls back to update when create loses the race against a concurrent sync', async () => {
    const { data, ctx, options } = setup();
    const contested = dailyStatId(38, 'PM10', '2026-10-06');
    data.DailyStat.onCreate = (input) => {
      // Another sync inserted the same row between our existence lookup and our create.
      if (input.id === contested && !data.DailyStat.rows.has(contested)) {
        data.DailyStat.rows.set(contested, { ...(input as DailyStatRow), hours: -1 });
      }
    };
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(true);
    expect(result.dailyStatsWritten).toBe(16);
    expect(data.DailyStat.rows.get(contested)!.hours).toBe(17); // our values won through the update
    expect(data.calls.filter((c) => c.id === contested).map((c) => c.op)).toEqual(['update']);
    expect(data.countCalls('DailyStat', 'create')).toBe(15);
  });

  it('records a warning for a failing station and still finishes ok', async () => {
    const { data, ctx, options } = setup({ '/api/v1/observations': observationsRoute(ALL_ROWS, [106]) });
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Stanica 106: /);
    expect(result.warnings[0]).toMatch(/HTTP 500/);
    expect(result.stationsWritten).toBe(4);
    expect(result.snapshotsWritten).toBe(3);
    expect(result.dailyStatsWritten).toBe(12);
    expect(data.StationSnapshot.rows.has(snapshotId(106))).toBe(false);
    expect(data.Station.rows.get(stationId(106))!.lastObservationAt).toBeUndefined();

    const run = data.onlySyncRun();
    expect(run.status).toBe('ok');
    expect(run.message).toBe(result.warnings[0]);
    expect(run.rowsWritten).toBe(4 + 3 + 12);
  });

  it('keeps lastObservationAt of a station that has no observations in this window', async () => {
    const { data, ctx, options } = setup();
    await runSync(ctx, 36, options);
    const second = await runSync(ctx, 36, { ...options, fetchImpl: createFakeFetch({
      '/api/v1/stations': () => ({ body: stationsPayload() }),
      '/api/v1/observations': observationsRoute(ALL_ROWS, [106]),
    }).fetchImpl });
    expect(second.ok).toBe(true);
    expect(second.snapshotsWritten).toBe(3);
    expect(data.Station.rows.get(stationId(106))!.lastObservationAt?.toISOString()).toBe('2026-10-06T14:00:00.000Z');
    expect(data.Station.rows.get(stationId(106))!.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it('truncates the joined warnings to fit the SyncRun.message column', async () => {
    const { data, ctx, options } = setup({
      [`${LONG_BASE_PATH}/stations`]: () => ({ body: stationsPayload() }),
      [`${LONG_BASE_PATH}/observations`]: observationsRoute(ALL_ROWS, [36, 37, 106]),
    });
    const result = await runSync(ctx, 36, { ...options, baseUrl: LONG_BASE_URL });

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(3);
    const joined = result.warnings.join(' | ');
    expect(joined.length).toBeGreaterThan(1000);
    const run = data.onlySyncRun();
    expect(run.status).toBe('ok');
    expect(run.message!.length).toBe(901);
    expect(run.message).toBe(`${joined.slice(0, 900)}…`);
  });

  it('fails with an error SyncRun when the API returns no active stations', async () => {
    const { data, ctx, fake, options } = setup({ '/api/v1/stations': () => ({ body: { data: [] } }) });
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Kosava API nije vratio nijednu aktivnu stanicu.');
    expect(result.stationsSeen).toBe(0);
    expect(result.stationsWritten).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(data.Station.rows.size).toBe(0);
    const run = data.onlySyncRun();
    expect(run).toMatchObject({ kind: 'sync', status: 'error', rowsWritten: 0, message: result.error });
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.id).toBe(result.syncRunId);
  });

  it('fails when the stations endpoint is down (HTTP 500)', async () => {
    const { data, ctx, options } = setup({ '/api/v1/stations': () => ({ status: 500, text: 'down' }) });
    const result = await runSync(ctx, 36, options);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    expect(data.onlySyncRun().status).toBe('error');
  });

  it('fails when the stations endpoint is unreachable (network error)', async () => {
    const { data, ctx, options } = setup({
      '/api/v1/stations': () => {
        throw new TypeError('fetch failed');
      },
    });
    const result = await runSync(ctx, 36, options);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('fetch failed');
    expect(data.onlySyncRun()).toMatchObject({ status: 'error', message: 'fetch failed' });
  });

  it('fails when every station fails but keeps the station rows it already wrote', async () => {
    const { data, ctx, options } = setup({ '/api/v1/observations': observationsRoute(ALL_ROWS, [36, 37, 38, 106]) });
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Nema satnih merenja/);
    expect(result.warnings).toHaveLength(4);
    expect(result.stationsWritten).toBe(4);
    expect(result.observationsSeen).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
    expect(data.Station.rows.size).toBe(4);
    expect(data.StationSnapshot.rows.size).toBe(0);
    const run = data.onlySyncRun();
    expect(run).toMatchObject({ status: 'error', stationsSeen: 4, observationsSeen: 0, rowsWritten: 4 });
    expect(run.message).toMatch(/Nema satnih merenja/);
  });

  it('fails when the API returns an empty window (no observations)', async () => {
    const { data, ctx, options } = setup({ '/api/v1/observations': () => ({ body: { data: [] } }) });
    const result = await runSync(ctx, 36, options);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Nema satnih merenja/);
    expect(result.warnings).toEqual([]);
    expect(data.onlySyncRun().status).toBe('error');
  });

  it('reports a database write failure as an error run', async () => {
    const { data, ctx, options } = setup();
    data.StationSnapshot.failNext = { op: 'create', error: new Error('SQL timeout') };
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(false);
    // The create failed and the row did not exist, so the fallback update failed too: the
    // original error is the one reported.
    expect(result.error).toBe('SQL timeout');
    expect(result.stationsWritten).toBe(4);
    const run = data.onlySyncRun();
    expect(run.status).toBe('error');
    expect(run.message).toBe('SQL timeout');
    expect(run.rowsWritten).toBe(result.stationsWritten + result.snapshotsWritten + result.dailyStatsWritten);
  });

  it('still returns a result when the SyncRun row cannot be closed', async () => {
    const { data, ctx, options } = setup();
    data.SyncRun.failNext = { op: 'update', error: new Error('connection reset') };
    const result = await runSync(ctx, 36, options);

    expect(result.ok).toBe(true);
    expect(result.snapshotsWritten).toBe(4);
    expect(data.onlySyncRun().status).toBe('running'); // never closed, but the sync itself succeeded
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Nije uspelo zatvaranje SyncRun .*connection reset/));
  });

  it('truncates very long error messages to fit the SyncRun.message column', async () => {
    const { data, ctx, options } = setup({
      '/api/v1/stations': () => {
        throw new TypeError('x'.repeat(2000));
      },
    });
    const result = await runSync(ctx, 36, options);
    expect(result.ok).toBe(false);
    expect(result.error!.length).toBe(901);
    expect(result.error!.endsWith('…')).toBe(true);
    expect(data.onlySyncRun().message!.length).toBeLessThanOrEqual(1000);
  });

  it('uses the default fetch options when none are passed (only overriding fetchImpl here)', async () => {
    const { ctx, fake } = setup();
    const result = await runSync(ctx, 36, { fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  describe('in-progress guard', () => {
    function runningRow(id: string, overrides: Partial<SyncRunRow> = {}): SyncRunRow {
      return {
        id,
        kind: 'sync',
        status: 'running',
        startedAt: new Date(NOW.getTime() - 60_000),
        windowFrom: new Date(YESTERDAY_MIDNIGHT),
        windowTo: new Date(NOW.getTime() - 60_000),
        stationsSeen: 0,
        observationsSeen: 0,
        rowsWritten: 0,
        ...overrides,
      };
    }

    it('refuses to start while another sync started less than 5 min ago is still running', async () => {
      const { data, ctx, fake, options } = setup();
      data.SyncRun.rows.set('other', runningRow('other', { startedAt: new Date(NOW.getTime() - 2 * 60_000) }));
      const result = await runSync(ctx, 36, options);

      expect(result.ok).toBe(false);
      expect(result.error).toBe(`${SYNC_ALREADY_RUNNING} (pokrenuta pre 2 min u drugoj sesiji).`);
      expect(result.syncRunId).toBe('');
      expect(result.from).toBe(YESTERDAY_MIDNIGHT);
      expect(result.warnings).toEqual([]);
      // Nothing is fetched or written, and no SyncRun row of its own is created.
      expect(fake.calls).toEqual([]);
      expect(data.calls).toEqual([]);
      expect(data.SyncRun.rows.size).toBe(1);
    });

    it('ignores abandoned, future-dated and backfill rows, and finished syncs', async () => {
      const { data, ctx, options } = setup();
      // Abandoned: never closed, older than the 5-minute grace period.
      data.SyncRun.rows.set('abandoned', runningRow('abandoned', { startedAt: new Date(NOW.getTime() - 6 * 60_000) }));
      // Forged or clock-skewed far into the future: must not block syncs forever.
      data.SyncRun.rows.set('future', runningRow('future', { startedAt: new Date('2099-01-01T00:00:00Z') }));
      data.SyncRun.rows.set('backfill', runningRow('backfill', { kind: 'backfill' }));
      data.SyncRun.rows.set('done', runningRow('done', { status: 'ok', finishedAt: NOW }));
      const result = await runSync(ctx, 36, options);
      expect(result.ok).toBe(true);
      expect(data.SyncRun.rows.size).toBe(5);
    });

    it('still syncs when the in-progress check itself fails', async () => {
      const { data, ctx, options } = setup();
      data.SyncRun.failNextRead = new Error('GraphQL timeout');
      const result = await runSync(ctx, 36, options);
      expect(result.ok).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Provera sinhronizacije u toku nije uspela.*GraphQL timeout/));
    });
  });

  describe('time budget', () => {
    /** Observations route that makes every station request take `ms` of (fake) wall-clock time. */
    function slowObservations(ms: number, failing: number[] = []): RouteHandler {
      const inner = observationsRoute(ALL_ROWS, failing);
      return (url, attempt) => {
        vi.setSystemTime(new Date(Date.now() + ms));
        return inner(url, attempt);
      };
    }

    it('stops starting station fetches after the cut-off, writes what it has and closes ok with a warning', async () => {
      const { data, ctx, fake, options } = setup({ '/api/v1/observations': slowObservations(70_000) });
      // One request at a time: 36 starts at 0 s, 37 at 70 s, then 140 s is past the 120 s cut-off.
      const result = await runSync(ctx, 36, { ...options, concurrency: 1 });

      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(['2 stanice preskočene – vremenski limit']);
      expect(fake.calls.filter((c) => c.includes('/observations'))).toHaveLength(2);
      expect(result.stationsSeen).toBe(4);
      expect(result.stationsWritten).toBe(4);
      expect(result.snapshotsWritten).toBe(2);
      expect(result.dailyStatsWritten).toBe(8); // 2 stations × 2 days × 2 parameters
      expect(data.StationSnapshot.rows.has(snapshotId(36))).toBe(true);
      expect(data.StationSnapshot.rows.has(snapshotId(38))).toBe(false);
      const run = data.onlySyncRun();
      expect(run).toMatchObject({ status: 'ok', message: '2 stanice preskočene – vremenski limit' });
      expect(run.finishedAt).toBeInstanceOf(Date);
    });

    it('puts the time-limit warning before per-station failures so it survives truncation', async () => {
      const { data, ctx, options } = setup({ '/api/v1/observations': slowObservations(130_000, [36]) });
      const result = await runSync(ctx, 36, { ...options, concurrency: 1 });
      expect(result.ok).toBe(false); // the only fetched station failed: nothing to write
      expect(result.warnings[0]).toBe('3 stanice preskočene – vremenski limit');
      expect(result.warnings[1]).toMatch(/^Stanica 36: .*HTTP 500/);
      expect(data.onlySyncRun().status).toBe('error');
    });

    it('counts a single skipped station in the singular', async () => {
      const { ctx, options } = setup({ '/api/v1/observations': slowObservations(45_000) });
      // 0 s, 45 s, 90 s start; 135 s is past the cut-off.
      const result = await runSync(ctx, 36, { ...options, concurrency: 1 });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(['1 stanica preskočena – vremenski limit']);
    });

    it('applies the same budget to a history day', async () => {
      const { data, ctx, options } = setup({ '/api/v1/observations': slowObservations(70_000) });
      const result = await runBackfill(ctx, '2026-10-05', { ...options, concurrency: 1 });
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual(['2 stanice preskočene – vremenski limit']);
      expect(data.onlySyncRun().message).toBe('2 stanice preskočene – vremenski limit');
    });
  });
});

describe('runBackfill', () => {
  const today = todayLocal(NOW); // 2026-10-06

  it('rejects malformed and impossible days without touching the API or the database', async () => {
    for (const bad of ['abc', '2026-02-30', '2026-13-01', '06.10.2026', '', '2026-10-05T00:00:00Z']) {
      const { data, ctx, fake, options } = setup();
      const result = await runBackfill(ctx, bad, options);
      expect(result.ok, bad).toBe(false);
      expect(result.error, bad).toMatch(/Neispravan dan/);
      expect(result.error, bad).toContain('YYYY-MM-DD');
      expect(result.syncRunId).toBe('');
      expect(result.day).toBe(bad.trim());
      expect(result.dailyStatsWritten).toBe(0);
      expect(fake.calls).toEqual([]);
      expect(data.SyncRun.rows.size).toBe(0);
    }
  });

  it('rejects a day in the future', async () => {
    const { data, ctx, fake, options } = setup();
    const result = await runBackfill(ctx, addDays(today, 1), options);
    expect(result).toMatchObject({ ok: false, syncRunId: '', day: '2026-10-07', error: 'Dan je u budućnosti.' });
    expect(fake.calls).toEqual([]);
    expect(data.SyncRun.rows.size).toBe(0);
  });

  it('rejects a day older than the 30-day API retention, but accepts exactly 30 days back', async () => {
    const tooOld = setup();
    const old = await runBackfill(tooOld.ctx, addDays(today, -31), tooOld.options);
    expect(old.ok).toBe(false);
    expect(old.error).toMatch(/30 dana/);
    expect(old.day).toBe('2026-09-05');
    expect(tooOld.fake.calls).toEqual([]);

    const edge = setup();
    const result = await runBackfill(edge.ctx, addDays(today, -30), edge.options);
    expect(result.ok).toBe(true);
    expect(result.day).toBe('2026-09-06');
    expect(edge.data.SyncRun.rows.size).toBe(1);
  });

  it('accepts today (a partially filled day)', async () => {
    const { data, ctx, options } = setup();
    const result = await runBackfill(ctx, today, options);
    expect(result.ok).toBe(true);
    expect(result.dailyStatsWritten).toBe(8); // 4 stations × PM10/PM2.5
    expect([...data.DailyStat.rows.values()].every((r) => r.day === today)).toBe(true);
  });

  it('computes daily statistics for one local day from real-shaped data', async () => {
    const dayRows = [
      ...station38Day(),
      // Row that belongs to the next local day: the API may return it (to is inclusive) — must be ignored.
      observationRow(38, 'PM10', '2026-10-05T22:00:00.000Z', 500),
    ];
    const { data, ctx, fake, options } = setup({ '/api/v1/observations': observationsRoute(dayRows) });
    const result = await runBackfill(ctx, '2026-10-05', options);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.day).toBe('2026-10-05');
    expect(result.stationsSeen).toBe(4);
    expect(result.observationsSeen).toBe(49);
    expect(result.dailyStatsWritten).toBe(2);
    expect(result.warnings).toEqual([]);

    const { from, to } = dayUtcRange('2026-10-05');
    expect(from.toISOString()).toBe(DAY_2026_10_05_UTC_START);
    expect(fake.calls).toHaveLength(5);
    const obsUrl = new URL(fake.calls[1]);
    expect(obsUrl.searchParams.get('from')).toBe(from.toISOString());
    expect(obsUrl.searchParams.get('to')).toBe(to.toISOString());

    // Stations are refreshed, snapshots are not touched by a backfill.
    expect(data.Station.rows.size).toBe(4);
    expect(data.StationSnapshot.rows.size).toBe(0);
    expect(data.DailyStat.rows.size).toBe(2);
    expect([...data.Station.rows.values()].every((s) => s.lastObservationAt === undefined)).toBe(true);

    const pm10 = data.DailyStat.rows.get(dailyStatId(38, 'PM10', '2026-10-05'))!;
    expect(pm10).toMatchObject({
      station_id: stationId(38),
      parameter: 'PM10',
      day: '2026-10-05',
      maxValue: STATION38_DAY_EXPECTED.PM10.max,
      minValue: STATION38_DAY_EXPECTED.PM10.min,
      maxHour: STATION38_DAY_EXPECTED.PM10.maxHour,
      hours: 24,
      categoryMax: STATION38_DAY_EXPECTED.PM10.categoryMax,
    });
    expect(pm10.updatedAt.getTime()).toBe(NOW.getTime());
    const no2 = data.DailyStat.rows.get(dailyStatId(38, 'NO2', '2026-10-05'))!;
    expect(no2).toMatchObject({ maxValue: 80.1, maxHour: 21, hours: 24, categoryMax: 3 });
    expect(data.DailyStat.rows.has(dailyStatId(38, 'PM10', '2026-10-06'))).toBe(false);

    const run = data.onlySyncRun();
    expect(run.id).toBe(result.syncRunId);
    expect(run).toMatchObject({ kind: 'backfill', status: 'ok', stationsSeen: 4, observationsSeen: 49, rowsWritten: 2, message: 'Dan 2026-10-05' });
    expect(run.windowFrom.toISOString()).toBe(from.toISOString());
    expect(run.windowTo.toISOString()).toBe(to.toISOString());
    expect(run.finishedAt).toBeInstanceOf(Date);
  });

  it('trims surrounding whitespace in the day input', async () => {
    const { ctx, options } = setup();
    const result = await runBackfill(ctx, '  2026-10-05\n', options);
    expect(result.ok).toBe(true);
    expect(result.day).toBe('2026-10-05');
  });

  it('is idempotent for the same day', async () => {
    const { data, ctx, options } = setup();
    await runBackfill(ctx, '2026-10-05', options);
    await runBackfill(ctx, '2026-10-05', options);
    expect(data.DailyStat.rows.size).toBe(8);
    expect(data.SyncRun.rows.size).toBe(2);
    // First run creates, second run updates; one batched lookup per run.
    expect(data.countCalls('DailyStat', 'create')).toBe(8);
    expect(data.countCalls('DailyStat', 'update')).toBe(8);
    expect(data.countCalls('DailyStat', 'upsert')).toBe(0);
    expect(data.countReads('DailyStat')).toBe(2);
  });

  it('does not deactivate stations missing from the API (only runSync does)', async () => {
    const { data, ctx, options } = setup();
    await runSync(ctx, 36, options);
    const without36 = createFakeFetch({
      '/api/v1/stations': () => ({ body: stationsPayload().slice(1) }),
      '/api/v1/observations': observationsRoute(),
    });
    const result = await runBackfill(ctx, '2026-10-05', { ...options, fetchImpl: without36.fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.stationsSeen).toBe(3);
    expect(data.Station.rows.get(stationId(36))!.active).toBe(true);
    expect(data.reads.filter((r) => r.entity === 'Station' && r.where?.active?.eq === true)).toHaveLength(1); // the sync only
  });

  it('records warnings for failing stations and finishes ok', async () => {
    const { data, ctx, options } = setup({ '/api/v1/observations': observationsRoute(ALL_ROWS, [37, 38]) });
    const result = await runBackfill(ctx, '2026-10-05', options);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.slice(0, 12)).sort()).toEqual(['Stanica 37: ', 'Stanica 38: ']);
    expect(result.dailyStatsWritten).toBe(4); // stations 36 and 106 × 2 parameters
    const run = data.onlySyncRun();
    expect(run.status).toBe('ok');
    expect(run.message).toBe(result.warnings.slice(0, 5).join(' | '));
  });

  it('truncates the joined warnings to fit the SyncRun.message column', async () => {
    const { data, ctx, options } = setup({
      [`${LONG_BASE_PATH}/stations`]: () => ({ body: stationsPayload() }),
      [`${LONG_BASE_PATH}/observations`]: observationsRoute(ALL_ROWS, [36, 37, 38, 106]),
    });
    const result = await runBackfill(ctx, '2026-10-05', { ...options, baseUrl: LONG_BASE_URL });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(4);
    const joined = result.warnings.join(' | ');
    expect(joined.length).toBeGreaterThan(1000);
    const run = data.onlySyncRun();
    expect(run.message!.length).toBe(901);
    expect(run.message).toBe(`${joined.slice(0, 900)}…`);
  });

  it('finishes ok with zero rows when the API has no data for that day', async () => {
    const { data, ctx, options } = setup({ '/api/v1/observations': () => ({ body: { data: [] } }) });
    const result = await runBackfill(ctx, '2026-09-20', options);
    expect(result.ok).toBe(true);
    expect(result.observationsSeen).toBe(0);
    expect(result.dailyStatsWritten).toBe(0);
    expect(data.onlySyncRun()).toMatchObject({ status: 'ok', rowsWritten: 0, message: 'Dan 2026-09-20' });
  });

  it('fails with an error SyncRun when there are no stations', async () => {
    const { data, ctx, options } = setup({ '/api/v1/stations': () => ({ body: [] }) });
    const result = await runBackfill(ctx, '2026-10-05', options);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Kosava API nije vratio nijednu aktivnu stanicu.');
    expect(result.syncRunId).not.toBe('');
    expect(data.onlySyncRun()).toMatchObject({ kind: 'backfill', status: 'error', message: result.error, rowsWritten: 0 });
  });

  it('reports a database failure while writing daily stats', async () => {
    const { data, ctx, options } = setup();
    data.DailyStat.failNext = { op: 'create', error: new Error('deadlock') };
    const result = await runBackfill(ctx, '2026-10-05', options);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('deadlock');
    expect(data.onlySyncRun()).toMatchObject({ status: 'error', message: 'deadlock', stationsSeen: 4 });
  });

  describe('never replaces a past day with fewer hours', () => {
    /** 2026-10-05 for station 38, PM10 only, for the given local hours. */
    function partialDay(hours: number[]): ObservationRow[] {
      const { from } = dayUtcRange('2026-10-05');
      return hours.map((h) => observationRow(38, 'PM10', new Date(from.getTime() + h * HOUR).toISOString(), 50 + h));
    }

    it('keeps a complete stored day when the API now returns only part of it (retention edge)', async () => {
      const id = dailyStatId(38, 'PM10', '2026-10-05');
      const full = setup({ '/api/v1/observations': observationsRoute(partialDay([...Array(24).keys()])) });
      expect((await runBackfill(full.ctx, '2026-10-05', full.options)).dailyStatsWritten).toBe(1);
      expect(full.data.DailyStat.rows.get(id)).toMatchObject({ hours: 24, maxValue: 73 });

      const edge = createFakeFetch({
        '/api/v1/stations': () => ({ body: stationsPayload() }),
        '/api/v1/observations': observationsRoute(partialDay([18, 19, 20, 21, 22, 23])),
      });
      const before = full.data.calls.length;
      const result = await runBackfill(full.ctx, '2026-10-05', { ...full.options, fetchImpl: edge.fetchImpl });
      expect(result.ok).toBe(true);
      expect(result.dailyStatsWritten).toBe(0);
      expect(full.data.DailyStat.rows.get(id)).toMatchObject({ hours: 24, maxValue: 73 });
      expect(full.data.calls.slice(before).filter((c) => c.entity === 'DailyStat')).toEqual([]);
    });

    it('still rewrites a past day with as many or more hours, and always rewrites today', async () => {
      const id = dailyStatId(38, 'PM10', '2026-10-05');
      const { data, ctx, options } = setup({ '/api/v1/observations': observationsRoute(partialDay([0, 1, 2])) });
      await runBackfill(ctx, '2026-10-05', options);
      expect(data.DailyStat.rows.get(id)?.hours).toBe(3);

      const more = createFakeFetch({
        '/api/v1/stations': () => ({ body: stationsPayload() }),
        '/api/v1/observations': observationsRoute(partialDay([0, 1, 2, 3, 4])),
      });
      expect((await runBackfill(ctx, '2026-10-05', { ...options, fetchImpl: more.fetchImpl })).dailyStatsWritten).toBe(1);
      expect(data.DailyStat.rows.get(id)?.hours).toBe(5);

      // Today is still filling up: a row with fewer hours (here 17 of the stored 25) replaces it.
      const todayId = dailyStatId(38, 'PM10', today);
      data.DailyStat.rows.set(todayId, { ...(data.DailyStat.rows.get(id) as DailyStatRow), id: todayId, day: today, hours: 25 });
      const all = createFakeFetch({ '/api/v1/stations': () => ({ body: stationsPayload() }), '/api/v1/observations': observationsRoute() });
      const todayRun = await runBackfill(ctx, today, { ...options, fetchImpl: all.fetchImpl });
      expect(todayRun.ok).toBe(true);
      expect(data.DailyStat.rows.get(todayId)?.hours).toBe(17);
    });
  });
});
