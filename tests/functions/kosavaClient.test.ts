// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeadlineError,
  fetchAllObservations,
  fetchJson,
  fetchStations,
  KosavaHttpError,
  mapLimit,
} from '../../rayfin/functions/src/kosavaClient';
import { parseStations } from '../../rayfin/functions/src/shared/kosava';

import { createFakeFetch, networkFailure } from '../support/fakeFetch';
import { observationRow, stationsPayload } from '../support/fixtures';

const BASE = 'https://opendata.kosava.cloud/api/v1';

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('returns parsed JSON and sends exactly one request on success', async () => {
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ body: stationsPayload() }) });
    const payload = await fetchJson(`${BASE}/stations?active=true`, { fetchImpl: fake.fetchImpl });
    expect(Array.isArray(payload)).toBe(true);
    expect(fake.calls).toEqual([`${BASE}/stations?active=true`]);
  });

  it('throws KosavaHttpError without retrying on 404', async () => {
    const fake = createFakeFetch({});
    const promise = fetchJson(`${BASE}/missing`, { fetchImpl: fake.fetchImpl });
    await expect(promise).rejects.toBeInstanceOf(KosavaHttpError);
    await expect(promise).rejects.toMatchObject({ status: 404, url: `${BASE}/missing` });
    expect(fake.calls).toHaveLength(1);
  });

  it('retries 5xx with back-off and succeeds', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const fake = createFakeFetch({
      '/api/v1/stations': (_url, attempt) => (attempt < 3 ? { status: 503, text: 'busy' } : { body: [{ station_id: 1 }] }),
    });
    const promise = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, retries: 2, log });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toEqual([{ station_id: 1 }]);
    expect(fake.calls).toHaveLength(3);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(/503/);
  });

  it('gives up after `retries` attempts and throws the last HTTP error', async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch({ '/api/v1/observations': () => ({ status: 500, text: 'boom' }) });
    const promise = fetchJson(`${BASE}/observations?station_id=38`, { fetchImpl: fake.fetchImpl, retries: 1 });
    const outcome = promise.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(KosavaHttpError);
    expect((error as KosavaHttpError).status).toBe(500);
    expect(fake.calls).toHaveLength(2);
  });

  it('retries network errors (TypeError) and 429', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fake = createFakeFetch({
      '/api/v1/stations': () => {
        n++;
        if (n === 1) throw new TypeError('fetch failed');
        if (n === 2) return { status: 429, text: 'slow down' };
        return { body: { data: [] } };
      },
    });
    const promise = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, retries: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toEqual({ data: [] });
    expect(fake.calls).toHaveLength(3);
  });

  it('does not retry network errors when retries is 0', async () => {
    const fake = createFakeFetch({ '/api/v1/stations': networkFailure() });
    await expect(fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, retries: 0 })).rejects.toThrow('fetch failed');
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects invalid JSON bodies', async () => {
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ text: '<html>maintenance</html>' }) });
    await expect(fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl })).rejects.toThrow(/Nevalidan JSON/);
  });

  it('aborts a request that exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ body: [] }) }, { delayMs: 5_000 });
    const promise = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, timeoutMs: 50, retries: 0 });
    const outcome = promise.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('AbortError');
  });
});

describe('fetchStations', () => {
  it('fetches /stations?active=true from the configured base URL and parses it', async () => {
    const fake = createFakeFetch({ '/v1/stations': (url) => ({ body: url.searchParams.get('active') === 'true' ? stationsPayload() : [] }) });
    const stations = await fetchStations({ fetchImpl: fake.fetchImpl, baseUrl: 'http://api.test/v1' });
    expect(fake.calls).toEqual(['http://api.test/v1/stations?active=true']);
    expect(stations).toEqual(parseStations(stationsPayload()));
    expect(stations.map((s) => s.code)).toEqual(['RS1055G', 'RS1056A', 'RS1057A', 'RS1067A']);
  });
});

describe('mapLimit', () => {
  it('preserves input order in the results', async () => {
    const result = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n * 10;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(items, 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles empty input, limits larger than the input and a zero limit', async () => {
    expect(await mapLimit([], 8, async (x) => x)).toEqual([]);
    expect(await mapLimit([1, 2], 100, async (x) => x + 1)).toEqual([2, 3]);
    expect(await mapLimit([1, 2, 3], 0, async (x, i) => x * i)).toEqual([0, 2, 6]);
  });

  it('rejects when the mapper throws', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('bad item');
        return x;
      }),
    ).rejects.toThrow('bad item');
  });
});

