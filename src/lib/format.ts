/**
 * Formatiranje brojeva i vremena za srpski (latinica), vremenska zona Europe/Belgrade.
 *
 * Datumi se slažu iz `formatToParts` da bi oblik `dd. MM. yyyy. HH:mm` bio isti
 * nezavisno od verzije ICU u browseru (neke verzije izostavljaju razmake).
 */

import { PARAMETERS, THRESHOLDS_1H } from '@shared/aqi';
import { TIME_ZONE } from '@shared/time';

export const LOCALE = 'sr-Latn-RS';

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${minDigits}/${maxDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

/** Crtica za nedostajuću vrednost (en dash, kao u štampi). */
export const EMPTY = '–';

/** `1.234,5` – do `digits` decimala, bez pratećih nula. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return numberFormat(0, digits).format(value);
}

/** SEPA pragovi od 100 naviše (bilo kog polutanta): ceo broj na pragu bi sakrio prelazak. */
const HIGH_THRESHOLDS: ReadonlySet<number> = new Set(PARAMETERS.flatMap((parameter) => THRESHOLDS_1H[parameter].filter((limit) => limit >= 100)));

/**
 * Broj decimala koncentracije (µg/m³) – JEDNO pravilo za celu aplikaciju: jedna decimala
 * ispod 100, ceo broj od 100 naviše (SEPA vrednosti stižu zaokružene na 0,1). Granica se
 * proverava na vrednosti zaokruženoj na 0,1, pa 99,96 postaje „100“, a ne „100,0“.
 * Izuzetak: vrednost koja bi se zaokružila tačno na SEPA prag (npr. PM10 120,3 → „120“, a
 * kategorija je već „Zagađen“, jer „Umeren“ je ≤ 120) zadržava decimalu („120,3“). Pravilo
 * zavisi samo od vrednosti, pa ista vrednost svuda izgleda isto.
 */
export function concentrationDigits(value: number): 0 | 1 {
  const tenths = Math.round(value * 10) / 10;
  if (Math.abs(tenths) < 100) return 1;
  const whole = Math.round(tenths);
  return whole !== tenths && HIGH_THRESHOLDS.has(Math.abs(whole)) ? 1 : 0;
}

/** Koncentracija zaokružena tačno kako je `formatConcentration` prikazuje (za računanje „još …“). */
export function roundConcentration(value: number): number {
  const factor = concentrationDigits(value) === 1 ? 10 : 1;
  return Math.round(value * factor) / factor;
}

/**
 * Koncentracija za prikaz: „57,5“, „8“, „160“ (vidi `concentrationDigits`). Ista vrednost
 * stanice izgleda isto na Pregledu, Mapi i Stanicama. `fixed` zadržava decimalu i kad je
 * nula („8,0“) – za kolone tabela u kojima se decimalni zarezi poravnavaju.
 */
export function formatConcentration(value: number | null | undefined, options: { fixed?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const digits = concentrationDigits(value);
  return numberFormat(options.fixed ? digits : 0, digits).format(value);
}

/** Iznos promene (µg/m³, bez znaka): jedna decimala ispod 10, inače ceo broj („2,4“, „12“). */
export function formatDelta(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return EMPTY;
  const abs = Math.abs(amount);
  return formatNumber(abs, Math.round(abs * 10) / 10 < 10 ? 1 : 0);
}

/** Kratak broj stanica uz vrednost okruga: „1 st.“, „12 st.“ (uzorak medijane). */
export function stationsShort(count: number): string {
  return `${formatInt(count)} st.`;
}

/** Ceo broj sa tačkom kao separatorom hiljada. */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return numberFormat(0, 0).format(Math.round(value));
}

/** Udeo 0–1 kao procenat bez decimala (`35 %`). */
export function formatPercent(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return EMPTY;
  return `${numberFormat(0, 0).format(share * 100)} %`;
}

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface DateParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function dateParts(value: Date | string | number): DateParts | null {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Partial<DateParts> = {};
  for (const part of partsFormat.formatToParts(date)) {
    if (part.type === 'day' || part.type === 'month' || part.type === 'year' || part.type === 'hour' || part.type === 'minute') {
      parts[part.type] = part.value;
    }
  }
  if (!parts.day || !parts.month || !parts.year || !parts.hour || !parts.minute) return null;
  return parts as DateParts;
}

/** `06. 10. 2026. 17:00` */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const p = dateParts(value);
  return p ? `${p.day}. ${p.month}. ${p.year}. ${p.hour}:${p.minute}` : EMPTY;
}

