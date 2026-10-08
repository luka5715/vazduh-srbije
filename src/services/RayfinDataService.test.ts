// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { RayfinDataService } from './RayfinDataService';
import type { VazduhClient } from './rayfinClient';

interface Row {
  id: string;
  station_id: string;
  parameter: string;
  day: string;
  avgValue: number;
  maxValue: number;
  minValue: number;
  maxHour: number;
  hours: number;
  categoryMax: number;
  updatedAt: Date;
}

function row(day: string, station = 's1'): Row {
  return { id: `${station}|${day}`, station_id: station, parameter: 'PM10', day, avgValue: 1, maxValue: 2, minValue: 0, maxHour: 1, hours: 24, categoryMax: 0, updatedAt: new Date() };
}

/**
 * Lažni fluent klijent koji ponaša se kao Fabric GraphQL: `where` prima samo `eq`, a `gte`
 * baca grešku „input object field gte does not exist“; strane idu po `day desc` i `first(n)`.
 * Sa `sniffDates` radi kao pravi SDK u browseru: tekst `YYYY-MM-DD` vraća kao `Date` (UTC ponoć).
 */
function fakeClient(rows: Row[], pageSize: number, options: { sniffDates?: boolean } = {}) {
  const requests: Array<{ where: unknown; after?: string; first?: number }> = [];
  const builder = (state: { where?: Record<string, { eq?: string; gte?: string }>; order?: Record<string, string>; first?: number; after?: string }) => ({
    select: () => builder(state),
    where: (where: Record<string, { eq?: string; gte?: string }>) => builder({ ...state, where }),
    orderBy: (order: Record<string, string>) => builder({ ...state, order }),
    first: (first: number) => builder({ ...state, first }),
    after: (after: string) => builder({ ...state, after }),
    async executePaginated() {
      requests.push({ where: state.where, after: state.after, first: state.first });
      for (const condition of Object.values(state.where ?? {})) {
        if (condition.gte !== undefined) throw new Error("GraphQL errors: The specified input object field `gte` does not exist.");
      }
      let items = rows.filter((r) => Object.entries(state.where ?? {}).every(([field, c]) => c.eq === undefined || r[field as keyof Row] === c.eq));
      const [field, dir] = Object.entries(state.order ?? { day: 'asc' })[0];
      items = [...items].sort((a, b) => (a[field as keyof Row] < b[field as keyof Row] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      const start = state.after ? Number(state.after) : 0;
      const size = Math.min(state.first ?? 100, pageSize);
      const page = items.slice(start, start + size).map((r) => (options.sniffDates ? { ...r, day: new Date(r.day) as unknown as string } : r));
      return { items: page, hasNextPage: start + size < items.length, endCursor: String(start + size) };
    },
  });
  return { client: { data: { DailyStat: builder({}) } } as unknown as VazduhClient, requests };
}

const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];

describe('RayfinDataService daily statistics (no range filter on text columns)', () => {
  it('returns rows from fromDay ascending without sending gte, stopping once a page is past fromDay', async () => {
    const rows = DAYS.flatMap((day) => [row(day, 's1'), row(day, 's2')]);
    const { client, requests } = fakeClient(rows, 4);
    const service = new RayfinDataService(client);

    const result = await service.listNetworkDailyStats('2026-09-04');

    expect(result.map((r) => r.day)).toEqual(['2026-09-04', '2026-09-04', '2026-09-05', '2026-09-05', '2026-09-06', '2026-09-06']);
    // 12 rows desc in pages of 4: page 1 = 06,06,05,05; page 2 = 04,04,03,03 → stop (03 < 04). Page 3 never read.
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.where === undefined)).toBe(true);
  });

  it('filters one station by eq and keeps only days from fromDay', async () => {
    const rows = DAYS.flatMap((day) => [row(day, 's1'), row(day, 's2')]);
    const { client, requests } = fakeClient(rows, 100);
    const service = new RayfinDataService(client);

    const result = await service.listDailyStats('s2', '2026-09-05');

    expect(result.map((r) => `${r.station_id}:${r.day}`)).toEqual(['s2:2026-09-05', 's2:2026-09-06']);
    expect(requests).toHaveLength(1);
    expect(requests[0].where).toEqual({ station_id: { eq: 's2' } });
  });

  it('reads the whole network in 5000-row pages (3 round trips for 30 days of 87 stations) and one station in 1000-row pages', async () => {
    // 30 days × 87 stations × 5 pollutants = 13 050 rows, newest first; fromDay keeps all of them.
    const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const rows = days.flatMap((day) => Array.from({ length: 87 * 5 }, (_, i) => row(day, `s${Math.floor(i / 5)}-${i % 5}`)));
    const network = fakeClient(rows, 5000);
    const service = new RayfinDataService(network.client);

    const result = await service.listNetworkDailyStats('2026-09-01');
    expect(result).toHaveLength(13_050);
    expect(network.requests).toHaveLength(3);
    expect(network.requests.every((r) => r.first === 5000)).toBe(true);

    const station = fakeClient(rows, 5000);
    await new RayfinDataService(station.client).listDailyStats('s0-0', '2026-09-01');
    expect(station.requests).toHaveLength(1);
    expect(station.requests[0].first).toBe(1000);
  });

  it('returns day as YYYY-MM-DD text even when the SDK sniffs it into a Date, keeping early stop and the fromDay filter', async () => {
    // Pravi SDK u browseru vraća `day` kao `Date` (UTC ponoć); bez vraćanja u tekst poređenja
    // „dan < fromDay“ daju false, filter izbaci sve redove, a Sinhronizacija prikazuje 0/30 dana.
    const rows = DAYS.flatMap((day) => [row(day, 's1'), row(day, 's2')]);
    const network = fakeClient(rows, 4, { sniffDates: true });
    const service = new RayfinDataService(network.client);

    const result = await service.listNetworkDailyStats('2026-09-04');

    expect(result.map((r) => r.day)).toEqual(['2026-09-04', '2026-09-04', '2026-09-05', '2026-09-05', '2026-09-06', '2026-09-06']);
    expect(result.every((r) => typeof r.day === 'string')).toBe(true);
    expect(network.requests).toHaveLength(2);

    const station = fakeClient(rows, 100, { sniffDates: true });
    const mine = await new RayfinDataService(station.client).listDailyStats('s2', '2026-09-05');
    expect(mine.map((r) => `${r.station_id}:${r.day}`)).toEqual(['s2:2026-09-05', 's2:2026-09-06']);
  });

  it('returns an empty list when every row is older than fromDay', async () => {
    const { client } = fakeClient([row('2026-08-01')], 100);
    const service = new RayfinDataService(client);
    expect(await service.listNetworkDailyStats('2026-09-01')).toEqual([]);
  });
});
