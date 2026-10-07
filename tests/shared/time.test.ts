import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayUtcRange,
  daysBetween,
  hourStartIso,
  isValidDay,
  localDay,
  localHour,
  TIME_ZONE,
  todayLocal,
} from '@shared/time';

const HOUR = 3_600_000;

describe('@shared/time', () => {
  it('uses Europe/Belgrade', () => {
    expect(TIME_ZONE).toBe('Europe/Belgrade');
  });

  describe('localDay / localHour', () => {
    it('converts UTC instants to Belgrade local day and hour in winter (UTC+1)', () => {
      expect(localDay('2026-01-15T23:30:00Z')).toBe('2026-01-16');
      expect(localHour('2026-01-15T23:30:00Z')).toBe(0);
      expect(localDay('2026-01-15T22:59:59Z')).toBe('2026-01-15');
      expect(localHour('2026-01-15T22:59:59Z')).toBe(23);
    });

    it('converts in summer (UTC+2)', () => {
      expect(localDay('2026-07-10T22:00:00Z')).toBe('2026-07-11');
      expect(localHour('2026-07-10T22:00:00Z')).toBe(0);
      expect(localDay('2026-07-10T21:59:59Z')).toBe('2026-07-10');
      expect(localHour('2026-10-05T18:00:00Z')).toBe(20);
    });

    it('accepts Date, ISO string and epoch milliseconds', () => {
      const iso = '2026-10-05T18:00:00.000Z';
      expect(localDay(new Date(iso))).toBe('2026-10-05');
      expect(localDay(iso)).toBe('2026-10-05');
      expect(localDay(Date.parse(iso))).toBe('2026-10-05');
      expect(localHour(new Date(iso))).toBe(20);
    });

    it('handles the spring-forward night (2026-03-29: 02:00 → 03:00 local)', () => {
      // 00:59:59Z is 01:59:59 CET; 01:00:00Z is already 03:00 CEST — hour 2 never exists.
      expect(localHour('2026-03-29T00:59:59Z')).toBe(1);
      expect(localHour('2026-03-29T01:00:00Z')).toBe(3);
      expect(localDay('2026-03-29T01:00:00Z')).toBe('2026-03-29');
      // Midnight before the change is still UTC+1.
      expect(localDay('2026-03-28T23:00:00Z')).toBe('2026-03-29');
      expect(localHour('2026-03-28T23:00:00Z')).toBe(0);
      // Midnight after the change is UTC+2.
      expect(localDay('2026-03-29T22:00:00Z')).toBe('2026-03-30');
      expect(localHour('2026-03-29T22:00:00Z')).toBe(0);
    });

    it('handles the fall-back night (2026-10-25: 03:00 → 02:00 local, hour 2 occurs twice)', () => {
      expect(localHour('2026-10-25T00:00:00Z')).toBe(2); // 02:00 CEST
      expect(localHour('2026-10-25T01:00:00Z')).toBe(2); // 02:00 CET (second time)
      expect(localHour('2026-10-25T02:00:00Z')).toBe(3);
      expect(localDay('2026-10-24T22:00:00Z')).toBe('2026-10-25'); // local midnight, UTC+2
      expect(localDay('2026-10-25T22:59:59Z')).toBe('2026-10-25'); // 23:59:59 CET
      expect(localDay('2026-10-25T23:00:00Z')).toBe('2026-10-26'); // next local midnight, UTC+1
    });

    it('never returns 24 as an hour', () => {
      for (let h = 0; h < 48; h++) {
        const hour = localHour(Date.UTC(2026, 9, 24, h));
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThanOrEqual(23);
      }
    });
  });

  describe('hourStartIso', () => {
    it('floors to the start of the UTC hour', () => {
      expect(hourStartIso('2026-10-05T18:37:12.345Z')).toBe('2026-10-05T18:00:00.000Z');
      expect(hourStartIso(new Date('2026-10-05T18:00:00.000Z'))).toBe('2026-10-05T18:00:00.000Z');
      expect(hourStartIso(Date.parse('2026-10-05T18:59:59.999Z'))).toBe('2026-10-05T18:00:00.000Z');
    });
  });

  describe('isValidDay', () => {
    it('accepts real calendar days', () => {
      expect(isValidDay('2026-10-06')).toBe(true);
      expect(isValidDay('2024-02-29')).toBe(true); // leap year
      expect(isValidDay('2026-12-31')).toBe(true);
    });

    it('rejects impossible dates and bad formats', () => {
      expect(isValidDay('2026-02-30')).toBe(false);
      expect(isValidDay('2026-02-29')).toBe(false); // not a leap year
      expect(isValidDay('2026-13-01')).toBe(false);
      expect(isValidDay('2026-00-10')).toBe(false);
      expect(isValidDay('2026-04-31')).toBe(false);
      expect(isValidDay('2026-4-1')).toBe(false);
      expect(isValidDay('06.10.2026')).toBe(false);
      expect(isValidDay('2026-10-06T00:00:00Z')).toBe(false);
      expect(isValidDay('')).toBe(false);
    });
  });

  describe('addDays', () => {
    it('rolls over months and years', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
      expect(addDays('2026-10-06', -30)).toBe('2026-09-06');
      expect(addDays('2026-10-06', 0)).toBe('2026-10-06');
      expect(addDays('2026-10-06', 365)).toBe('2027-10-06');
    });

    it('is unaffected by DST transitions', () => {
      expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
      expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    });
  });

  describe('daysBetween', () => {
    it('lists the inclusive range', () => {
      expect(daysBetween('2026-09-28', '2026-10-02')).toEqual([
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
      ]);
      expect(daysBetween('2026-10-06', '2026-10-06')).toEqual(['2026-10-06']);
      expect(daysBetween('2026-10-07', '2026-10-06')).toEqual([]);
    });

    it('caps runaway ranges at 401 days', () => {
      expect(daysBetween('2020-01-01', '2030-01-01')).toHaveLength(401);
    });
  });

  describe('dayUtcRange', () => {
    it('returns a 24-hour day in winter and summer', () => {
      const winter = dayUtcRange('2026-01-15');
      expect(winter.from.toISOString()).toBe('2026-01-14T23:00:00.000Z');
      expect(winter.to.toISOString()).toBe('2026-01-15T23:00:00.000Z');
      expect((winter.to.getTime() - winter.from.getTime()) / HOUR).toBe(24);

      const summer = dayUtcRange('2026-10-05');
      expect(summer.from.toISOString()).toBe('2026-10-04T22:00:00.000Z');
      expect(summer.to.toISOString()).toBe('2026-10-05T22:00:00.000Z');
      expect((summer.to.getTime() - summer.from.getTime()) / HOUR).toBe(24);
    });

    it('returns a 23-hour day on 2026-03-29 (spring forward)', () => {
      const { from, to } = dayUtcRange('2026-03-29');
      expect(from.toISOString()).toBe('2026-03-28T23:00:00.000Z');
      expect(to.toISOString()).toBe('2026-03-29T22:00:00.000Z');
      expect((to.getTime() - from.getTime()) / HOUR).toBe(23);
    });

    it('returns a 25-hour day on 2026-10-25 (fall back)', () => {
      const { from, to } = dayUtcRange('2026-10-25');
      expect(from.toISOString()).toBe('2026-10-24T22:00:00.000Z');
      expect(to.toISOString()).toBe('2026-10-25T23:00:00.000Z');
      expect((to.getTime() - from.getTime()) / HOUR).toBe(25);
    });

    it('boundaries are local midnight and consecutive days chain without gaps', () => {
      for (const day of ['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25', '2026-12-31']) {
        const { from, to } = dayUtcRange(day);
        expect(localDay(from)).toBe(day);
        expect(localHour(from)).toBe(0);
        expect(localDay(new Date(to.getTime() - 1))).toBe(day);
        expect(to.getTime()).toBe(dayUtcRange(addDays(day, 1)).from.getTime());
      }
    });
  });

  describe('todayLocal', () => {
    it('uses the given instant', () => {
      expect(todayLocal(new Date('2026-10-06T22:30:00Z'))).toBe('2026-10-07');
      expect(todayLocal(new Date('2026-10-06T21:59:00Z'))).toBe('2026-10-06');
    });
  });
});
