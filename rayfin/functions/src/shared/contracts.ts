/**
 * Ugovori između funkcija (server), baze (entiteti u rayfin/data) i frontenda.
 * Oblici zapisa prate dekorisane klase u rayfin/data; ovde su kao obični tipovi
 * da bi ih browser mogao da uvozi bez dekoratorskog runtime-a.
 */

import type { CategoryRank, Parameter } from './aqi.js';

export type ParameterCode = Parameter;

export interface StationRecord {
  id: string;
  sepaId: number;
  code: string;
  name: string;
  municipality?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  active: boolean;
  lastObservationAt?: Date | string | null;
  updatedAt: Date | string;
}

export interface DailyStatRecord {
  id: string;
  station_id: string;
  parameter: ParameterCode;
  /** YYYY-MM-DD, Europe/Belgrade */
  day: string;
  avgValue: number;
  maxValue: number;
  minValue: number;
  maxHour: number;
  hours: number;
  categoryMax: number;
  updatedAt: Date | string;
}

export interface StationSnapshotRecord {
  id: string;
  station_id: string;
  observedAt: Date | string;
  category: number;
  dominant: string;
  valuesJson: string;
  seriesJson: string;
  updatedAt: Date | string;
}

export interface SyncRunRecord {
  id: string;
  kind: 'sync' | 'backfill';
  status: 'running' | 'ok' | 'error';
  startedAt: Date | string;
  finishedAt?: Date | string | null;
  windowFrom: Date | string;
  windowTo: Date | string;
  stationsSeen: number;
  observationsSeen: number;
  rowsWritten: number;
  message?: string | null;
}

/** Sadržaj kolone StationSnapshot.valuesJson. */
export type SnapshotValues = Partial<
  Record<
    ParameterCode,
    {
      /** satna srednja vrednost, µg/m³ */
      v: number;
      /** početak sata, ISO UTC */
      t: string;
      /** SEPA kategorija 0–5 */
      c: CategoryRank;
    }
  >
>;

/** Sadržaj kolone StationSnapshot.seriesJson: 24 sata koja se završavaju najnovijim satom. */
export interface SnapshotSeries {
  /** početak prvog od 24 sata, ISO UTC */
  start: string;
  values: Partial<Record<ParameterCode, Array<number | null>>>;
}

/** Rezultat funkcije `syncAirQuality`. */
export interface SyncResult {
  ok: boolean;
  syncRunId: string;
  /** ISO UTC granice obrađenog prozora */
  from: string;
  to: string;
  stationsSeen: number;
  stationsWritten: number;
  observationsSeen: number;
  snapshotsWritten: number;
  dailyStatsWritten: number;
  durationMs: number;
  warnings: string[];
  error?: string;
}

/** Rezultat funkcije `backfillDay`. */
export interface BackfillResult {
  ok: boolean;
  syncRunId: string;
  /** YYYY-MM-DD lokalni dan koji je obrađen */
  day: string;
  stationsSeen: number;
  observationsSeen: number;
  dailyStatsWritten: number;
  durationMs: number;
  warnings: string[];
  error?: string;
}
