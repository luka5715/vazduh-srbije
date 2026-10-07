/**
 * Agregacija satnih merenja u dnevnu statistiku i „snimak“ trenutnog stanja stanice.
 * Čista logika bez I/O, zajednička za funkcije i frontend (testira se vitest-om).
 */

import {
  classify,
  PARAMETERS,
  worstCategory,
  type CategoryRank,
  type Parameter,
} from './aqi.js';
import type {
  SnapshotSeries,
  SnapshotValues,
  StationSnapshotRecord,
} from './contracts.js';
import type { KosavaObservation } from './kosava.js';
import { hourStartIso, localDay, localHour } from './time.js';

const HOUR_MS = 3_600_000;

export interface DailyStatInput {
  sepaId: number;
  parameter: Parameter;
  day: string;
  avgValue: number;
  maxValue: number;
  minValue: number;
  maxHour: number;
  hours: number;
  categoryMax: CategoryRank;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Uklanja duplikate (ista stanica, polutant i sat): poslednji zapis u nizu pobeđuje,
 * što odgovara revizijama koje API vraća za preliminarne podatke.
 */
export function dedupeHourly(observations: KosavaObservation[]): KosavaObservation[] {
  const byKey = new Map<string, KosavaObservation>();
  for (const obs of observations) {
    const hour = hourStartIso(obs.timeStartUtc);
    byKey.set(`${obs.sepaId}|${obs.parameter}|${hour}`, { ...obs, timeStartUtc: hour });
  }
  return [...byKey.values()].sort((a, b) => a.timeStartUtc.localeCompare(b.timeStartUtc));
}

/**
 * Dnevna statistika po stanici i polutantu za lokalne dane (Europe/Belgrade).
 * Ako je zadat `onlyDays`, računa samo te dane.
 */
export function computeDailyStats(
  observations: KosavaObservation[],
  onlyDays?: Iterable<string>,
): DailyStatInput[] {
  const allowed = onlyDays ? new Set(onlyDays) : null;
  const groups = new Map<string, { obs: KosavaObservation[]; sepaId: number; parameter: Parameter; day: string }>();
  for (const obs of dedupeHourly(observations)) {
    const day = localDay(obs.timeStartUtc);
    if (allowed && !allowed.has(day)) continue;
    const key = `${obs.sepaId}|${obs.parameter}|${day}`;
    const group = groups.get(key) ?? { obs: [], sepaId: obs.sepaId, parameter: obs.parameter, day };
    group.obs.push(obs);
    groups.set(key, group);
  }
  const result: DailyStatInput[] = [];
  for (const group of groups.values()) {
    let sum = 0;
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    let maxObs = group.obs[0];
    for (const obs of group.obs) {
      sum += obs.value;
      if (obs.value > max) {
        max = obs.value;
        maxObs = obs;
      }
      if (obs.value < min) min = obs.value;
    }
    result.push({
      sepaId: group.sepaId,
      parameter: group.parameter,
      day: group.day,
      avgValue: round1(sum / group.obs.length),
      maxValue: round1(max),
      minValue: round1(min),
      maxHour: localHour(maxObs.timeStartUtc),
      // Dan prelaska na zimsko vreme ima 25 lokalnih sati (DailyStat.hours ima max 25).
      hours: Math.min(25, group.obs.length),
      categoryMax: classify(group.parameter, max),
    });
  }
  return result.sort(
    (a, b) => a.sepaId - b.sepaId || a.day.localeCompare(b.day) || a.parameter.localeCompare(b.parameter),
  );
}

export interface SnapshotInput {
  sepaId: number;
  /** ISO UTC početak najnovijeg sata sa merenjem */
  observedAt: string;
  category: CategoryRank;
  dominant: Parameter;
  values: SnapshotValues;
  series: SnapshotSeries;
}

export interface SnapshotOptions {
  /** Koliko sati unazad od najnovijeg merenja vrednost još važi kao „trenutna“ (podrazumevano 3). */
  freshnessHours?: number;
}

/**
 * Trenutno stanje jedne stanice iz njenih satnih merenja: najnovija vrednost
 * svakog polutanta (ako nije starija od `freshnessHours` u odnosu na najnovije
 * merenje stanice), SEPA kategorija i serija poslednja 24 sata.
 */
export function computeSnapshot(
  observations: KosavaObservation[],
  options: SnapshotOptions = {},
): SnapshotInput | null {
  const freshnessHours = options.freshnessHours ?? 3;
  const rows = dedupeHourly(observations);
  if (rows.length === 0) return null;
  const sepaId = rows[0].sepaId;
  const byParameter = new Map<Parameter, Map<number, number>>();
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const obs of rows) {
    if (obs.sepaId !== sepaId) continue;
    const ms = Date.parse(obs.timeStartUtc);
    if (ms > latestMs) latestMs = ms;
    const series = byParameter.get(obs.parameter) ?? new Map<number, number>();
    series.set(ms, obs.value);
    byParameter.set(obs.parameter, series);
  }
  const values: SnapshotValues = {};
  const current: Partial<Record<Parameter, number>> = {};
  for (const parameter of PARAMETERS) {
    const series = byParameter.get(parameter);
    if (!series || series.size === 0) continue;
    const newest = Math.max(...series.keys());
    if (latestMs - newest > freshnessHours * HOUR_MS) continue;
    const value = series.get(newest)!;
    values[parameter] = { v: value, t: new Date(newest).toISOString(), c: classify(parameter, value) };
    current[parameter] = value;
  }
  const worst = worstCategory(current);
  if (!worst) return null;
  const startMs = latestMs - 23 * HOUR_MS;
  const seriesValues: SnapshotSeries['values'] = {};
  for (const parameter of PARAMETERS) {
    const series = byParameter.get(parameter);
    if (!series) continue;
    const slots: Array<number | null> = [];
    let any = false;
    for (let i = 0; i < 24; i++) {
      const value = series.get(startMs + i * HOUR_MS);
      if (value !== undefined) any = true;
      slots.push(value ?? null);
    }
    if (any) seriesValues[parameter] = slots;
  }
  return {
    sepaId,
    observedAt: new Date(latestMs).toISOString(),
    category: worst.rank,
    dominant: worst.dominant,
    values,
    series: { start: new Date(startMs).toISOString(), values: seriesValues },
  };
}

/** Bezbedno parsira JSON kolone snimka (frontend). Nevalidan JSON daje prazne strukture. */
export function parseSnapshotRecord(record: StationSnapshotRecord): {
  values: SnapshotValues;
  series: SnapshotSeries;
} {
  let values: SnapshotValues = {};
  let series: SnapshotSeries = { start: new Date(0).toISOString(), values: {} };
  try {
    const parsed = JSON.parse(record.valuesJson);
    if (parsed && typeof parsed === 'object') values = parsed as SnapshotValues;
  } catch {
    values = {};
  }
  try {
    const parsed = JSON.parse(record.seriesJson);
    if (parsed && typeof parsed === 'object' && typeof parsed.start === 'string') {
      series = { start: parsed.start, values: parsed.values ?? {} };
    }
  } catch {
    series = { start: new Date(0).toISOString(), values: {} };
  }
  return { values, series };
}
