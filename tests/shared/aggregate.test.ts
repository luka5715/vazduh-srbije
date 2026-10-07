import { describe, expect, it } from 'vitest';

import { computeDailyStats, computeSnapshot, dedupeHourly, parseSnapshotRecord } from '@shared/aggregate';
import type { StationSnapshotRecord } from '@shared/contracts';
import { parseObservations, type KosavaObservation } from '@shared/kosava';
import { dayUtcRange } from '@shared/time';

import { observationRow, station38Day, STATION38_DAY_EXPECTED } from '../support/fixtures';

const HOUR = 3_600_000;

function obs(sepaId: number, parameter: KosavaObservation['parameter'], time: string, value: number): KosavaObservation {
  return { sepaId, parameter, timeStartUtc: new Date(time).toISOString(), value, unit: 'ug.m-3', dataStatus: 'preliminary' };
}

describe('dedupeHourly', () => {
  it('keeps the last revision of the same station/parameter/hour', () => {
    const rows = [
      obs(38, 'PM10', '2026-10-05T18:00:00Z', 70.0),
      obs(38, 'PM10', '2026-10-05T18:00:00Z', 73.2), // revised value arrives later
      obs(38, 'NO2', '2026-10-05T18:00:00Z', 78.5),
    ];
    const result = dedupeHourly(rows);
    expect(result).toHaveLength(2);
    expect(result.find((o) => o.parameter === 'PM10')?.value).toBe(73.2);
  });

  it('normalises timestamps to the start of the hour and sorts by time', () => {
    const result = dedupeHourly([
      obs(38, 'PM10', '2026-10-05T19:00:00Z', 2),
      obs(38, 'PM10', '2026-10-05T18:12:34Z', 1),
      obs(38, 'PM10', '2026-10-05T18:50:00Z', 3), // same hour as 18:12 → wins
    ]);
    expect(result.map((o) => [o.timeStartUtc, o.value])).toEqual([
      ['2026-10-05T18:00:00.000Z', 3],
      ['2026-10-05T19:00:00.000Z', 2],
    ]);
  });

  it('keeps different stations apart', () => {
    const result = dedupeHourly([
      obs(37, 'PM10', '2026-10-05T18:00:00Z', 1),
      obs(38, 'PM10', '2026-10-05T18:00:00Z', 2),
    ]);
    expect(result.map((o) => o.sepaId).sort()).toEqual([37, 38]);
  });

  it('returns [] for no input', () => {
    expect(dedupeHourly([])).toEqual([]);
  });
});

