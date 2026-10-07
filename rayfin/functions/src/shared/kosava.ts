/**
 * SEPA / Kosava Open Data API – tipovi i tolerantni parseri odgovora.
 * Dokumentacija: https://opendata.kosava.cloud/api-docs
 *   GET /api/v1/metadata
 *   GET /api/v1/stations?active=true
 *   GET /api/v1/observations?station_id=..&from=..&to=..   (satne srednje vrednosti, 30 dana)
 *
 * Preuzimanje radi funkcija na serveru; ovaj modul samo parsira i NE SME da
 * uvozi Node.js module (koristi ga i frontend za demo i testove).
 */

import { normalizeParameter, type Parameter } from './aqi.js';

export const KOSAVA_BASE_URL = 'https://opendata.kosava.cloud/api/v1';

export interface KosavaStation {
  sepaId: number;
  code: string;
  name: string;
  municipality: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}

export interface KosavaObservation {
  sepaId: number;
  parameter: Parameter;
  /** Početak satnog intervala, ISO 8601 UTC. */
  timeStartUtc: string;
  /** Satna srednja vrednost u µg/m³. */
  value: number;
  unit: string;
  dataStatus: string | null;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Vraća niz zapisa iz odgovora koji može biti niz ili objekat sa `data`/`items`/`stations`/`observations`. */
export function unwrapList(payload: unknown): Dict[] {
  if (Array.isArray(payload)) return payload.filter(isDict);
  if (isDict(payload)) {
    for (const key of ['data', 'items', 'results', 'stations', 'observations', 'value']) {
      const inner = payload[key];
      if (Array.isArray(inner)) return inner.filter(isDict);
    }
  }
  return [];
}

function pickNumber(record: Dict, keys: string[]): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function pickString(record: Dict, keys: string[]): string | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
    if (typeof raw === 'number') return String(raw);
  }
  return null;
}

function pickCoordinates(record: Dict): { latitude: number | null; longitude: number | null } {
  let latitude = pickNumber(record, ['latitude', 'lat', 'Latitude', 'y']);
  let longitude = pickNumber(record, ['longitude', 'lon', 'lng', 'Longitude', 'x']);
  const location = record['location'] ?? record['geometry'] ?? record['coordinates'];
  if ((latitude === null || longitude === null) && isDict(location)) {
    latitude = latitude ?? pickNumber(location, ['latitude', 'lat', 'y']);
    longitude = longitude ?? pickNumber(location, ['longitude', 'lon', 'lng', 'x']);
    const coords = location['coordinates'];
    if (Array.isArray(coords) && coords.length >= 2) {
      const [a, b] = coords.map(Number);
      // GeoJSON redosled: [lon, lat]
      if (longitude === null && Number.isFinite(a)) longitude = a;
      if (latitude === null && Number.isFinite(b)) latitude = b;
    }
  } else if ((latitude === null || longitude === null) && Array.isArray(location) && location.length >= 2) {
    const [a, b] = location.map(Number);
    if (longitude === null && Number.isFinite(a)) longitude = a;
    if (latitude === null && Number.isFinite(b)) latitude = b;
  }
  // Srbija: lat 41.8–46.2, lon 18.8–23.0. Sve van toga tretiramo kao nepoznato.
  if (latitude !== null && (latitude < 41 || latitude > 47)) latitude = null;
  if (longitude !== null && (longitude < 18 || longitude > 24)) longitude = null;
  return { latitude, longitude };
}

/** Parsira odgovor GET /stations. Zapisi bez `station_id` se preskaču. */
export function parseStations(payload: unknown): KosavaStation[] {
  const stations: KosavaStation[] = [];
  for (const record of unwrapList(payload)) {
    const sepaId = pickNumber(record, ['station_id', 'stationId', 'id']);
    if (sepaId === null) continue;
    const name = pickString(record, ['station_name', 'stationName', 'name']) ?? `Stanica ${sepaId}`;
    const code = pickString(record, ['station_code', 'stationCode', 'code', 'eea_code']) ?? `ID${sepaId}`;
    const municipality = pickString(record, ['municipality', 'municipality_name', 'city', 'town']);
    const activeRaw = record['active'] ?? record['is_active'];
    const active = activeRaw === undefined || activeRaw === null ? true : Boolean(activeRaw);
    const { latitude, longitude } = pickCoordinates(record);
    stations.push({ sepaId: Math.trunc(sepaId), code, name, municipality, latitude, longitude, active });
  }
  return stations;
}

/**
 * Parsira odgovor GET /observations. Zadržava samo pet polutanata SEPA indeksa i
 * konačne numeričke vrednosti; satne agregacije (`hourly_mean`) ili zapise bez
 * oznake agregacije.
 */
export function parseObservations(payload: unknown, fallbackStationId?: number): KosavaObservation[] {
  const observations: KosavaObservation[] = [];
  for (const record of unwrapList(payload)) {
    const parameter = normalizeParameter(
      record['parameter_code'] ?? record['parameterCode'] ?? record['parameter'] ?? record['pollutant'],
    );
    if (!parameter) continue;
    const aggregation = pickString(record, ['aggregation_type', 'aggregationType']);
    if (aggregation && !/hour/i.test(aggregation)) continue;
    const sepaId = pickNumber(record, ['station_id', 'stationId']) ?? fallbackStationId ?? null;
    if (sepaId === null) continue;
    const value = pickNumber(record, ['value', 'concentration', 'val']);
    if (value === null || value < 0) continue;
    const time = pickString(record, ['time_start_utc', 'timeStartUtc', 'time_start', 'timestamp', 'time']);
    if (!time) continue;
    const parsed = new Date(time);
    if (Number.isNaN(parsed.getTime())) continue;
    observations.push({
      sepaId: Math.trunc(sepaId),
      parameter,
      timeStartUtc: parsed.toISOString(),
      value: Math.round(value * 10) / 10,
      unit: pickString(record, ['unit']) ?? 'ug.m-3',
      dataStatus: pickString(record, ['data_status', 'dataStatus', 'status']),
    });
  }
  return observations;
}

/** URL za satne vrednosti jedne stanice u zadatom UTC prozoru. */
export function observationsUrl(sepaId: number, from: Date, to: Date, baseUrl = KOSAVA_BASE_URL): string {
  const url = new URL(`${baseUrl}/observations`);
  url.searchParams.set('station_id', String(sepaId));
  url.searchParams.set('from', from.toISOString());
  url.searchParams.set('to', to.toISOString());
  return url.toString();
}

export function stationsUrl(baseUrl = KOSAVA_BASE_URL): string {
  return `${baseUrl}/stations?active=true`;
}
