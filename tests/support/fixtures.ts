/**
 * Fixtures shaped like the real SEPA / Kosava Open Data API responses.
 *
 * Field names follow what the nis-air `update-data.js` script reads from the API:
 *   stations:     station_id, station_name, station_code, municipality (+ optional coordinates)
 *   observations: { data: [ { station_id, parameter_code, time_start_utc, time_end_utc,
 *                             value, unit, data_status, aggregation_type, coverage } ] }
 *
 * Station ids/codes/names are the real Niš stations of the SEPA network, and the
 * daily maxima below are taken from `exports/vazduh/nis-daily-max.json`
 * (local day 2026-10-05, Europe/Belgrade = UTC+2 on that date).
 */

export const NIS_STATIONS = [
  { station_id: 36, station_name: 'Kamenički Vis EMEP', station_code: 'RS1055G', municipality: 'Niš' },
  { station_id: 37, station_name: 'Niš O.š. Sveti Sava', station_code: 'RS1056A', municipality: 'Niš' },
  { station_id: 38, station_name: 'Niš IZJZ Niš', station_code: 'RS1057A', municipality: 'Niš' },
  { station_id: 106, station_name: 'Niš Dimitrija Leka', station_code: 'RS1067A', municipality: 'Niš' },
] as const;

/** GET /stations?active=true — the real API returns a plain array. */
export function stationsPayload(): unknown[] {
  return [
    { ...NIS_STATIONS[0], latitude: 43.4019, longitude: 21.9503, active: true },
    { ...NIS_STATIONS[1], latitude: 43.3209, longitude: 21.8958, active: true },
    // Coordinates missing on purpose: the UI falls back to the municipality centroid.
    { ...NIS_STATIONS[2], active: true },
    { ...NIS_STATIONS[3], latitude: 43.3147, longitude: 21.9207, active: true },
  ];
}

export interface ObservationRow {
  station_id: number;
  parameter_code: string;
  time_start_utc: string;
  time_end_utc: string;
  value: number | string | null;
  unit: string;
  data_status: string;
  aggregation_type: string;
  coverage: number | null;
}

/** One hourly_mean row exactly as the API serialises it. */
export function observationRow(
  stationId: number,
  parameterCode: string,
  timeStartUtc: string,
  value: number | string | null,
  overrides: Partial<ObservationRow> = {},
): ObservationRow {
  const start = new Date(timeStartUtc);
  return {
    station_id: stationId,
    parameter_code: parameterCode,
    time_start_utc: start.toISOString(),
    time_end_utc: new Date(start.getTime() + 3_600_000).toISOString(),
    value,
    unit: 'ug.m-3',
    data_status: 'preliminary',
    aggregation_type: 'hourly_mean',
    coverage: 100,
    ...overrides,
  };
}

/** GET /observations — the real API wraps the rows in `{ data: [...] }`. */
export function observationsPayload(rows: ObservationRow[]): { data: ObservationRow[] } {
  return { data: rows };
}

/**
 * A full local day (2026-10-05, 24 hours, UTC+2 → 2026-10-04T22:00Z … 2026-10-05T21:00Z)
 * of hourly PM10 and NO2 values for station 38 (Niš IZJZ Niš), built so that the daily
 * maxima match nis-daily-max.json: PM10 73.2 at 20:00 local, NO2 80.1 at 21:00 local.
 */
export const DAY_2026_10_05_UTC_START = '2026-10-04T22:00:00.000Z';

export function station38Day(): ObservationRow[] {
  const rows: ObservationRow[] = [];
  const base = Date.parse(DAY_2026_10_05_UTC_START);
  // Plausible diurnal PM10 curve (µg/m³), index = local hour 0..23.
  const pm10 = [
    41.2, 38.7, 35.1, 33.4, 32.8, 34.9, 39.6, 47.3, 52.1, 48.4, 44.0, 40.2,
    37.5, 36.1, 35.8, 38.9, 44.7, 52.3, 61.9, 68.4, 73.2, 70.6, 64.8, 58.3,
  ];
  const no2 = [
    35.2, 31.1, 27.4, 24.9, 23.3, 26.8, 38.5, 55.1, 62.4, 51.7, 44.2, 39.8,
    36.4, 34.9, 35.5, 40.6, 49.3, 60.2, 69.7, 76.4, 78.5, 80.1, 71.3, 60.9,
  ];
  for (let h = 0; h < 24; h++) {
    const t = new Date(base + h * 3_600_000).toISOString();
    rows.push(observationRow(38, 'PM10', t, pm10[h]));
    rows.push(observationRow(38, 'NO2', t, no2[h]));
  }
  return rows;
}

/** Expected daily statistics for `station38Day()` (computed independently of the code under test). */
export const STATION38_DAY_EXPECTED = {
  PM10: { max: 73.2, min: 32.8, maxHour: 20, hours: 24, categoryMax: 2 },
  NO2: { max: 80.1, min: 23.3, maxHour: 21, hours: 24, categoryMax: 3 },
} as const;

/**
 * Rows for a 36-hour sync window ending at `now` for every Niš station: one PM10 and one
 * PM2.5 value per station per hour. Values are deterministic functions of (station, hour)
 * so that tests can predict the latest value of each station.
 */
export function networkWindow(now: Date, hoursBack: number): ObservationRow[] {
  const rows: ObservationRow[] = [];
  const lastHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 3_600_000; // latest complete hour
  for (const station of NIS_STATIONS) {
    for (let i = hoursBack - 1; i >= 0; i--) {
      const t = new Date(lastHour - i * 3_600_000).toISOString();
      const pm10 = 20 + (station.station_id % 10) + (hoursBack - 1 - i) * 0.5;
      rows.push(observationRow(station.station_id, 'PM10', t, Math.round(pm10 * 10) / 10));
      rows.push(observationRow(station.station_id, 'PM2.5', t, Math.round(pm10 * 0.6 * 10) / 10));
    }
  }
  return rows;
}