describe('computeDailyStats', () => {
  it('computes avg/max/min/maxHour/hours/categoryMax for a full local day of real-shaped data', () => {
    const observations = parseObservations({ data: station38Day() });
    const stats = computeDailyStats(observations);
    expect(stats).toHaveLength(2);
    const pm10 = stats.find((s) => s.parameter === 'PM10')!;
    const no2 = stats.find((s) => s.parameter === 'NO2')!;

    expect(pm10).toMatchObject({
      sepaId: 38,
      day: '2026-10-05',
      maxValue: STATION38_DAY_EXPECTED.PM10.max,
      minValue: STATION38_DAY_EXPECTED.PM10.min,
      maxHour: STATION38_DAY_EXPECTED.PM10.maxHour,
      hours: STATION38_DAY_EXPECTED.PM10.hours,
      categoryMax: STATION38_DAY_EXPECTED.PM10.categoryMax,
    });
    expect(no2).toMatchObject({ sepaId: 38, day: '2026-10-05' });
    expect(no2.maxValue).toBe(STATION38_DAY_EXPECTED.NO2.max);
    expect(no2.minValue).toBe(STATION38_DAY_EXPECTED.NO2.min);
    expect(no2.maxHour).toBe(STATION38_DAY_EXPECTED.NO2.maxHour);
    expect(no2.hours).toBe(24);
    expect(no2.categoryMax).toBe(STATION38_DAY_EXPECTED.NO2.categoryMax);

    // Average computed independently from the raw fixture rows.
    const raw = station38Day().filter((r) => r.parameter_code === 'PM10').map((r) => Number(r.value));
    const expectedAvg = Math.round((raw.reduce((a, b) => a + b, 0) / raw.length) * 10) / 10;
    expect(pm10.avgValue).toBe(expectedAvg);
  });

  it('assigns hours to the Belgrade local day, not the UTC day', () => {
    // 2026-10-04T22:00Z is 2026-10-05 00:00 local; 2026-10-04T21:00Z is still 2026-10-04 local.
    const stats = computeDailyStats([
      obs(37, 'PM10', '2026-10-04T21:00:00Z', 10),
      obs(37, 'PM10', '2026-10-04T22:00:00Z', 20),
      obs(37, 'PM10', '2026-10-05T21:00:00Z', 30),
      obs(37, 'PM10', '2026-10-05T22:00:00Z', 40),
    ]);
    expect(stats.map((s) => [s.day, s.hours, s.minValue, s.maxValue])).toEqual([
      ['2026-10-04', 1, 10, 10],
      ['2026-10-05', 2, 20, 30],
      ['2026-10-06', 1, 40, 40],
    ]);
  });

  it('maxHour is the local hour of the maximum and avg is rounded to one decimal', () => {
    const [stat] = computeDailyStats([
      obs(36, 'O3', '2026-10-05T06:00:00Z', 90.0), // 08:00 local
      obs(36, 'O3', '2026-10-05T14:00:00Z', 112.7), // 16:00 local
      obs(36, 'O3', '2026-10-05T20:00:00Z', 100.1), // 22:00 local
    ]);
    expect(stat).toMatchObject({ parameter: 'O3', day: '2026-10-05', maxValue: 112.7, minValue: 90, maxHour: 16, hours: 3, categoryMax: 2 });
    expect(stat.avgValue).toBe(100.9); // (90 + 112.7 + 100.1) / 3 = 100.933…
  });

  it('dedupes revisions before aggregating (hours counts distinct hours)', () => {
    const [stat] = computeDailyStats([
      obs(38, 'PM10', '2026-10-05T10:00:00Z', 50),
      obs(38, 'PM10', '2026-10-05T10:00:00Z', 55),
      obs(38, 'PM10', '2026-10-05T11:00:00Z', 60),
    ]);
    expect(stat.hours).toBe(2);
    expect(stat.avgValue).toBe(57.5);
    expect(stat.maxValue).toBe(60);
  });

  it('counts all 25 hours of the fall-back day (2026-10-25) instead of capping at 24', () => {
    const { from, to } = dayUtcRange('2026-10-25');
    const observations: KosavaObservation[] = [];
    for (let t = from.getTime(); t < to.getTime(); t += HOUR) {
      // Peak in the repeated hour: 2026-10-25T01:00Z is the second 02:00 local (CET).
      observations.push(obs(38, 'PM10', new Date(t).toISOString(), t === Date.parse('2026-10-25T01:00:00Z') ? 90 : 20));
    }
    expect(observations).toHaveLength(25);
    const stats = computeDailyStats(observations);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ day: '2026-10-25', hours: 25, maxValue: 90, maxHour: 2, minValue: 20 });
    expect(stats[0].avgValue).toBe(22.8); // (24 × 20 + 90) / 25
  });

  it('restricts to onlyDays when given', () => {
    const observations = [
      obs(38, 'PM10', '2026-10-04T10:00:00Z', 1),
      obs(38, 'PM10', '2026-10-05T10:00:00Z', 2),
      obs(38, 'PM10', '2026-10-06T10:00:00Z', 3),
    ];
    expect(computeDailyStats(observations, ['2026-10-05']).map((s) => s.day)).toEqual(['2026-10-05']);
    expect(computeDailyStats(observations, new Set(['2026-10-04', '2026-10-06'])).map((s) => s.day)).toEqual([
      '2026-10-04',
      '2026-10-06',
    ]);
    expect(computeDailyStats(observations, [])).toEqual([]);
  });

  it('groups per station × parameter × day and sorts deterministically', () => {
    const stats = computeDailyStats([
      obs(106, 'PM10', '2026-10-05T10:00:00Z', 1),
      obs(37, 'SO2', '2026-10-05T10:00:00Z', 1),
      obs(37, 'PM10', '2026-10-06T10:00:00Z', 1),
      obs(37, 'PM10', '2026-10-05T10:00:00Z', 1),
    ]);
    expect(stats.map((s) => `${s.sepaId}|${s.day}|${s.parameter}`)).toEqual([
      '37|2026-10-05|PM10',
      '37|2026-10-05|SO2',
      '37|2026-10-06|PM10',
      '106|2026-10-05|PM10',
    ]);
  });

  it('categoryMax follows the daily maximum (SEPA thresholds)', () => {
    const [pm25] = computeDailyStats([
      obs(38, 'PM2.5', '2026-10-04T19:00:00Z', 20.1),
      obs(38, 'PM2.5', '2026-10-04T18:00:00Z', 56.7), // > 50 → category 3
    ]);
    expect(pm25.categoryMax).toBe(3);
    expect(pm25.maxHour).toBe(20);
  });

  it('returns [] for no observations', () => {
    expect(computeDailyStats([])).toEqual([]);
  });
});

