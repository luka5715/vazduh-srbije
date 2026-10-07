import { describe, expect, it } from 'vitest';

import {
  KOSAVA_BASE_URL,
  observationsUrl,
  parseObservations,
  parseStations,
  stationsUrl,
  unwrapList,
} from '@shared/kosava';

import { NIS_STATIONS, observationRow, observationsPayload, stationsPayload } from '../support/fixtures';

describe('unwrapList', () => {
  it('accepts a bare array and the usual wrapper keys', () => {
    const rows = [{ a: 1 }, { b: 2 }];
    expect(unwrapList(rows)).toEqual(rows);
    expect(unwrapList({ data: rows })).toEqual(rows);
    expect(unwrapList({ items: rows })).toEqual(rows);
    expect(unwrapList({ results: rows })).toEqual(rows);
    expect(unwrapList({ stations: rows })).toEqual(rows);
    expect(unwrapList({ observations: rows })).toEqual(rows);
    expect(unwrapList({ value: rows })).toEqual(rows);
  });

  it('drops non-object entries and returns [] for garbage', () => {
    expect(unwrapList([{ a: 1 }, null, 3, 'x', [1]])).toEqual([{ a: 1 }]);
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList('data')).toEqual([]);
    expect(unwrapList({ data: 'not a list' })).toEqual([]);
    expect(unwrapList({ count: 3 })).toEqual([]);
  });
});

describe('parseStations', () => {
  it('parses the real station shape (station_id, station_name, station_code, municipality)', () => {
    const stations = parseStations(stationsPayload());
    expect(stations.map((s) => s.sepaId)).toEqual([36, 37, 38, 106]);
    expect(stations[1]).toEqual({
      sepaId: 37,
      code: 'RS1056A',
      name: 'Niš O.š. Sveti Sava',
      municipality: 'Niš',
      latitude: 43.3209,
      longitude: 21.8958,
      active: true,
    });
    // Station 38 carries no coordinates in the fixture → null, not 0 or NaN.
    expect(stations[2].latitude).toBeNull();
    expect(stations[2].longitude).toBeNull();
    expect(stations[2].code).toBe('RS1057A');
  });

  it('is tolerant to {data: [...]} vs a bare array', () => {
    const fromArray = parseStations(stationsPayload());
    const fromWrapped = parseStations({ data: stationsPayload() });
    expect(fromWrapped).toEqual(fromArray);
    expect(fromArray).toHaveLength(NIS_STATIONS.length);
  });

  it('skips records without a station id and fills defaults for name/code', () => {
    const stations = parseStations([
      { station_name: 'No id' },
      { station_id: '41' },
      { station_id: 42.0, station_name: '  Padded  ', station_code: ' RS0042A ' },
    ]);
    expect(stations).toHaveLength(2);
    expect(stations[0]).toMatchObject({ sepaId: 41, name: 'Stanica 41', code: 'ID41', municipality: null, active: true });
    expect(stations[1]).toMatchObject({ sepaId: 42, name: 'Padded', code: 'RS0042A' });
  });

  it('reads camelCase aliases and the active flag', () => {
    const [a, b, c] = parseStations([
      { stationId: 7, stationName: 'Alias', stationCode: 'RS0007A', city: 'Novi Sad', active: false },
      { id: 8, name: 'Plain', code: 'RS0008A', municipality_name: 'Subotica', is_active: 0 },
      { station_id: 9, eea_code: 'RS0009A', town: 'Bor' },
    ]);
    expect(a).toMatchObject({ sepaId: 7, name: 'Alias', code: 'RS0007A', municipality: 'Novi Sad', active: false });
    expect(b).toMatchObject({ sepaId: 8, name: 'Plain', code: 'RS0008A', municipality: 'Subotica', active: false });
    expect(c).toMatchObject({ sepaId: 9, code: 'RS0009A', municipality: 'Bor', active: true });
  });

  describe('coordinates', () => {
    it('reads latitude/longitude, lat/lon and lat/lng pairs (also as strings)', () => {
      const [a, b, c] = parseStations([
        { station_id: 1, latitude: 44.8176, longitude: 20.4569 },
        { station_id: 2, lat: '45.2671', lon: '19.8335' },
        { station_id: 3, lat: 43.3209, lng: 21.8958 },
      ]);
      expect([a.latitude, a.longitude]).toEqual([44.8176, 20.4569]);
      expect([b.latitude, b.longitude]).toEqual([45.2671, 19.8335]);
      expect([c.latitude, c.longitude]).toEqual([43.3209, 21.8958]);
    });

    it('reads a decimal comma', () => {
      const [s] = parseStations([{ station_id: 1, latitude: '44,8176', longitude: '20,4569' }]);
      expect([s.latitude, s.longitude]).toEqual([44.8176, 20.4569]);
    });

    it('reads GeoJSON geometry (coordinates are [lon, lat])', () => {
      const [a, b, c] = parseStations([
        { station_id: 1, geometry: { type: 'Point', coordinates: [20.4569, 44.8176] } },
        { station_id: 2, location: { lat: 43.32, lon: 21.9 } },
        { station_id: 3, coordinates: [21.9, 43.32] },
      ]);
      expect([a.latitude, a.longitude]).toEqual([44.8176, 20.4569]);
      expect([b.latitude, b.longitude]).toEqual([43.32, 21.9]);
      expect([c.latitude, c.longitude]).toEqual([43.32, 21.9]);
    });

    it('treats out-of-Serbia coordinates as unknown (null)', () => {
      const [zero, swapped, farAway, onlyLat] = parseStations([
        { station_id: 1, latitude: 0, longitude: 0 },
        { station_id: 2, latitude: 20.4569, longitude: 44.8176 }, // lat/lon swapped
        { station_id: 3, latitude: 52.52, longitude: 13.405 }, // Berlin
        { station_id: 4, latitude: 44.8, longitude: null },
      ]);
      expect([zero.latitude, zero.longitude]).toEqual([null, null]);
      expect([swapped.latitude, swapped.longitude]).toEqual([null, null]);
      expect([farAway.latitude, farAway.longitude]).toEqual([null, null]);
      expect([onlyLat.latitude, onlyLat.longitude]).toEqual([44.8, null]);
    });

    it('ignores non-numeric coordinate strings', () => {
      const [s] = parseStations([{ station_id: 1, latitude: 'n/a', longitude: '' }]);
      expect([s.latitude, s.longitude]).toEqual([null, null]);
    });
  });
});

