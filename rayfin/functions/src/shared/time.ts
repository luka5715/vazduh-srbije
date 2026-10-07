/**
 * Rad sa lokalnim vremenom (Europe/Belgrade) bez spoljnih biblioteka.
 * Koristi se i na serveru (funkcije) i u browseru.
 */

export const TIME_ZONE = 'Europe/Belgrade';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Lokalni dan (YYYY-MM-DD) za zadati trenutak. */
export function localDay(value: Date | string | number): string {
  return dayFormatter.format(toDate(value));
}

/** Lokalni sat (0–23) za zadati trenutak. */
export function localHour(value: Date | string | number): number {
  const text = hourFormatter.format(toDate(value)); // "HH:MM"
  return Number.parseInt(text.slice(0, 2), 10) % 24;
}

/** Zaokružuje trenutak na početak sata (UTC) i vraća ISO string. */
export function hourStartIso(value: Date | string | number): string {
  const d = toDate(value);
  return new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000).toISOString();
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Dodaje `n` dana na lokalni dan (YYYY-MM-DD). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + n, 12));
  return next.toISOString().slice(0, 10);
}

/** Niz lokalnih dana od `from` do `to` (uključivo). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    if (days.length > 400) break;
  }
  return days;
}

/**
 * UTC granice lokalnog dana: [from, to), gde je `to` početak sledećeg lokalnog dana.
 * Ispravno radi i na danima prelaska na letnje/zimsko vreme.
 */
export function dayUtcRange(day: string): { from: Date; to: Date } {
  return { from: localMidnightUtc(day), to: localMidnightUtc(addDays(day, 1)) };
}

function localMidnightUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Beograd je UTC+1 ili UTC+2; probamo ponude redom i proveravamo kroz Intl.
  for (const offsetMinutes of [120, 60, 180, 0]) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    if (localDay(candidate) === day && localHour(candidate) === 0) return candidate;
  }
  return new Date(naive - 60 * 60_000);
}

/** Današnji lokalni dan. */
export function todayLocal(now: Date = new Date()): string {
  return localDay(now);
}