describe('computeSnapshot', () => {
  const latest = '2026-10-05T18:00:00.000Z';

  it('returns null without observations or without any fresh value', () => {
    expect(computeSnapshot([])).toBeNull();
  });

  it('takes the newest value per parameter and the worst category as the station category', () => {
    const snapshot = computeSnapshot([
      obs(38, 'PM10', '2026-10-05T17:00:00Z', 70.6),
      obs(38, 'PM10', latest, 73.2),
      obs(38, 'NO2', latest, 78.5),
      obs(38, 'SO2', latest, 8.4),
    ])!;
    expect(snapshot.sepaId).toBe(38);
    expect(snapshot.observedAt).toBe(latest);
    expect(snapshot.values).toEqual({
      PM10: { v: 73.2, t: latest, c: 2 },
      NO2: { v: 78.5, t: latest, c: 3 },
      SO2: { v: 8.4, t: latest, c: 0 },
    });
    expect(snapshot.category).toBe(3);
    expect(snapshot.dominant).toBe('NO2');
  });

  it('excludes parameters whose newest value is older than the freshness window', () => {
    const snapshot = computeSnapshot(
      [
        obs(38, 'PM10', latest, 73.2),
        obs(38, 'NO2', '2026-10-05T15:00:00Z', 78.5), // exactly 3 h old → still fresh
        obs(38, 'O3', '2026-10-05T14:00:00Z', 160.5), // 4 h old → stale, must not drive the category
      ],
      { freshnessHours: 3 },
    )!;
    expect(Object.keys(snapshot.values).sort()).toEqual(['NO2', 'PM10']);
    expect(snapshot.values.NO2?.t).toBe('2026-10-05T15:00:00.000Z');
    expect(snapshot.category).toBe(3);
    expect(snapshot.dominant).toBe('NO2');
    // Stale series still appear in the 24-hour chart data.
    expect(snapshot.series.values.O3).toBeDefined();
  });

  it('honours a custom freshness window', () => {
    const rows = [obs(38, 'PM10', latest, 73.2), obs(38, 'NO2', '2026-10-05T16:00:00Z', 78.5)];
    expect(Object.keys(computeSnapshot(rows, { freshnessHours: 1 })!.values)).toEqual(['PM10']);
    expect(Object.keys(computeSnapshot(rows, { freshnessHours: 2 })!.values).sort()).toEqual(['NO2', 'PM10']);
  });

  it('builds a 24-slot series ending at the latest hour, with nulls for gaps', () => {
    const start = Date.parse(latest) - 23 * HOUR;
    const rows: KosavaObservation[] = [];
    for (let i = 0; i < 24; i++) {
      if (i === 5 || i === 6) continue; // two-hour outage
      rows.push(obs(38, 'PM10', new Date(start + i * HOUR).toISOString(), 30 + i));
    }
    rows.push(obs(38, 'PM10', new Date(start - HOUR).toISOString(), 999)); // older than the window
    const snapshot = computeSnapshot(rows)!;
    expect(snapshot.series.start).toBe(new Date(start).toISOString());
    const series = snapshot.series.values.PM10!;
    expect(series).toHaveLength(24);
    expect(series[0]).toBe(30);
    expect(series[5]).toBeNull();
    expect(series[6]).toBeNull();
    expect(series[23]).toBe(53);
    expect(series.includes(999)).toBe(false);
    expect(snapshot.values.PM10).toEqual({ v: 53, t: latest, c: 2 });
  });

  it('aligns a sparse parameter into the correct slots and omits parameters with no data in the window', () => {
    const snapshot = computeSnapshot([
      obs(38, 'PM10', latest, 50),
      obs(38, 'NO2', '2026-10-05T10:00:00Z', 40), // slot 23 - 8 = 15
      obs(38, 'SO2', '2026-10-03T10:00:00Z', 5), // outside the window and stale
    ])!;
    const no2 = snapshot.series.values.NO2!;
    expect(no2.filter((v) => v !== null)).toEqual([40]);
    expect(no2[15]).toBe(40);
    expect(snapshot.series.values.SO2).toBeUndefined();
    expect(snapshot.values.SO2).toBeUndefined();
  });

  it('uses the last revision of a repeated hour', () => {
    const snapshot = computeSnapshot([obs(38, 'PM10', latest, 70), obs(38, 'PM10', latest, 73.2)])!;
    expect(snapshot.values.PM10?.v).toBe(73.2);
    expect(snapshot.series.values.PM10![23]).toBe(73.2);
  });

  it('works on real-shaped API rows and ignores rows from another station', () => {
    const observations = parseObservations({
      data: [...station38Day(), observationRow(37, 'PM10', latest, 999)],
    });
    // dedupeHourly sorts by time; station 38's rows start the day, so 38 is the snapshot station
    const snapshot = computeSnapshot(observations.filter((o) => o.sepaId === 38))!;
    expect(snapshot.sepaId).toBe(38);
    expect(snapshot.observedAt).toBe('2026-10-05T21:00:00.000Z');
    expect(snapshot.values.PM10).toEqual({ v: 58.3, t: '2026-10-05T21:00:00.000Z', c: 2 });
    expect(snapshot.values.NO2).toEqual({ v: 60.9, t: '2026-10-05T21:00:00.000Z', c: 3 });
    expect(snapshot.category).toBe(3);
    expect(snapshot.dominant).toBe('NO2');
    expect(snapshot.series.values.PM10).toHaveLength(24);
    expect(snapshot.series.values.PM10!.every((v) => v !== null)).toBe(true);
  });
});