describe('parseObservations', () => {
  const t = '2026-10-05T18:00:00.000Z';

  it('parses the real observation shape and keeps hourly_mean rows', () => {
    const payload = observationsPayload([
      observationRow(38, 'PM10', t, 73.2),
      observationRow(38, 'NO2', t, 78.5),
      observationRow(38, 'PM2.5', t, 41.2),
      observationRow(38, 'SO2', t, 8.4),
      observationRow(38, 'O3', t, 112.7),
    ]);
    const observations = parseObservations(payload);
    expect(observations).toHaveLength(5);
    expect(observations[0]).toEqual({
      sepaId: 38,
      parameter: 'PM10',
      timeStartUtc: t,
      value: 73.2,
      unit: 'ug.m-3',
      dataStatus: 'preliminary',
    });
    expect(observations.map((o) => o.parameter)).toEqual(['PM10', 'NO2', 'PM2.5', 'SO2', 'O3']);
  });

  it('accepts a bare array as well as {data: [...]}', () => {
    const rows = [observationRow(37, 'PM10', t, 50.1)];
    expect(parseObservations(rows)).toEqual(parseObservations({ data: rows }));
    expect(parseObservations(rows)).toHaveLength(1);
  });

  it('drops non-hourly aggregations but keeps rows without an aggregation marker', () => {
    const observations = parseObservations([
      observationRow(38, 'PM10', t, 60, { aggregation_type: 'daily_mean' }),
      observationRow(38, 'PM10', t, 61, { aggregation_type: 'daily_max' }),
      observationRow(38, 'PM10', t, 62, { aggregation_type: 'hourly_mean' }),
      observationRow(38, 'PM10', t, 63, { aggregation_type: '1-hour' }),
      { station_id: 38, parameter_code: 'PM10', time_start_utc: t, value: 64 },
    ]);
    expect(observations.map((o) => o.value)).toEqual([62, 63, 64]);
  });

  it('drops negative, NaN, null and non-numeric values', () => {
    const observations = parseObservations([
      observationRow(38, 'PM10', t, -1),
      observationRow(38, 'PM10', t, 'NaN'),
      observationRow(38, 'PM10', t, null),
      observationRow(38, 'PM10', t, 'n/a'),
      observationRow(38, 'PM10', t, ''),
      observationRow(38, 'PM10', t, 0), // zero is a valid measurement
      observationRow(38, 'PM10', t, '12,5'), // decimal comma string
    ]);
    expect(observations.map((o) => o.value)).toEqual([0, 12.5]);
  });

  it('drops unknown parameters (CO, benzene …) and rows without a parameter', () => {
    const observations = parseObservations([
      observationRow(38, 'CO', t, 0.4),
      observationRow(38, 'C6H6', t, 1.2),
      observationRow(38, 'NOx', t, 80),
      { station_id: 38, time_start_utc: t, value: 10 },
      observationRow(38, 'pm2_5', t, 21.3),
    ]);
    expect(observations).toEqual([expect.objectContaining({ parameter: 'PM2.5', value: 21.3 })]);
  });

  it('drops rows with a missing or unparsable timestamp and normalises valid ones to ISO UTC', () => {
    const observations = parseObservations([
      observationRow(38, 'PM10', t, 10, { time_start_utc: 'yesterday' }),
      { station_id: 38, parameter_code: 'PM10', value: 11 },
      { station_id: 38, parameter_code: 'PM10', value: 12, time_start_utc: '2026-10-05T20:00:00+02:00' },
      { station_id: 38, parameter_code: 'PM10', value: 13, timestamp: '2026-10-05T18:00:00Z' },
    ]);
    expect(observations.map((o) => [o.value, o.timeStartUtc])).toEqual([
      [12, '2026-10-05T18:00:00.000Z'],
      [13, '2026-10-05T18:00:00.000Z'],
    ]);
  });

  it('rounds values to one decimal', () => {
    const [o] = parseObservations([observationRow(38, 'PM10', t, 73.249)]);
    expect(o.value).toBe(73.2);
  });

  it('uses the fallback station id only when the row has none', () => {
    const observations = parseObservations(
      [
        { parameter_code: 'PM10', time_start_utc: t, value: 10 },
        { station_id: 37, parameter_code: 'PM10', time_start_utc: t, value: 11 },
      ],
      106,
    );
    expect(observations.map((o) => o.sepaId)).toEqual([106, 37]);
    expect(parseObservations([{ parameter_code: 'PM10', time_start_utc: t, value: 10 }])).toEqual([]);
  });

  it('defaults unit and data status when absent', () => {
    const [o] = parseObservations([{ station_id: 36, parameter_code: 'O3', time_start_utc: t, value: 99 }]);
    expect(o.unit).toBe('ug.m-3');
    expect(o.dataStatus).toBeNull();
  });
});

describe('URL builders', () => {
  it('builds the stations URL with active=true', () => {
    expect(stationsUrl()).toBe('https://opendata.kosava.cloud/api/v1/stations?active=true');
    expect(stationsUrl('http://localhost:8080/v1')).toBe('http://localhost:8080/v1/stations?active=true');
    expect(KOSAVA_BASE_URL).toBe('https://opendata.kosava.cloud/api/v1');
  });

  it('builds the observations URL with station_id, from and to in ISO UTC', () => {
    const from = new Date('2026-10-04T22:00:00.000Z');
    const to = new Date('2026-10-05T22:00:00.000Z');
    const url = new URL(observationsUrl(38, from, to));
    expect(url.origin + url.pathname).toBe('https://opendata.kosava.cloud/api/v1/observations');
    expect(url.searchParams.get('station_id')).toBe('38');
    expect(url.searchParams.get('from')).toBe('2026-10-04T22:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-05T22:00:00.000Z');
  });
});