describe('fetchAllObservations', () => {
  const from = new Date('2026-10-04T22:00:00.000Z');
  const to = new Date('2026-10-05T22:00:00.000Z');
  const stations = parseStations(stationsPayload());

  it('collects observations of every station and reports failing stations without throwing', async () => {
    const fake = createFakeFetch({
      '/api/v1/observations': (url) => {
        const id = Number(url.searchParams.get('station_id'));
        if (id === 106) return { status: 500, text: 'oops' };
        return { body: { data: [observationRow(id, 'PM10', '2026-10-05T10:00:00Z', id)] } };
      },
    });
    const batch = await fetchAllObservations(stations, from, to, { fetchImpl: fake.fetchImpl, retries: 0 });
    expect(batch.observations.map((o) => o.sepaId).sort((a, b) => a - b)).toEqual([36, 37, 38]);
    expect(batch.failures).toEqual([{ sepaId: 106, error: expect.stringMatching(/HTTP 500/) }]);
    expect(fake.calls).toHaveLength(4);
    for (const call of fake.calls) {
      const url = new URL(call);
      expect(url.searchParams.get('from')).toBe(from.toISOString());
      expect(url.searchParams.get('to')).toBe(to.toISOString());
    }
  });

  it('respects the concurrency option', async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch({ '/api/v1/observations': () => ({ body: { data: [] } }) }, { delayMs: 100 });
    const promise = fetchAllObservations(stations, from, to, { fetchImpl: fake.fetchImpl, concurrency: 2 });
    await vi.advanceTimersByTimeAsync(1_000);
    const batch = await promise;
    expect(batch.observations).toEqual([]);
    expect(batch.failures).toEqual([]);
    expect(fake.maxInFlight).toBe(2);
  });

  it('uses the station id as fallback when rows omit station_id', async () => {
    const fake = createFakeFetch({
      '/api/v1/observations': () => ({ body: { data: [{ parameter_code: 'NO2', time_start_utc: '2026-10-05T10:00:00Z', value: 12 }] } }),
    });
    const batch = await fetchAllObservations(stations.slice(0, 2), from, to, { fetchImpl: fake.fetchImpl });
    expect(batch.observations.map((o) => o.sepaId).sort((a, b) => a - b)).toEqual([36, 37]);
  });
});

describe('deadline', () => {
  const from = new Date('2026-10-04T22:00:00.000Z');
  const to = new Date('2026-10-05T22:00:00.000Z');
  const stations = parseStations(stationsPayload());

  it('does not send a request once the deadline has passed', async () => {
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ body: [] }) });
    const promise = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, deadline: Date.now() - 1 });
    await expect(promise).rejects.toBeInstanceOf(DeadlineError);
    expect(fake.calls).toEqual([]);
  });

  it('cuts a slow in-flight request at the deadline instead of waiting for the full timeout', async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ body: [] }) }, { delayMs: 15_000 });
    const outcome = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, timeoutMs: 20_000, deadline: Date.now() + 5_000 }).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await outcome).toBeInstanceOf(DeadlineError);
    // Not retried: a retry could not finish before the deadline either.
    expect(fake.calls).toHaveLength(1);
  });

  it('gives up instead of backing off past the deadline', async () => {
    vi.useFakeTimers();
    const fake = createFakeFetch({ '/api/v1/stations': () => ({ status: 503, text: 'busy' }) });
    const outcome = fetchJson(`${BASE}/stations`, { fetchImpl: fake.fetchImpl, retries: 2, deadline: Date.now() + 600 }).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await outcome).toBeInstanceOf(DeadlineError);
    expect(fake.calls).toHaveLength(1); // the 1 s back-off would cross the 600 ms deadline
  });

  it('skips stations that would start after `startBy`, and stations cut by the deadline, without failures', async () => {
    const fake = createFakeFetch({ '/api/v1/observations': () => ({ body: { data: [] } }) });
    const late = await fetchAllObservations(stations, from, to, { fetchImpl: fake.fetchImpl, startBy: Date.now() - 1 });
    expect(late).toEqual({ observations: [], failures: [], skipped: [36, 37, 38, 106] });
    expect(fake.calls).toEqual([]);

    const cut = await fetchAllObservations(stations.slice(0, 2), from, to, { fetchImpl: fake.fetchImpl, deadline: Date.now() - 1 });
    expect(cut.skipped.sort((a, b) => a - b)).toEqual([36, 37]);
    expect(cut.failures).toEqual([]);
  });
});