describe('parseSnapshotRecord', () => {
  const base: StationSnapshotRecord = {
    id: 'snap',
    station_id: 'st',
    observedAt: '2026-10-05T18:00:00.000Z',
    category: 2,
    dominant: 'PM10',
    valuesJson: '',
    seriesJson: '',
    updatedAt: '2026-10-05T18:05:00.000Z',
  };

  it('parses valid JSON columns', () => {
    const values = { PM10: { v: 73.2, t: '2026-10-05T18:00:00.000Z', c: 2 } };
    const series = { start: '2026-10-04T19:00:00.000Z', values: { PM10: [1, null, 3] } };
    const parsed = parseSnapshotRecord({ ...base, valuesJson: JSON.stringify(values), seriesJson: JSON.stringify(series) });
    expect(parsed.values).toEqual(values);
    expect(parsed.series).toEqual(series);
  });

  it('returns empty structures on invalid JSON instead of throwing', () => {
    const parsed = parseSnapshotRecord({ ...base, valuesJson: '{not json', seriesJson: 'null' });
    expect(parsed.values).toEqual({});
    expect(parsed.series).toEqual({ start: new Date(0).toISOString(), values: {} });
  });

  it('tolerates well-formed JSON of the wrong shape', () => {
    const parsed = parseSnapshotRecord({ ...base, valuesJson: '42', seriesJson: '{"values":{"PM10":[1]}}' });
    expect(parsed.values).toEqual({});
    expect(parsed.series.values).toEqual({});
    const noValues = parseSnapshotRecord({ ...base, valuesJson: '{}', seriesJson: '{"start":"2026-10-04T19:00:00.000Z"}' });
    expect(noValues.series).toEqual({ start: '2026-10-04T19:00:00.000Z', values: {} });
  });
});
