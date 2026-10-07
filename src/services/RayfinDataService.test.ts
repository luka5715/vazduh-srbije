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
 */
function fakeClient(rows: Row[], pageSize: number) {
  const requests: Array<{ where: unknown; after?: string }> = [];
  const builder = (state: { where?: Record<string, { eq?: string; gte?: string }>; order?: Record<string, string>; first?: number; after?: string }) => ({
    select: () => builder(state),
    where: (where: Record<string, { eq?: string; gte?: string }>) => builder({ ...state, where }),
    orderBy: (order: Record<string, string>) => builder({ ...state, order }),
    first: (first: number) => builder({ ...state, first }),
    after: (after: string) => builder({ ...state, after }),
    async executePaginated() {
      requests.push({ where: state.where, after: state.after });
      for (const condition of Object.values(state.where ?? {})) {
        if (condition.gte !== undefined) throw new Error("GraphQL errors: The specified input object field `gte` does not exist.");
      }
      let items = rows.filter((r) => Object.entries(state.where ?? {}).every(([field, c]) => c.eq === undefined || r[field as keyof Row] === c.eq));
      const [field, dir] = Object.entries(state.order ?? { day: 'asc' })[0];
      items = [...items].sort((a, b) => (a[field as keyof Row] < b[field as keyof Row] ? -1 : 1) * (dir === 'desc' ? -1 : 1));
      const start = state.after ? Number(state.after) : 0;
      const size = Math.min(state.first ?? 100, pageSize);
      const page = items.slice(start, start + size);
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

  it('returns an empty list when every row is older than fromDay', async () => {
    const { client } = fakeClient([row('2026-08-01')], 100);
    const service = new RayfinDataService(client);
    expect(await service.listNetworkDailyStats('2026-09-01')).toEqual([]);
  });
});