/** `06. 10. 2026.` */
export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const p = dateParts(value);
  return p ? `${p.day}. ${p.month}. ${p.year}.` : EMPTY;
}

/** `17:00` */
export function formatTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const p = dateParts(value);
  return p ? `${p.hour}:${p.minute}` : EMPTY;
}

/**
 * Satni interval koji počinje u `start`: `16–17 h` (SEPA satni prosek; jasno bez obzira da li
 * se sat označava početkom ili krajem intervala). Ponoć je kraj dana: `23–24 h`.
 */
export function formatHourInterval(start: Date | string | number | null | undefined): string {
  if (start === null || start === undefined) return EMPTY;
  const from = dateParts(start);
  const to = dateParts(toDate(start).getTime() + 3_600_000);
  if (!from || !to) return EMPTY;
  const fromHour = Number(from.hour);
  const toHour = to.hour === '00' ? 24 : Number(to.hour);
  return `${fromHour}–${toHour} h`;
}

/** `06. 10.` – dan i mesec (Europe/Belgrade), npr. uz sat koji nije današnji. */
export function formatDayMonth(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const p = dateParts(value);
  return p ? `${p.day}. ${p.month}.` : EMPTY;
}

/**
 * Satni interval sa datumom samo kad nije današnji: „16–17 h“, „06. 10. 16–17 h“, a iz druge
 * godine „06. 10. 2025. 16–17 h“. Za sate merenja umesto „16:00“ (koje se čita i kao kraj sata).
 */
export function formatHourAt(start: Date | string | number | null | undefined, now: Date): string {
  if (start === null || start === undefined) return EMPTY;
  const interval = formatHourInterval(start);
  if (interval === EMPTY) return EMPTY;
  if (isSameLocalDay(start, now)) return interval;
  const p = dateParts(start);
  const n = dateParts(now);
  return p && n && p.year !== n.year ? `${formatDate(start)} ${interval}` : `${formatDayMonth(start)} ${interval}`;
}

/** Isti lokalni dan (Europe/Belgrade). */
export function isSameLocalDay(a: Date | string | number, b: Date | string | number): boolean {
  const pa = dateParts(a);
  const pb = dateParts(b);
  return Boolean(pa && pb && pa.day === pb.day && pa.month === pb.month && pa.year === pb.year);
}

/** Vreme sa datumom samo kad nije današnje: „14:05“ ili „06. 10. 14:05“ (npr. „podaci od …“). */
export function formatTimeSince(value: Date, now: Date): string {
  return isSameLocalDay(value, now) ? formatTime(value) : `${formatDayMonth(value)} ${formatTime(value)}`;
}

/** Lokalni dan `YYYY-MM-DD` → `06. 10.` (kratko, za ose). */
export function formatDayShort(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}. ${match[2]}.` : day;
}

/** Lokalni dan `YYYY-MM-DD` → `06. 10. 2026.` */
export function formatDayLong(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}. ${match[2]}. ${match[1]}.` : day;
}

/** Sat 0–23 → `17:00`. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Srpska množina: 1 → `one`, 2–4 → `few`, ostalo (i 11–14) → `many`. */
export function pluralSr(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** „pre 12 min“, „pre 3 h“, „pre 2 dana“, „upravo sada“. */
export function formatRelative(value: Date | string | number, now: Date = new Date()): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 45_000) return 'upravo sada';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `pre ${minutes} min`;
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 48) return `pre ${hours} h`;
  const days = Math.round(diffMs / 86_400_000);
  return `pre ${days} ${pluralSr(days, 'dan', 'dana', 'dana')}`;
}

/** Trajanje u ms → „1 min 35 s“ / „42 s“. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return EMPTY;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** Broj stanica sa pravilnim nastavkom: 1 stanica, 2 stanice, 5 stanica. */
export function stationsNoun(count: number): string {
  return pluralSr(count, 'stanica', 'stanice', 'stanica');
}
