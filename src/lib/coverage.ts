/**
 * Pravilo pokrivenosti dana stanice (čista logika, bez React-a): red dnevne statistike je
 * „pokriven“ kad ima satna merenja za bar 75 % sati lokalnog dana (Europe/Belgrade) – 18 od
 * 24 h, 18 od 23 h i 19 od 25 h na dane prelaska na letnje/zimsko vreme. Kraći dan se
 * prikazuje šrafiran (kao nepotpun) i ne ulazi u brojeve, udele, rangiranja ni medijane.
 * Isti prag koristi i pokrivenost istorije na stranici Sinhronizacija (`historyCoverage` u
 * syncRules), pa „potpun dan“ na Sinhronizaciji i „pokriven dan“ na Trendovima znače isto.
 */

import type { DailyStatRecord } from '@shared/contracts';
import { dayUtcRange } from '@shared/time';

import { formatInt, pluralSr } from '@/lib/format';

/** Najmanji udeo sati lokalnog dana sa merenjem da bi dan stanice bio pokriven (18 od 24 h). */
export const MIN_DAY_COVERAGE = 0.75;

const dayLengths = new Map<string, number>();

/** Broj sati lokalnog dana: 24, a 23 ili 25 na dan prelaska na letnje/zimsko vreme. */
export function dayLengthHours(day: string): number {
  let hours = dayLengths.get(day);
  if (hours === undefined) {
    const { from, to } = dayUtcRange(day);
    const measured = Math.round((to.getTime() - from.getTime()) / 3_600_000);
    hours = measured >= 23 && measured <= 25 ? measured : 24;
    dayLengths.set(day, hours);
  }
  return hours;
}

/** Najmanji broj satnih merenja pokrivenog dana: 18 (24 h i 23 h), 19 (25 h). */
export function minCoveredHours(day: string): number {
  return Math.ceil(dayLengthHours(day) * MIN_DAY_COVERAGE - 1e-9);
}

/** Da li red dnevne statistike pokriva bar 75 % sati svog dana (ne gleda da li je dan završen). */
export function isCoveredStat(stat: Pick<DailyStatRecord, 'day' | 'hours'>): boolean {
  const hours = Number(stat.hours);
  return Number.isFinite(hours) && hours >= minCoveredHours(stat.day);
}

/**
 * „3 stanice sa kraćim danom (manje od 18 h merenja) nisu uračunate“ – broj dana stanica
 * isključenih pravilom pokrivenosti (vidi `scopedDayCounts` u trendData).
 */
export function shortStationsText(count: number): string {
  const n = formatInt(count);
  return pluralSr(
    count,
    `${n} stanica sa kraćim danom (manje od 18 h merenja) nije uračunata`,
    `${n} stanice sa kraćim danom (manje od 18 h merenja) nisu uračunate`,
    `${n} stanica sa kraćim danom (manje od 18 h merenja) nije uračunato`,
  );
}
